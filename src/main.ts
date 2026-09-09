/**
 * @module main
 * @description 插件入口。只做装配：宿主适配器 → 索引/选中总线 → 视图注册 → 命令/ribbon
 */

import { Plugin, TFile, TFolder } from 'obsidian';
import { MmsIndex } from './controller/refresh';
import { MmsSelection } from './controller/selection';
import { ObsidianOpener } from './host/obsidian/opener';
import { ObsidianUiHost } from './host/obsidian/ui-host';
import { ObsidianVaultHost } from './host/obsidian/vault';
import { DEFAULT_SETTINGS } from './settings/defaults';
import type { MmsSettings } from './settings/schema';
import { MMS_DETAIL_VIEW_TYPE, MmsDetailView } from './views/detail-view';
import { MMS_VIEW_TYPE, MmsView } from './views/mms-view';
import { MMS_SIDE_VIEW_TYPE, MmsSideView } from './views/side-view';
import { MmsSettingTab } from './views/settings-tab';

const SETTINGS_DEBOUNCE_MS = 400;
/** vault 事件（编辑/重命名/删除）触发重扫的防抖窗口 */
const VAULT_RESCAN_DEBOUNCE_MS = 500;

export default class MmsPlugin extends Plugin {
  settings: MmsSettings = { ...DEFAULT_SETTINGS };

  private index: MmsIndex | null = null;
  private readonly settingsListeners: (() => void)[] = [];
  private settingsTimer: number | null = null;
  /** 防抖窗口内尚有未落盘的设置变更 */
  private settingsDirty = false;
  private vaultTimer: number | null = null;
  private detailAutoOpened = false;
  /** 防抖窗口内是否累积了需要广播重绘的设置变更（静默更新不置位） */
  private settingsBroadcast = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    const vaultHost = new ObsidianVaultHost(this.app);
    // 视图类型常量由 main 注入，host 层不反向依赖 views 层
    const opener = new ObsidianOpener(this.app, MMS_VIEW_TYPE);
    const uiHost = new ObsidianUiHost();
    const index = new MmsIndex(vaultHost, uiHost);
    const selection = new MmsSelection();
    this.index = index;

    this.registerView(
      MMS_VIEW_TYPE,
      (leaf) =>
        new MmsView(leaf, {
          index,
          opener,
          uiHost,
          selection,
          getSettings: () => this.settings,
          ensureDetailLeaf: () => this.ensureDetailLeaf(),
          onSettingsChange: (fn) => this.onSettingsChange(fn),
        }),
    );
    this.registerView(
      MMS_SIDE_VIEW_TYPE,
      (leaf) =>
        new MmsSideView(leaf, {
          index,
          opener,
          uiHost,
          getSettings: () => this.settings,
          onSettingsChange: (fn) => this.onSettingsChange(fn),
          openDetailPanel: () => void this.openDetailPanel(),
          getCollapsedFolders: () => this.settings.collapsedFolders,
          persistCollapsedFolders: (folders) =>
            this.updateSettingsSilently({ collapsedFolders: folders }),
        }),
    );
    this.registerView(
      MMS_DETAIL_VIEW_TYPE,
      (leaf) => new MmsDetailView(leaf, { index, opener, selection }),
    );
    this.registerExtensions(['mms'], MMS_VIEW_TYPE);
    this.addSettingTab(new MmsSettingTab(this.app, this));

    this.addRibbonIcon('git-fork', 'MMS：打开文件面板', () => {
      void this.openSidePanel();
    });

    this.addCommand({
      id: 'mms-open-side',
      name: 'MMS：打开文件面板',
      callback: () => {
        void this.openSidePanel();
      },
    });

    this.addCommand({
      id: 'mms-open-detail',
      name: 'MMS：打开详情面板',
      callback: () => {
        void this.openDetailPanel();
      },
    });

    this.addCommand({
      id: 'mms-refresh',
      name: 'MMS：刷新全部 .mms',
      callback: () => {
        void index.refresh();
      },
    });

    // .mms 文件被编辑 / 重命名 / 删除后自动重扫（防抖合并连续事件）。
    // 文件夹重命名会连带改变内部 .mms 路径，一律触发
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        // 文件夹重命名：先把折叠记录迁移到新路径，再触发重扫
        if (file instanceof TFolder) this.remapCollapsedFolders(oldPath, file.path);
        if (!(file instanceof TFile) || file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        // 文件夹删除：清掉它及子路径的折叠记录，再触发重扫
        if (file instanceof TFolder) this.pruneCollapsedFolders(file.path);
        if (!(file instanceof TFile) || file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );

    // 组件就绪后做首次全库扫描；空库时侧栏自己会给出提示
    void index.refresh();
  }

