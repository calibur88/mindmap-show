/**
 * @module ui/right-panel
 * @description 右栏信息面板：来源文件 / 当前选中节点 / 标签 / 引用链 / 入链 / 出链 / 节点注释 / 嵌入资源
 */

import type { IBacklink, IOutlink, IParsedDoc } from '../host/types';
import { el } from '../utils/dom';
import { ID_SEP, shortNodeName } from '../utils/make-key';

/** 右栏渲染数据 */
export interface IRightPanelData {
  doc: IParsedDoc;
  /** 当前选中节点，未选中时为 null */
  nodeId: string | null;
  /** 入链：`<=>` 指向当前节点的来源记录（含本文件，显示为「本文件」） */
  inlinks: IBacklink[];
  /** 出链：当前文件指向外部文件的 `<=>` 记录（文件级，不含同文件引用） */
  outlinks: IOutlink[];
}

/** 右栏跳转动作，由 detail-view 从插件侧转发 */
export interface IRightPanelActions {
  /** 打开来源文件源码并定位行号 */
  openSource: (filePath: string, lineNo?: number) => void;
  /** 打开目标脑图并选中节点（同文件则仅切换选中） */
  openAndSelect: (filePath: string, nodeId: string) => void;
}

export class RightPanel {
  constructor(
    private container: HTMLElement,
    private actions: IRightPanelActions,
  ) {}

  render(data: IRightPanelData): void {
    this.container.empty();
    this.renderSource(data.doc);
    this.renderNode(data.doc, data.nodeId);
    this.renderTags(data.doc);
    this.renderRefChain(data.doc, data.nodeId);
    this.renderInlinks(data.inlinks, data.doc.filePath);
    this.renderOutlinks(data.outlinks);
    this.renderNodeNote(data.doc, data.nodeId);
    this.renderEmbeds(data.doc, data.nodeId);
  }

  /**
   * 空态。未传 hint 时表示没有打开 .mms 文件；
   * detail-view 传入 hint 用于「文件已移动 / 索引未同步」的降级提示
   */
  renderEmpty(hint?: string): void {
    this.container.empty();
    this.container.appendChild(el('div', { cls: 'mms-empty-hint', text: hint ?? '未打开 .mms 文件' }));
  }

  private card(title: string): HTMLElement {
    const card = el('div', { cls: 'mms-info-card' });
    card.appendChild(el('div', { cls: 'mms-info-card-title', text: title }));
    this.container.appendChild(card);
    return card;
  }

  private row(parent: HTMLElement, key: string, value: string): void {
    const row = el('div', { cls: 'mms-info-row' });
    row.appendChild(el('span', { cls: 'mms-info-key', text: key }));
    row.appendChild(el('span', { cls: 'mms-info-val', text: value }));
    parent.appendChild(row);
  }

  /** 一条「值 + 跳转按钮」的行，供引用链 / 入链 / 出链共用 */
  private jumpRow(parent: HTMLElement, value: string, onJump: () => void, broken = false): void {
    const row = el('div', { cls: 'mms-info-row' });
    row.appendChild(el('span', { cls: `mms-info-val${broken ? ' is-broken' : ''}`, text: value }));
    if (!broken) {
      const jump = el('button', { cls: 'mms-mini-btn', text: '跳转', attr: { type: 'button' } });
      jump.addEventListener('click', onJump);
      row.appendChild(jump);
    }
    parent.appendChild(row);
  }

  private renderSource(doc: IParsedDoc): void {
    const card = this.card('来源文件');
    this.row(card, '文件', doc.filePath);

    if (doc.desc) {
      this.row(card, '备注', doc.desc);
    }

    const buttons = el('div', { cls: 'mms-info-actions' });
    const openSource = el('button', { cls: 'mms-mini-btn', text: '打开源码', attr: { type: 'button' } });
    openSource.addEventListener('click', () => {
      this.actions.openSource(doc.filePath);
    });
    buttons.appendChild(openSource);
    card.appendChild(buttons);
  }

