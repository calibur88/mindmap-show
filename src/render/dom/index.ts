/**
 * @module render/dom
 * @description 探索视图渲染：doc → DocumentFragment。纯渲染，零 obsidian 依赖
 */

import type { ILayoutResult, IMmsNode, IParsedDoc } from '../../host/types';
import { layoutTree } from '../../core/layout';
import { el } from '../../utils/dom';
import { buildEdgesSvg } from '../shared/edges';

export interface ExploreRenderOptions {
  /** 树边线宽（像素），从 settings 传入 */
  lineWidth: number;
  /** 跨文件引用虚线线宽（像素） */
  crossLineWidth: number;
  /** 子节点之间间距（像素） */
  nodeGap: number;
  /** 层级之间间距（像素） */
  levelGap: number;
  /** 节点点击回调，未传时节点不可点 */
  onNodeClick?: (nodeId: string) => void;
}

const PADDING = 24;

function buildNode(node: IMmsNode, box: { x: number; y: number; width: number; height: number }, options: ExploreRenderOptions): HTMLElement {
  const root = el('div', {
    cls: `mms-dom-node mms-depth-${Math.min(node.depth, 6)}${node.isAutoFix ? ' is-auto' : ''}`,
    attr: { 'data-node-id': node.id },
  });
  root.style.left = `${box.x}px`;
  root.style.top = `${box.y}px`;
  root.style.width = `${box.width}px`;
  root.style.minHeight = `${box.height}px`;

  root.appendChild(el('div', { cls: 'mms-node-text', text: node.isAutoFix ? '（自动补齐）' : node.text }));

  for (const line of node.content.slice(0, 2)) {
    root.appendChild(el('div', { cls: 'mms-node-content', text: line }));
  }

  if (node.embeds.length > 0) {
    const badgeBox = el('div', { cls: 'mms-node-badges' });
    for (const embed of node.embeds) {
      const icon = embed.kind === 'image' ? 'IMG' : embed.kind === 'mms' ? 'MMS' : embed.kind === 'url' ? 'URL' : 'FILE';
      badgeBox.appendChild(el('span', { cls: `mms-badge mms-badge-${embed.kind}`, text: `${icon} ${embed.target}` }));
    }
    root.appendChild(badgeBox);
  }

  if (node.crossRefs.length > 0) {
    const refBox = el('div', { cls: 'mms-node-badges' });
    for (const ref of node.crossRefs) {
      refBox.appendChild(el('span', { cls: 'mms-badge mms-badge-ref', text: `REF ${ref.rawTarget}` }));
    }
    root.appendChild(refBox);
  }

  if (options.onNodeClick) {
    root.style.cursor = 'pointer';
    root.addEventListener('click', () => options.onNodeClick?.(node.id));
  }
  return root;
}

/** 渲染探索视图，返回可直接挂到画布的文档片段 */
export function renderExplore(doc: IParsedDoc, options: ExploreRenderOptions): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const layout: ILayoutResult = layoutTree(doc.rootId, doc.nodeMap, {
    direction: doc.layout,
    nodeGap: options.nodeGap,
    levelGap: options.levelGap,
  });

  if (layout.nodes.size === 0) {
    const empty = el('div', { cls: 'mms-empty-hint', text: '空脑图：文件里没有任何 # 或 -- 节点' });
    fragment.appendChild(empty);
    return fragment;
  }

  const width = layout.width + PADDING * 2;
  const height = layout.height + PADDING * 2;

  const canvas = el('div', { cls: 'mms-dom-canvas' });
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const edges = buildEdgesSvg(layout, doc.layout, width, height, options.lineWidth, options.crossLineWidth);
  edges.style.position = 'absolute';
  edges.style.left = '0';
  edges.style.top = '0';
  canvas.appendChild(edges);

  const layer = el('div', { cls: 'mms-dom-layer' });
  for (const [id, box] of layout.nodes) {
    const node = doc.nodeMap.get(id);
    if (!node) continue;
    const nodeEl = buildNode(node, { x: box.x + PADDING, y: box.y + PADDING, width: box.width, height: box.height }, options);
    layer.appendChild(nodeEl);
  }
  canvas.appendChild(layer);

  fragment.appendChild(canvas);
  return fragment;
}
