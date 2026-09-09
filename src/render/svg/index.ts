/**
 * @module render/svg
 * @description 全景视图渲染：doc → SVG。纯矢量一次性全量输出（渲染内容静态），可无限缩放；
 * 节点交互经根上事件委托按需接入（选中／折叠徽标，SVG 图元是一等 DOM）
 */

import type { ILayoutResult, ILayoutNode, IParsedDoc, MmsLayout } from '../../host/types';
import { layoutTree } from '../../core/layout';
import { svgEl } from '../../utils/dom';
import { buildEdgesSvg, type ILineRenderOptions } from '../shared/edges';
import {
  createDirectiveRuntime,
  pruneCollapsed,
  svgNodeStyle,
  type IDirectiveRuntime,
  type INodeDirectiveMeta,
} from '../shared/extensions';

export interface PanoramaRenderOptions extends ILineRenderOptions {
  /** 子节点之间间距（像素） */
  nodeGap: number;
  /** 层级之间间距（像素），同时作为曲线模式的安全推力上限 `H0` */
  levelGap: number;
  onNodeClick?: (nodeId: string) => void;
  /** 注入的折叠覆盖态（优先于指令初始态）。视图层不传——折叠点击直接写回文档指令行 */
  collapseOverrides?: ReadonlyMap<string, boolean>;
  /** 折叠徽标点击回调；currently 为点击前的有效折叠态 */
  onToggleCollapse?: (nodeId: string, currently: boolean) => void;
}

const PADDING = 24;

/** 折叠徽标锚点：取节点与子层相连的那条边中点（与连线锚点一致） */
function foldAnchor(box: ILayoutNode, direction: MmsLayout): { x: number; y: number } {
  switch (direction) {
    case 'LR':
      return { x: box.x + box.width, y: box.y + box.height / 2 };
    case 'RL':
      return { x: box.x, y: box.y + box.height / 2 };
    case 'TB':
      return { x: box.x + box.width / 2, y: box.y + box.height };
    case 'BT':
      return { x: box.x + box.width / 2, y: box.y };
  }
}

/** 指令样式落点：fill 走 inline style（覆盖 CSS 深度类的 fill 规则），rx 走属性（无 CSS 竞争） */
function applyShapeStyle(rect: SVGRectElement, shape: Record<string, string>): void {
  for (const [prop, value] of Object.entries(shape)) {
    if (prop === 'rx') rect.setAttribute('rx', value);
    else rect.style.setProperty(prop, value);
  }
}

