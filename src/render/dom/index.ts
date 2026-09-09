/**
 * @module render/dom
 * @description 探索视图渲染：doc → DocumentFragment。纯渲染，零 obsidian 依赖
 */

import type { ILayoutResult, IMmsNode, IParsedDoc, MmsLayout } from '../../host/types';
import { layoutTree } from '../../core/layout';
import { el } from '../../utils/dom';
import { buildEdgesSvg, type ILineRenderOptions } from '../shared/edges';
import {
  createDirectiveRuntime,
  domNodeStyle,
  pruneCollapsed,
  type IDirectiveRuntime,
  type INodeDirectiveMeta,
} from '../shared/extensions';

export interface ExploreRenderOptions extends ILineRenderOptions {
  /** 子节点之间间距（像素） */
  nodeGap: number;
  /** 层级之间间距（像素），同时作为曲线模式的安全推力上限 `H0` */
  levelGap: number;
  /** 节点点击回调，未传时节点不可点 */
  onNodeClick?: (nodeId: string) => void;
  /** 注入的折叠覆盖态（优先于指令初始态）。视图层不传——折叠点击直接写回文档指令行 */
  collapseOverrides?: ReadonlyMap<string, boolean>;
  /** 折叠徽标点击回调；currently 为点击前的有效折叠态 */
  onToggleCollapse?: (nodeId: string, currently: boolean) => void;
}

const PADDING = 24;

function buildNode(
  node: IMmsNode,
  box: { x: number; y: number; width: number; height: number },
  meta: INodeDirectiveMeta,
  direction: MmsLayout,
  options: ExploreRenderOptions,
): HTMLElement {
  const root = el('div', {
    cls: `mms-dom-node mms-depth-${Math.min(node.depth, 6)}${node.isAutoFix ? ' is-auto' : ''}${meta.locked ? ' is-locked' : ''}`,
    attr: { 'data-node-id': node.id },
  });
  root.style.left = `${box.x}px`;
  root.style.top = `${box.y}px`;
  root.style.width = `${box.width}px`;
  root.style.minHeight = `${box.height}px`;

  // 指令样式：inline 声明优先于 CSS 类（含 .is-auto 的 opacity 等默认值）
  for (const [prop, value] of Object.entries(domNodeStyle(meta.ext))) {
    root.style.setProperty(prop, value);
  }

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

  // 调试叠加层：节点 id 与源码行号，浮于节点左上角（指令 debug）
  if (meta.debug) {
    root.appendChild(el('div', { cls: 'mms-debug-chip', text: `${node.id} · L${node.lineNo}` }));
  }

  // 折叠徽标：有子节点的节点均可折叠（指令 collapsed 给初始态，点击切换运行时覆盖态）
  if (meta.foldable && options.onToggleCollapse) {
    const fold = el('button', {
      cls: `mms-fold-btn mms-fold-btn--${direction.toLowerCase()}${meta.collapsed ? ' is-collapsed' : ''}`,
      text: meta.collapsed ? `+${meta.hiddenCount}` : '−',
      attr: { type: 'button', title: meta.collapsed ? '展开子节点' : '折叠子节点' },
    });
    fold.addEventListener('click', (evt) => {
      evt.stopPropagation();
      options.onToggleCollapse?.(node.id, meta.collapsed);
    });
    root.appendChild(fold);
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
  const runtime: IDirectiveRuntime = createDirectiveRuntime(doc, options.collapseOverrides);
  const pruned = pruneCollapsed(doc.rootId, doc.nodeMap, runtime.collapsedIds);
  const layout: ILayoutResult = layoutTree(doc.rootId, pruned.map, {
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

  const edges = buildEdgesSvg(layout, {
    direction: doc.layout,
    lineStyle: options.lineStyle,
    gap: options.levelGap,
    width,
    height,
    treeLineWidth: options.lineWidth,
    crossLineWidth: options.crossLineWidth,
    edgeStyle: (edge) => runtime.edgeStyle(edge.to),
  });
  edges.style.position = 'absolute';
  edges.style.left = '0';
  edges.style.top = '0';
  canvas.appendChild(edges);

  const layer = el('div', { cls: 'mms-dom-layer' });
  for (const [id, box] of layout.nodes) {
    const node = pruned.map.get(id);
    if (!node) continue;
    const nodeEl = buildNode(
      node,
      { x: box.x + PADDING, y: box.y + PADDING, width: box.width, height: box.height },
      runtime.metaOf(node),
      doc.layout,
      options,
    );
    layer.appendChild(nodeEl);
  }
  canvas.appendChild(layer);

  fragment.appendChild(canvas);
  return fragment;
}
