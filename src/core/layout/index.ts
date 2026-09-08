/**
 * @module core/layout
 * @description 树形布局计算：先量文字定矩形，再按树形排坐标。探索视图（DOM）与全景视图（SVG）共用
 */

import type {
  ILayoutEdge,
  ILayoutNode,
  ILayoutOptions,
  ILayoutResult,
  IMmsNode,
} from '../../host/types';

export const DEFAULT_LAYOUT_OPTIONS: ILayoutOptions = {
  direction: 'LR',
  nodeGap: 16,
  levelGap: 64,
};

const NODE_PADDING_X = 14;
const NODE_PADDING_Y = 10;
/** 节点最小主轴尺寸，避免空文字 / 极短文字节点塌成线 */
const MIN_MAIN = 80;
const BASE_CROSS = 32;
const LINE_CROSS = 18;
const MAX_CONTENT_LINES = 2;
const FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_SIZE = 13;
const CONTENT_FONT_SIZE = 11;
const BADGE_FONT_SIZE = 10;
const NODE_BORDER = 2;

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

/** 字体属性集合（与 .mms-dom-node / .mms-svg-text 保持视觉一致） */
const TEXT_FONT = `400 500 ${FONT_SIZE}px ${FONT_FAMILY}`;
const CONTENT_FONT = `400 400 ${CONTENT_FONT_SIZE}px ${FONT_FAMILY}`;
const BADGE_FONT = `400 400 ${BADGE_FONT_SIZE}px ${FONT_FAMILY}`;

/**
 * 测量文字宽度。浏览器环境用 canvas.measureText，
 * Node 测试环境降级为「宽字符全宽、其余 0.55 倍」的启发式
 */
export function measureTextWidth(text: string, font: string): number {
  const ctx = getMeasureCtx();
  if (ctx) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  const WIDE = /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/;
  const size = parseFloat(font) || FONT_SIZE;
  let width = 0;
  for (const ch of text) width += WIDE.test(ch) ? size : size * 0.55;
  return width;
}

/** 估算节点矩形尺寸：text / content / badge 各行取最宽，再加 padding */
function measure(node: IMmsNode): { width: number; height: number } {
  const textWidth = measureTextWidth(node.isAutoFix ? '（自动补齐）' : node.text, TEXT_FONT);
  let contentMaxWidth = 0;
  for (let i = 0; i < Math.min(node.content.length, MAX_CONTENT_LINES); i++) {
    const w = measureTextWidth(node.content[i], CONTENT_FONT);
    if (w > contentMaxWidth) contentMaxWidth = w;
  }
  const badgeCount = node.embeds.length + node.crossRefs.length;
  const badgeWidth = badgeCount > 0
    ? node.embeds.reduce((acc, e) => acc + measureTextWidth(`${e.target} `, BADGE_FONT) + 24, 0) +
      node.crossRefs.reduce((acc, r) => acc + measureTextWidth(`REF ${r.rawTarget} `, BADGE_FONT) + 24, 0)
    : 0;

  const innerWidth = Math.max(textWidth, contentMaxWidth, badgeWidth);
  const width = Math.max(innerWidth + NODE_PADDING_X * 2 + NODE_BORDER, MIN_MAIN);

  const lines = 1 + Math.min(node.content.length, MAX_CONTENT_LINES) + (badgeCount > 0 ? 1 : 0);
  const height = Math.max(
    NODE_PADDING_Y * 2 + FONT_SIZE * 1.4 +
    (lines - 1) * LINE_CROSS +
    NODE_BORDER,
    BASE_CROSS,
  );
  return { width, height };
}

/**
 * 计算思维导图布局坐标。
 *
 * 合并节点会有多个父节点，这里只沿第一个父节点参与树形排布，
 * 其余父节点关系作为跨边渲染，避免同一节点被摆放两次
 */