  onunload(): void {
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    if (this.vaultTimer !== null) {
      window.clearTimeout(this.vaultTimer);
      this.vaultTimer = null;
    }
    // 防抖窗口内未落盘的设置立即补写，避免卸载时丢失
    if (this.settingsDirty) void this.saveData(this.settings);
    this.settingsListeners.length = 0;
    this.index = null;
  }

  /** 合并设置并安排防抖落盘与广播。非法输入由设置面板在调用前拦截 */
  updateSettings(patch: Partial<MmsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.settingsDirty = true;
    this.settingsBroadcast = true;
    this.scheduleSettingsFlush();
  }

  /**
   * 静默合并：只改内存与落盘，不广播设置变更、不触发重扫。
   * 供文件夹折叠等已做局部 DOM 更新的 UI 状态使用，避免整栏重绘丢滚动位置
   */
  updateSettingsSilently(patch: Partial<MmsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.settingsDirty = true;
    this.scheduleSettingsFlush();
  }

  /**
   * 订阅设置变更。回调在防抖窗口结束后触发，已保证 this.settings 是最新值。
   * 返回注销函数，视图 onClose 必须调用
   */
  onSettingsChange(fn: () => void): () => void {
    this.settingsListeners.push(fn);
    return () => this.offSettingsChange(fn);
  }

  private offSettingsChange(fn: () => void): void {
    const idx = this.settingsListeners.indexOf(fn);
    if (idx >= 0) this.settingsListeners.splice(idx, 1);
  }

  /** 防抖落盘 + 广播：先保存；非静默变更再让各视图按新设置重绘并整库重扫 */
  private scheduleSettingsFlush(): void {
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = null;
      const broadcast = this.settingsBroadcast;
      this.settingsBroadcast = false;
      void (async () => {
        await this.saveData(this.settings);
        this.settingsDirty = false;
        if (!broadcast) return;
        for (const fn of [...this.settingsListeners]) fn();
        await this.index?.refresh();
      })();
    }, SETTINGS_DEBOUNCE_MS);
  }

  /** vault 事件防抖：短时间内多次编辑只触发一次全库重扫 */
  private scheduleVaultRescan(): void {
    if (this.vaultTimer !== null) window.clearTimeout(this.vaultTimer);
    this.vaultTimer = window.setTimeout(() => {
      this.vaultTimer = null;
      void this.index?.refresh();
    }, VAULT_RESCAN_DEBOUNCE_MS);
  }

  /**
   * 文件夹重命名后迁移折叠记录：精确匹配换新路径，子路径按前缀替换。
   * 根目录「/」不可重命名，无需处理其边界
   */
  private remapCollapsedFolders(oldPath: string, newPath: string): void {
    const list = this.settings.collapsedFolders;
    if (list.length === 0) return;
    const prefix = `${oldPath}/`;
    let changed = false;
    const next = list.map((p) => {
      if (p === oldPath) {
        changed = true;
        return newPath;
      }
      if (p.startsWith(prefix)) {
        changed = true;
        return `${newPath}${p.slice(oldPath.length)}`;
      }
      return p;
    });
    if (changed) this.updateSettingsSilently({ collapsedFolders: next });
  }

  /** 文件夹删除后清掉它及子路径的折叠记录 */
  private pruneCollapsedFolders(folderPath: string): void {
    const list = this.settings.collapsedFolders;
    if (list.length === 0) return;
    const prefix = `${folderPath}/`;
    const next = list.filter((p) => p !== folderPath && !p.startsWith(prefix));
    if (next.length !== list.length) this.updateSettingsSilently({ collapsedFolders: next });
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<MmsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  private async openSidePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_SIDE_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    if (existing.length > 0) await this.app.workspace.revealLeaf(leaf);
    else await leaf.setViewState({ type: MMS_SIDE_VIEW_TYPE, active: true });
  }

  /** 状态卡/命令入口：唤起右侧详情面板，已打开时聚焦即可 */
  async openDetailPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_DETAIL_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: MMS_DETAIL_VIEW_TYPE, active: true });
  }

  /** onload 时（且仅一次）自动挂详情面板，避免用户以为右栏坏了 */
  private ensureDetailLeaf(): void {
    if (this.detailAutoOpened) return;
    this.detailAutoOpened = true;
    void this.openDetailPanel();
  }
}
