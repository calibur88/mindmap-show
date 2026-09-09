/**
 * @module render/shared/edges
 * @description 连线路径与连线层 SVG 构造。探索视图与全景视图共用同一套画法
 *
 * 三种样式由 frontmatter 的 `mms_line` 决定：
 * - `line`：起终点直接线性插值
 * - `curve`：带几何约束的三次贝塞尔曲线，控制点推力由「安全推力 h」推导
 * - `elbow`：直角折线，先沿流向轴走到中线，再沿展开轴平移，最后落点到子节点
 */

import type { ILayoutEdge, ILayoutNode, ILayoutResult, MmsLayout, MmsLineStyle } from '../../host/types';
import { svgEl } from '../../utils/dom';

/** 连线几何参数。四个方向共用，垂直/水平由 direction 推导 */
export interface IEdgeGeometry {
  direction: MmsLayout;
  lineStyle: MmsLineStyle;
  /** 用户预设间距 `H0`（流向轴），作为安全推力 h 的上限 */
  gap: number;
}

/** 安全推力下限（像素），保证任意连线都看得出走向 */
const MIN_PUSH = 5;
/** 正对直连（展开轴位移为 0）时的最小鼓起幅度 */
const MIN_STRAIGHT_BULGE = 25;
/** 控制点推力相对展开轴位移的最大占比，超过会出现回环与尖刺 */
const SPREAD_RATIO = 0.45;
/** 极限陡坡判定倍数：流向轴位移超过展开轴位移的该倍数时增压 */
const STEEP_FACTOR = 3;
/** 极限陡坡时推力相对流向轴位移的占比 */
const STEEP_RATIO = 0.18;

/** 保留两位小数，避免 SVG 里出现长浮点串 */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * 计算一条连线的路径。
 *
 * 锚点取父子节点相对的那条边的中点：
 * `TB` 父下中→子上中、`BT` 父上中→子下中、`LR` 父右中→子左中、`RL` 父左中→子右中
 */
export function buildEdgePath(from: ILayoutNode, to: ILayoutNode, geo: IEdgeGeometry): string {
  const vertical = geo.direction === 'TB' || geo.direction === 'BT';
  // BT / RL 是把主轴翻转的两个方向：出边点取节点的上边 / 左边
  const flipped = geo.direction === 'BT' || geo.direction === 'RL';

  const x0 = vertical ? from.x + from.width / 2 : flipped ? from.x : from.x + from.width;
  const y0 = vertical ? (flipped ? from.y : from.y + from.height) : from.y + from.height / 2;
  const x3 = vertical ? to.x + to.width / 2 : flipped ? to.x + to.width : to.x;
  const y3 = vertical ? (flipped ? to.y + to.height : to.y) : to.y + to.height / 2;

  if (geo.lineStyle === 'line') {
    return `M ${n(x0)} ${n(y0)} L ${n(x3)} ${n(y3)}`;
  }

  if (geo.lineStyle === 'elbow') {
    // 直角折线：垂直布局先竖后横，水平布局先横后竖，拐点取两轴中线
    return vertical
      ? `M ${n(x0)} ${n(y0)} L ${n(x0)} ${n((y0 + y3) / 2)} L ${n(x3)} ${n((y0 + y3) / 2)} L ${n(x3)} ${n(y3)}`
      : `M ${n(x0)} ${n(y0)} L ${n((x0 + x3) / 2)} ${n(y0)} L ${n((x0 + x3) / 2)} ${n(y3)} L ${n(x3)} ${n(y3)}`;
  }

  // 展开轴位移：垂直布局看 x，水平布局看 y；流向轴位移取另一轴
  const spread = vertical ? x3 - x0 : y3 - y0;
  const flow = vertical ? y3 - y0 : x3 - x0;
  const absSpread = Math.abs(spread);
  const absFlow = Math.abs(flow);

  let h = Math.max(MIN_PUSH, Math.min(geo.gap, absSpread * SPREAD_RATIO));
  if (spread === 0) h = Math.max(h, MIN_STRAIGHT_BULGE);
  else if (absFlow > STEEP_FACTOR * absSpread) h = Math.max(h, absFlow * STEEP_RATIO);

  const s = spread === 0 ? 1 : spread > 0 ? 1 : -1;

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  if (vertical) {
    const ym = (y0 + y3) / 2;
    x1 = x0 + s * h;
    y1 = ym;
    x2 = x3 - s * h;
    y2 = ym;
  } else {
    const xm = (x0 + x3) / 2;
    x1 = xm;
    y1 = y0 + s * h;
    x2 = xm;
    y2 = y3 - s * h;
  }

  return `M ${n(x0)} ${n(y0)} C ${n(x1)} ${n(y1)} ${n(x2)} ${n(y2)} ${n(x3)} ${n(y3)}`;
}

/** 连线层构造参数 */
export interface IBuildEdgesOptions extends IEdgeGeometry {
  width: number;
  height: number;
  /** 树边线宽（像素） */
  treeLineWidth: number;
  /** 跨文件引用虚线线宽（像素） */
  crossLineWidth: number;
}

/**
 * 构造连线层 SVG。
 * 线宽与颜色走 inline 属性而非 CSS 类，避免深浅主题下变量失效看不见
 */
export function buildEdgesSvg(layout: ILayoutResult, options: IBuildEdgesOptions): SVGSVGElement {
  const svg = svgEl('svg', {
    class: 'mms-edges',
    width: options.width,
    height: options.height,
    viewBox: `0 0 ${options.width} ${options.height}`,
  });

  for (const edge of layout.edges as ILayoutEdge[]) {
    const from = layout.nodes.get(edge.from);
    const to = layout.nodes.get(edge.to);
    if (!from || !to) continue;

    const isCross = edge.kind === 'cross';
    const attr: Record<string, string | number> = {
      d: buildEdgePath(from, to, options),
      fill: 'none',
      stroke: isCross ? '#7f9cf5' : '#7a7a72',
      'stroke-width': isCross ? options.crossLineWidth : options.treeLineWidth,
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

/** 连线渲染参数，探索视图与全景视图的 render 入口共用 */
export interface ILineRenderOptions {
  /** 树边线宽（像素），从 settings 传入 */
  lineWidth: number;
  /** 跨文件引用虚线线宽（像素） */
  crossLineWidth: number;
  /** 连线样式，来自 frontmatter 的 `mms_line` */
  lineStyle: MmsLineStyle;
}
