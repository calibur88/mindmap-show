/**
 * @module views/detail-view
 * @description MMS 详情面板：ItemView 承载 RightPanel，挂到 Obsidian 右 sidebar。
 *
 * 桌面端是右侧常驻栏；移动端由 Obsidian 以独立覆盖界面展示，
 * 因此面板本身不需要任何显隐 / 折叠逻辑
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { MmsIndex } from '../controller/refresh';
import type { MmsSelection } from '../controller/selection';
import type { IBacklink, IOpener, IParsedDoc } from '../host/types';
import { RightPanel, type IRightPanelActions } from '../ui/right-panel';
import { el } from '../utils/dom';

/** 详情视图类型标识。registerView / setViewState / getLeavesOfType 共用 */
export const MMS_DETAIL_VIEW_TYPE = 'mms-detail-view';

export interface IMmsDetailViewDeps {
  index: MmsIndex;
  opener: IOpener;
  selection: MmsSelection;
}

export class MmsDetailView extends ItemView {
  private rightPanel: RightPanel | null = null;
  private readonly boundRender = (): void => this.render();

  constructor(leaf: WorkspaceLeaf, private deps: IMmsDetailViewDeps) {
    super(leaf);
  }

  getViewType(): string {
    return MMS_DETAIL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'MMS 详情';
  }

  getIcon(): string {
    return 'info';
  }

  async onOpen(): Promise<void> {
    // ItemView.containerEl 是 .view-content（position: relative，无显式 height），
    // 根节点用 absolute 才能撑满整个 sidebar 区域
    const container = this.containerEl;
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    const root = el('div', { cls: 'mms-right-panel' });
    root.style.position = 'absolute';
    root.style.inset = '0';
    container.appendChild(root);

    this.rightPanel = new RightPanel(root, this.makeActions());
    this.deps.index.onUpdate(this.boundRender);
    this.deps.selection.onChange(this.boundRender);
    this.render();
  }

  async onClose(): Promise<void> {
    this.deps.index.offUpdate(this.boundRender);
    this.deps.selection.offChange(this.boundRender);
  }

  private render(): void {
    if (!this.rightPanel) return;
    const { filePath, nodeId } = this.deps.selection.get();
    const doc = filePath ? this.deps.index.getDoc(filePath) : undefined;
    if (!doc) {
      // 有选中文件但索引找不到：文件被移动 / 重命名后索引未同步的降级提示
      this.rightPanel.renderEmpty(filePath ? '文件已移动或索引未同步，请刷新' : undefined);
      return;
    }
    this.rightPanel.render({
      doc,
      nodeId,
      inlinks: this.collectInlinks(doc, nodeId),
      outlinks: doc.outgoingRefs,
    });
  }

  /** 入链：`<=>` 指向当前节点的全部来源；同文件来源由右栏显示为「本文件」 */
  private collectInlinks(doc: IParsedDoc, nodeId: string | null): IBacklink[] {
    if (!nodeId) return [];
    const node = doc.nodeMap.get(nodeId);
    if (!node) return [];
    return node.incomingRefs;
  }

  /** 跳转动作：打开源码定位行号 / 打开脑图并选中节点 */
  private makeActions(): IRightPanelActions {
    return {
      openSource: (filePath, lineNo) => {
        void this.deps.opener.openSource(filePath, lineNo);
      },
      openAndSelect: (filePath, nodeId) => {
        if (this.deps.selection.get().filePath === filePath) {
          this.deps.selection.set(filePath, nodeId);
          return;
        }
        void this.deps.opener.openMindMap(filePath).then(() => {
          this.deps.selection.set(filePath, nodeId);
        });
      },
    };
  }
}
