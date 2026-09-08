/**
 * @module main
 * @description MMS 插件装配层：唯一 import 'obsidian' 的入口
 */

import { Plugin } from 'obsidian';
import { MmsIndex } from './controller/refresh';
import { MmsSelection } from './controller/selection';
import { ObsidianMetaHost } from './host/obsidian/meta';
import { ObsidianOpener } from './host/obsidian/opener';
import { ObsidianUiHost } from './host/obsidian/ui-host';
import { ObsidianVaultHost } from './host/obsidian/vault';
import { DEFAULT_SETTINGS } from './settings/defaults';
import type { MmsSettings } from './settings/schema';
import { MMS_DETAIL_VIEW_TYPE, MmsDetailView } from './views/detail-view';
import { MMS_VIEW_TYPE, MmsView } from './views/mms-view';
import { MMS_SIDE_VIEW_TYPE, MmsSideView } from './views/side-view';
import { MmsSettingTab } from './views/settings-tab';

/** 插件设置落盘后的防抖窗口（毫秒）。数字输入框每敲一次键都会落盘，避免逐字重扫全库 */
const SETTINGS_DEBOUNCE_MS = 400;

/** Mind Map Show 插件主体。只负责装配，业务逻辑一律下沉到 core / controller */
export default class MmsPlugin extends Plugin {
  settings: MmsSettings = { ...DEFAULT_SETTINGS };

  private index: MmsIndex | null = null;
  private readonly settingsListeners: (() => void)[] = [];
  private settingsTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    const vaultHost = new ObsidianVaultHost(this.app);
    const metaHost = new ObsidianMetaHost();
    const opener = new ObsidianOpener(this.app);
    const uiHost = new ObsidianUiHost();
    const index = new MmsIndex(vaultHost, metaHost, uiHost);
    const selection = new MmsSelection();
    this.index = index;

    this.registerView(MMS_VIEW_TYPE, (leaf) => new MmsView(leaf, {
      index,
      opener,
      uiHost,
      selection,
      getSettings: () => this.settings,
      ensureDetailLeaf: () => this.ensureDetailLeaf(),
      onSettingsChange: (fn) => this.onSettingsChange(fn),
    }));
    this.registerView(MMS_DETAIL_VIEW_TYPE, (leaf) => new MmsDetailView(leaf, {
      index,
      opener,
      selection,
    }));
    this.registerView(MMS_SIDE_VIEW_TYPE, (leaf) => new MmsSideView(leaf, {
      index,
      opener,
      uiHost,
      getSettings: () => this.settings,
      onSettingsChange: (fn) => this.onSettingsChange(fn),
      openDetailPanel: () => void this.openDetailPanel(),
    }));
    this.registerExtensions(['mms'], MMS_VIEW_TYPE);
    this.addSettingTab(new MmsSettingTab(this.app, this));

    this.addRibbonIcon('git-fork', 'MMS：打开文件面板', () => void this.openSidePanel());
    this.addCommand({
      id: 'mms-open-side',
      name: 'MMS：打开文件面板',
      callback: () => void this.openSidePanel(),
    });
    this.addCommand({
      id: 'mms-open-detail',
      name: 'MMS：打开详情面板',
      callback: () => void this.openDetailPanel(),
    });
    this.addCommand({
      id: 'mms-refresh',
      name: 'MMS：刷新全部 .mms',
      callback: () => void index.refresh(),
    });

    void index.refresh();
  }

  onunload(): void {
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    this.settingsListeners.length = 0;
    this.index = null;
  }

  async updateSettings(patch: Partial<MmsSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    await this.saveData(this.settings);
    this.scheduleSettingsFlush();
  }

  /**
   * 订阅设置变更，返回注销函数。视图在 onOpen 订阅、onClose 注销。
   * 回调在防抖窗口结束后触发，已保证 this.settings 是最新值
   */
  onSettingsChange(fn: () => void): () => void {
    this.settingsListeners.push(fn);
    return () => this.offSettingsChange(fn);
  }

  private offSettingsChange(fn: () => void): void {
    const idx = this.settingsListeners.indexOf(fn);
    if (idx >= 0) this.settingsListeners.splice(idx, 1);
  }

  /** 防抖广播：先让各视图按新设置重绘，再整库重扫，保证数据与展示一致 */
  private scheduleSettingsFlush(): void {
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = null;
      for (const fn of [...this.settingsListeners]) fn();
      void this.index?.refresh();
    }, SETTINGS_DEBOUNCE_MS);
  }

  private async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  /** 把 MMS 文件面板挂到 Obsidian 左侧 sidebar */
  private async openSidePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_SIDE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: MMS_SIDE_VIEW_TYPE, active: true });
  }

  /** 首次打开 .mms 时自动挂详情面板；用户手动关掉后不再弹出 */
  private detailAutoOpened = false;

  private ensureDetailLeaf(): void {
    if (this.detailAutoOpened) return;
    this.detailAutoOpened = true;
    void this.openDetailPanel();
  }

  /**
   * 把 MMS 详情面板挂到 Obsidian 右侧 sidebar（移动端为独立覆盖界面）。
   * 公开：左栏「查看详情」按钮与命令面板都走这里
   */
  async openDetailPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_DETAIL_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: MMS_DETAIL_VIEW_TYPE, active: false });
  }
}
