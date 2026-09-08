/**
 * @module ui/right-panel
 * @description 右栏信息面板：来源文件 / 节点详情 / 标签属性 / 链接当前文件 / 备注
 */

import type { IBacklink, IOpener, IParsedDoc } from '../host/types';
import { el } from '../utils/dom';
import { ID_SEP } from '../utils/make-key';

/** 右栏渲染数据 */
export interface IRightPanelData {
  doc: IParsedDoc;
  /** 当前选中节点，未选中时为 null */
  nodeId: string | null;
  /** 链接当前文件的反链（文件级聚合） */
  backlinks: IBacklink[];
}

export class RightPanel {
  constructor(
    private container: HTMLElement,
    private opener: IOpener,
  ) {}

  render(data: IRightPanelData): void {
    this.container.empty();
    this.renderSource(data.doc);
    this.renderNode(data.doc, data.nodeId);
    this.renderAttrs(data.doc, data.nodeId);
    this.renderBacklinks(data);
    this.renderNodeNote(data.doc, data.nodeId);
  }

  /** 没有打开 .mms 文件时的空态 */
  renderEmpty(): void {
    this.container.empty();
    this.container.appendChild(el('div', { cls: 'mms-empty-hint', text: '未打开 .mms 文件' }));
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

  private renderSource(doc: IParsedDoc): void {
    const card = this.card('来源文件');
    this.row(card, '文件', doc.filePath);

    if (doc.desc) {
      this.row(card, '备注', doc.desc);
    }

    const buttons = el('div', { cls: 'mms-info-actions' });
    const openSource = el('button', { cls: 'mms-mini-btn', text: '打开源码', attr: { type: 'button' } });
    openSource.addEventListener('click', () => {
      void this.opener.openSource(doc.filePath);
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

  private renderAttrs(doc: IParsedDoc, nodeId: string | null): void {
    const card = this.card('标签与属性');
    const tagBox = el('div', { cls: 'mms-info-row' });
    tagBox.appendChild(el('span', { cls: 'mms-info-key', text: '文件标签' }));
    const tags = el('span', { cls: 'mms-info-val' });
    if (doc.tags.length === 0) tags.textContent = '（无）';
    for (const tag of doc.tags) tags.appendChild(el('span', { cls: 'mms-tag-chip', text: tag }));
    tagBox.appendChild(tags);
    card.appendChild(tagBox);

    const node = nodeId ? doc.nodeMap.get(nodeId) : null;
    if (node) {
      for (const ref of node.crossRefs) {
        const text = ref.label ? `${ref.rawTarget} (${ref.label})` : ref.rawTarget;
        this.row(card, '跨边引用', `${ref.resolved ? '→ ' : '? '}${text}`);
      }
      this.row(card, '反链', `${node.incomingRefs.length} 个节点引用此节点`);
    }
  }

  private renderBacklinks(data: IRightPanelData): void {
    const card = this.card(`链接当前文件 (${data.backlinks.length})`);
    if (data.backlinks.length === 0) {
      card.appendChild(el('div', { cls: 'mms-empty-hint', text: `没有笔记链接当前文件《${data.doc.displayName}》` }));
      return;
    }
    for (const link of data.backlinks) {
      const row = el('div', { cls: 'mms-info-row' });
      row.appendChild(el('span', { cls: 'mms-info-key', text: '来源' }));
      row.appendChild(el('span', { cls: 'mms-info-val', text: `${link.sourcePath} → 第 ${link.sourceLine} 行` }));
      const jump = el('button', { cls: 'mms-mini-btn', text: '跳转', attr: { type: 'button' } });
      jump.addEventListener('click', () => {
        void this.opener.openSource(link.sourcePath, link.sourceLine);
      });
      row.appendChild(jump);
      card.appendChild(row);
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
}
