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
import { RightPanel } from '../ui/right-panel';
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

    this.rightPanel = new RightPanel(root, this.deps.opener);
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
      this.rightPanel.renderEmpty();
      return;
    }
    this.rightPanel.render({
      doc,
      nodeId,
      backlinks: this.collectFileBacklinks(doc),
    });
  }

  /** 全文件的反链聚合：合并各节点 incomingRefs 并按来源去重 */
  private collectFileBacklinks(doc: IParsedDoc): IBacklink[] {
    const seen = new Set<string>();
    const out: IBacklink[] = [];
    for (const node of doc.nodes) {
      for (const link of node.incomingRefs) {
        const key = `${link.sourcePath}::${link.sourceLine}::${link.targetNode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(link);
      }
    }
    return out;
  }
}