export function renderPanorama(doc: IParsedDoc, options: PanoramaRenderOptions): SVGSVGElement {
  const runtime: IDirectiveRuntime = createDirectiveRuntime(doc, options.collapseOverrides);
  const pruned = pruneCollapsed(doc.rootId, doc.nodeMap, runtime.collapsedIds);
  const layout: ILayoutResult = layoutTree(doc.rootId, pruned.map, {
    direction: doc.layout,
    nodeGap: options.nodeGap,
    levelGap: options.levelGap,
  });
  const width = Math.max(layout.width + PADDING * 2, 200);
  const height = Math.max(layout.height + PADDING * 2, 120);

  const svg = svgEl('svg', {
    class: 'mms-svg-canvas',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });

  if (layout.nodes.size === 0) {
    const text = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'mms-svg-empty' });
    text.textContent = '空脑图：文件里没有任何 # 或 -- 节点';
    svg.appendChild(text);
    return svg;
  }

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
  edges.setAttribute('x', String(PADDING));
  edges.setAttribute('y', String(PADDING));
  svg.appendChild(edges);

  const group = svgEl('g', { transform: `translate(${PADDING} ${PADDING})` });
  for (const [id, box] of layout.nodes) {
    const node = pruned.map.get(id);
    if (!node) continue;

    const meta: INodeDirectiveMeta = runtime.metaOf(node);
    const nodeStyle = svgNodeStyle(meta.ext);

    const g = svgEl('g', {
      class: `mms-svg-node mms-depth-${Math.min(node.depth, 6)}${meta.locked ? ' is-locked' : ''}`,
      'data-node-id': node.id,
    });
    const rect = svgEl('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 6 });
    applyShapeStyle(rect, nodeStyle.shape);
    g.appendChild(rect);

    // 节点整体透明度（指令 opacity）：落在 <g> 上，对形状与文本同时生效
    for (const [prop, value] of Object.entries(nodeStyle.group)) {
      g.style.setProperty(prop, value);
    }

    const cx = box.x + box.width / 2;
    const hasSub = node.content.length > 0;
    // label 与 sub 都把 y 当作文字中心（dominant-baseline: central），避免 baseline 渲染的重叠感
    const labelY = hasSub ? box.y + box.height * 0.4 : box.y + box.height / 2;
    const subY = box.y + box.height * 0.78;

    const label = svgEl('text', {
      x: cx,
      y: labelY,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'mms-svg-text',
    });
    label.textContent = node.isAutoFix ? '（自动补齐）' : node.text;
    // 指令 text-color：inline style 覆盖 .mms-svg-text 的 CSS fill 规则
    for (const [prop, value] of Object.entries(nodeStyle.text)) {
      label.style.setProperty(prop, value);
    }
    g.appendChild(label);

    if (hasSub) {
      const sub = svgEl('text', {
        x: cx,
        y: subY,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: 'mms-svg-sub',
      });
      sub.textContent = node.content[0].slice(0, 32);
      for (const [prop, value] of Object.entries(nodeStyle.text)) {
        sub.style.setProperty(prop, value);
      }
      g.appendChild(sub);
    }

    const title = svgEl('title');
    title.textContent = meta.locked ? `${node.text}（已锁定）` : node.text;
    g.appendChild(title);

    // 调试叠加层：节点 id 与源码行号（指令 debug），浮于节点左上角上方
    if (meta.debug) {
      const debug = svgEl('text', {
        x: box.x,
        y: box.y - 4,
        class: 'mms-svg-debug',
      });
      debug.textContent = `${node.id} · L${node.lineNo}`;
      g.appendChild(debug);
    }

    // 折叠徽标：有子节点的节点均可折叠（指令 collapsed 给初始态，点击切换运行时覆盖态）。
    // 只产出 DOM 结构（is-collapsed class 即状态载体），点击由根上的委托 listener 分流
    if (meta.foldable && options.onToggleCollapse) {
      const anchor = foldAnchor(box, doc.layout);
      const fold = svgEl('g', { class: `mms-svg-fold${meta.collapsed ? ' is-collapsed' : ''}` });
      fold.appendChild(svgEl('circle', { cx: anchor.x, cy: anchor.y, r: 9 }));
      const foldText = svgEl('text', {
        x: anchor.x,
        y: anchor.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: 'mms-svg-fold-text',
      });
      foldText.textContent = meta.collapsed ? `+${meta.hiddenCount}` : '−';
      fold.appendChild(foldText);
      const title2 = svgEl('title');
      title2.textContent = meta.collapsed ? '展开子节点' : '折叠子节点';
      fold.appendChild(title2);
      g.appendChild(fold);
    }

    group.appendChild(g);
  }
  svg.appendChild(group);

  // 事件委托：根上单一 click listener，event.target.closest 反查节点。
  // 一个 listener 管全部节点，重渲染不需要重新绑定（规范 §10.10）
  if (options.onNodeClick || options.onToggleCollapse) {
    svg.classList.add('is-clickable');
    svg.addEventListener('click', (evt) => {
      const target = evt.target;
      if (!(target instanceof Element)) return;
      // 折叠徽标优先分流（徽标位于节点 g 内部，须先于节点分支判断）
      const fold = target.closest('.mms-svg-fold');
      if (fold) {
        if (options.onToggleCollapse) {
          const nodeId = fold.closest('[data-node-id]')?.getAttribute('data-node-id');
          if (nodeId) options.onToggleCollapse(nodeId, fold.classList.contains('is-collapsed'));
        }
        return;
      }
      if (!options.onNodeClick) return;
      const nodeG = target.closest('.mms-svg-node[data-node-id]');
      const nodeId = nodeG?.getAttribute('data-node-id');
      if (!nodeG || !nodeId) return;
      // locked 拦截：不触发选中（<title> 已提示「已锁定」，CSS 光标 not-allowed）
      if (nodeG.classList.contains('is-locked')) return;
      options.onNodeClick(nodeId);
    });
  }

  return svg;
}
