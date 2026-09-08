/**
 * @module render/shared/edges
 * @description 连线 SVG 构造。探索视图与全景视图共用同一套连线画法
 *
 * 直角折线：LR/RL 走横线 + 纵线，TB 走纵线 + 横线；锚点是节点边中点，避免贴边
 */

import type { ILayoutEdge, ILayoutNode, ILayoutResult, MmsLayout } from '../../host/types';
import { svgEl } from '../../utils/dom';

/**
 * 生成一条直角折线。起点 = 父节点指向子节点那条边的中点，
 * 终点 = 子节点指向父节点那条边的中点
 */
function edgePath(from: ILayoutNode, to: ILayoutNode, direction: MmsLayout): string {
  // 父节点的出点：LR 走右中、RL 走左中、TB 走下中
  const fx = direction === 'RL' ? from.x : from.x + from.width;
  const fy = direction === 'TB' ? from.y + from.height : from.y + from.height / 2;
  // 子节点的入点：LR 走左中、RL 走右中、TB 走上中
  const tx = direction === 'RL' ? to.x + to.width : to.x;
  const ty = direction === 'TB' ? to.y : to.y + to.height / 2;

  if (direction === 'TB') {
    const midY = (fy + ty) / 2;
    return `M ${fx} ${fy} L ${fx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`;
  }
  const midX = (fx + tx) / 2;
  return `M ${fx} ${fy} L ${midX} ${fy} L ${midX} ${ty} L ${tx} ${ty}`;
}

/**
 * 构造连线层 SVG。
 * 线宽与颜色走 inline 属性而非 CSS 类，避免深浅主题下变量失效看不见
 */
export function buildEdgesSvg(
  layout: ILayoutResult,
  direction: MmsLayout,
  width: number,
  height: number,
  treeLineWidth: number,
  crossLineWidth: number,
): SVGSVGElement {
  const svg = svgEl('svg', {
    class: 'mms-edges',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });

  for (const edge of layout.edges as ILayoutEdge[]) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    if (!from || !to) continue;

    const isCross = edge.kind === 'cross';
    const attr: Record<string, string | number> = {
      d: edgePath(from, to, direction),
      fill: 'none',
      stroke: isCross ? '#7f9cf5' : '#7a7a72',
      'stroke-width': isCross ? crossLineWidth : treeLineWidth,
      'stroke-linecap': 'round',
      'stroke-opacity': isCross ? 0.85 : 0.9,
    };
    if (isCross) attr['stroke-dasharray'] = '6 4';
    const path = svgEl('path', attr);
    if (edge.label) {
      path.appendChild(svgEl('title')).textContent = edge.label;
    }
    svg.appendChild(path);
  }

  return svg;
}