export function layoutTree(
  rootId: string | null,
  nodeMap: Map<string, IMmsNode>,
  options: Partial<ILayoutOptions> = {},
): ILayoutResult {
  const opts: ILayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...options };
  const nodes = new Map<string, ILayoutNode>();
  const edges: ILayoutEdge[] = [];

  if (!rootId || !nodeMap.has(rootId)) {
    return { nodes, edges, width: 0, height: 0 };
  }

  const sizes = new Map<string, { width: number; height: number }>();
  for (const node of nodeMap.values()) sizes.set(node.id, measure(node));

  /** 主轴 = 层级推进方向（TB 时为 y），交叉轴 = 兄弟排列方向 */
  const mainOf = (size: { width: number; height: number }): number =>
    opts.direction === 'TB' ? size.height : size.width;
  const crossOf = (size: { width: number; height: number }): number =>
    opts.direction === 'TB' ? size.width : size.height;

  /** 每层的主轴最大尺寸，用于算层级偏移 */
  const levelMain: number[] = [];
  const visited = new Set<string>();
  const parentOf = new Map<string, string>();

  const walk = (id: string, depth: number): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const size = sizes.get(id);
    if (size) {
      const mainSize = mainOf(size);
      levelMain[depth] = Math.max(levelMain[depth] ?? 0, mainSize);
      for (const childId of nodeMap.get(id)?.childIds ?? []) {
        if (!nodeMap.has(childId)) continue;
        if (!visited.has(childId)) parentOf.set(childId, id);
        edges.push({ from: id, to: childId, kind: 'tree' });
        walk(childId, depth + 1);
      }
    }
  };
  walk(rootId, 0);

  const levelOffset: number[] = [];
  let acc = 0;
  for (let d = 0; d < levelMain.length; d++) {
    levelOffset[d] = acc;
    acc += (levelMain[d] ?? 0) + opts.levelGap;
  }
  const totalMain = Math.max(acc - opts.levelGap, 0);

  /** 后序累加子树在交叉轴上占用的总长度 */
  const subtree = new Map<string, number>();
  const computeSubtree = (id: string): number => {
    const size = sizes.get(id);
    if (!size) return 0;
    const own = crossOf(size);
    const children = (nodeMap.get(id)?.childIds ?? []).filter((c) => parentOf.get(c) === id);
    if (children.length === 0) {
      subtree.set(id, own);
      return own;
    }
    let total = 0;
    for (const childId of children) total += computeSubtree(childId) + opts.nodeGap;
    const value = Math.max(own, total - opts.nodeGap);
    subtree.set(id, value);
    return value;
  };
  computeSubtree(rootId);

  let maxCross = 0;
  const place = (id: string, depth: number, crossStart: number): void => {
    const size = sizes.get(id);
    if (!size) return;
    const own = subtree.get(id) ?? crossOf(size);
    const crossCenter = crossStart + own / 2;
    const children = (nodeMap.get(id)?.childIds ?? []).filter((c) => parentOf.get(c) === id);

    const mainOffset = levelOffset[depth] ?? 0;
    const w = size.width;
    const h = size.height;
    let x: number;
    let y: number;
    if (opts.direction === 'TB') {
      x = crossCenter - w / 2;
      y = mainOffset;
    } else if (opts.direction === 'RL') {
      x = totalMain - mainOffset - w;
      y = crossCenter - h / 2;
    } else {
      x = mainOffset;
      y = crossCenter - h / 2;
    }

    nodes.set(id, { id, x, y, width: w, height: h, depth });
    maxCross = Math.max(maxCross, crossCenter + crossOf(size) / 2);

    let cursor = crossStart;
    for (const childId of children) {
      const childSize = subtree.get(childId) ?? 0;
      place(childId, depth + 1, cursor);
      cursor += childSize + opts.nodeGap;
    }
  };
  place(rootId, 0, 0);

  for (const node of nodeMap.values()) {
    for (const ref of node.crossRefs) {
      if (!ref.resolved) continue;
      if (!nodes.has(ref.targetNodeId)) continue;
      edges.push({ from: node.id, to: ref.targetNodeId, kind: 'cross', label: ref.label });
    }
  }

  return opts.direction === 'TB'
    ? { nodes, edges, width: maxCross, height: totalMain }
    : { nodes, edges, width: totalMain, height: maxCross };
}