  private renderNode(doc: IParsedDoc, nodeId: string | null): void {
    const card = this.card('当前选中节点');
    if (!nodeId) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '未选中节点' }));
      return;
    }
    const node = doc.nodeMap.get(nodeId);
    if (!node) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '节点已失效' }));
      return;
    }
    this.row(card, '节点名称', node.text || '（空）');
    this.row(card, '节点类型', node.isAutoFix ? '自动补齐' : node.type === 'heading' ? '标题 (#)' : '子节点 (--)');
    this.row(card, '层级深度', String(node.depth));
    this.row(card, '所属分支', node.id.split(ID_SEP).slice(0, -1).join(' → ') || '（根）');
    this.row(card, '行号', `第 ${node.lineNo} 行`);
    this.row(card, '内容', node.content.join(' / ') || '（无）');
  }

  private renderTags(doc: IParsedDoc): void {
    const card = this.card('标签');
    if (doc.tags.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '（无）' }));
      return;
    }
    const box = el('div', { cls: 'mms-tag-row' });
    for (const tag of doc.tags) box.appendChild(el('span', { cls: 'mms-tag-chip', text: tag }));
    card.appendChild(box);
  }

  /**
   * 引用链：选中节点的全部对外引用。
   * `<=>` 跨边（建边、画虚线，带备注）与 `::` 节点引用（点对点定位）合并展示，
   * 与画布上的 REF 虚线保持一致
   */
  private renderRefChain(doc: IParsedDoc, nodeId: string | null): void {
    const card = this.card('引用链');
    if (!nodeId) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '未选中节点' }));
      return;
    }
    const node = doc.nodeMap.get(nodeId);
    if (!node) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '节点已失效' }));
      return;
    }
    for (const ref of node.crossRefs) {
      const name = ref.resolved ? shortNodeName(ref.targetNodeId) : ref.rawTarget;
      const label = ref.label ? `（${ref.label}）` : '';
      this.jumpRow(
        card,
        ref.resolved ? `→ ${name}${label}` : `? ${name}`,
        () => this.actions.openAndSelect(ref.targetFilePath, ref.targetNodeId),
        !ref.resolved,
      );
    }
    for (const ref of node.nodeRefs) {
      const name = ref.resolved ? shortNodeName(ref.targetNodeId) : ref.rawTarget;
      this.jumpRow(
        card,
        `:: ${name}`,
        () => this.actions.openAndSelect(ref.targetFilePath, ref.targetNodeId),
        !ref.resolved,
      );
    }
    if (node.crossRefs.length === 0 && node.nodeRefs.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '暂无引用（<=> 或 ::）' }));
    }
  }

  /** 入链：`<=>` 指向选中节点的来源；同文件来源显示为「本文件」 */
  private renderInlinks(inlinks: IBacklink[], filePath: string): void {
    const card = this.card('入链');
    if (inlinks.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '暂无节点引用此节点' }));
      return;
    }
    for (const link of inlinks) {
      const source = link.sourcePath === filePath ? '本文件' : link.sourcePath;
      this.jumpRow(
        card,
        `${source} → 第 ${link.sourceLine} 行`,
        () => this.actions.openSource(link.sourcePath, link.sourceLine),
      );
    }
  }

  /** 出链：文件级的对外 `<=>` 聚合（同文件引用见「引用链」卡） */
  private renderOutlinks(outlinks: IOutlink[]): void {
    const card = this.card('出链（文件级）');
    if (outlinks.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '当前文件未引用外部节点' }));
      return;
    }
    for (const link of outlinks) {
      const value = link.resolved
        ? `${link.targetPath} → 第 ${link.targetLine} 行`
        : `${link.targetPath}（断链）`;
      this.jumpRow(
        card,
        value,
        () => this.actions.openAndSelect(link.targetPath, link.targetNodeId as string),
        !link.resolved,
      );
    }
  }

  /** 节点注释（`** ` 行）；未选中或无注释时隐藏卡片 */
  private renderNodeNote(doc: IParsedDoc, nodeId: string | null): void {
    const card = this.card('节点注释');
    if (!nodeId) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '未选中节点' }));
      return;
    }
    const node = doc.nodeMap.get(nodeId);
    if (!node) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '节点已失效' }));
      return;
    }
    if (node.annotation.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '暂无注释（** 行）' }));
      return;
    }
    for (const line of node.annotation) {
      const item = el('div', { cls: 'mms-node-annotation' });
      item.textContent = line;
      card.appendChild(item);
    }
  }

  /** 嵌入资源（`![[...]]` 与裸 URL）；未选中或无嵌入时隐藏卡片 */
  private renderEmbeds(doc: IParsedDoc, nodeId: string | null): void {
    const card = this.card('嵌入资源');
    if (!nodeId) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '未选中节点' }));
      return;
    }
    const node = doc.nodeMap.get(nodeId);
    if (!node) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '节点已失效' }));
      return;
    }
    if (node.embeds.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: '暂无嵌入（![[...]] 或裸 URL）' }));
      return;
    }
    for (const embed of node.embeds) {
      this.jumpRow(
        card,
        `${embed.kind.toUpperCase()} ${embed.target} → 第 ${embed.lineNo} 行`,
        () => this.actions.openSource(doc.filePath, embed.lineNo),
      );
    }
  }
}
