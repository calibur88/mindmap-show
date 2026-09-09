/**
 * @module views/side-view
 * @description MMS 侧栏视图：ItemView 承载 LeftPanel，挂到 Obsidian 左 sidebar
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { MmsIndex } from '../controller/refresh';
import type { IOpener, IUiHost } from '../host/types';
import type { MmsSettings } from '../settings/schema';
import { LeftPanel, type IScanSnapshot } from '../ui/left-panel';

/** 侧栏视图类型标识。registerView / setViewState / getLeavesOfType 共用 */
export const MMS_SIDE_VIEW_TYPE = 'mms-side-view';

export interface IMmsSideViewDeps {
  index: MmsIndex;
  opener: IOpener;
  uiHost: IUiHost;
  getSettings: () => MmsSettings;
  /** 订阅设置变更，返回注销函数 */
  onSettingsChange: (fn: () => void) => () => void;
  /** 唤起右侧详情面板：右栏被手动关掉后，左栏是唯一的再入口 */
  openDetailPanel: () => void;
}

/** 左 sidebar 内的 MMS 文件面板：标签云 + 文件树 + 解析警告 + 状态卡 */
export class MmsSideView extends ItemView {
  private leftPanel: LeftPanel | null = null;
  private activeTag: string | null = null;
  private readonly boundRender = (): void => this.render();
  private unsubscribeSettings: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: IMmsSideViewDeps) {
    super(leaf);
  }

  getViewType(): string {
    return MMS_SIDE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'MMS 文件面板';
  }

  getIcon(): string {
    return 'git-fork';
  }

  async onOpen(): Promise<void> {
    this.leftPanel = new LeftPanel(
      this.containerEl,
      this.deps.opener,
      this.deps.uiHost,
      () => void this.deps.index.refresh(),
      (tag) => {
        this.activeTag = tag;
        this.render();
      },
      () => this.deps.openDetailPanel(),
    );
    this.deps.index.onUpdate(this.boundRender);
    this.unsubscribeSettings = this.deps.onSettingsChange(this.boundRender);
    this.render();

    if (this.deps.index.getFileSummaries().length === 0) {
      void this.deps.index.refresh();
    }
  }

  async onClose(): Promise<void> {
    this.deps.index.offUpdate(this.boundRender);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    // 级联注销状态卡的 onStatus 监听，避免侧栏反复开闭累积泄漏
    this.leftPanel?.destroy();
    this.leftPanel = null;
  }

  private render(): void {
    if (!this.leftPanel) return;
    const snap: IScanSnapshot = {
      files: this.deps.index.getFileSummaries(),
      tags: this.deps.index.getTagStats(),
      activeTag: this.activeTag,
      // 全工程警告聚合；currentFilePath 为 null 表示侧栏全局视图
      warnings: this.deps.index.getAllWarnings(),
      currentFilePath: null,
    };
    this.leftPanel.render(snap, this.deps.getSettings().showDebugWarnings);
  }
}
