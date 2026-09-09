/**
 * @module render/shared/extensions
 * @description `!--` 指令的渲染期继承与语义→画法映射。
 *
 * 总原则：标准 key 只声明语义，不声明 CSS 属性；本模块负责语义到当前画法
 * （DOM 探索视图 / SVG 全景视图）的实现。KEY_RENDERERS 是规范 §10.7
 * 渲染兼容性映射表的代码化，与 core/parser/directive.ts 的
 * KNOWN_DIRECTIVE_KEYS 白名单同 PR 维护（DirectiveKey 联合类型保证覆盖完整）。
 *
 * 值校验：所有样式 value 经归一化器校验（防 CSS 注入），非法值不应用、静默忽略
 */

import { BEHAVIOR_DIRECTIVE_KEYS, KNOWN_DIRECTIVE_KEYS } from '../../core/parser/directive';
import type { IMmsNode, IParsedDoc } from '../../host/types';

/** 标准 key 联合类型：由白名单常量推导，编译期保证 KEY_RENDERERS 覆盖完整 */
export type DirectiveKey = (typeof KNOWN_DIRECTIVE_KEYS)[number];

// ------------------------------------------------------------ 值归一化器

/** 合法颜色：hex（3/4/6/8 位）、rgb()/rgba()/hsl()/hsla()、CSS 命名色 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+\s*)?\)|hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%\s*(,\s*[\d.]+\s*)?\)|[a-z]+)$/i;

/** 颜色值：合法原样返回，非法返回 null */
const normalizeColor = (raw: string): string | null => (COLOR_RE.test(raw.trim()) ? raw.trim() : null);

/** 透明度：0–1 数字（超界收敛到边界），非法返回 null */
const normalizeOpacity = (raw: string): string | null => {
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  return String(Math.min(Math.max(v, 0), 1));
};

/** 正数像素值（line-width），非法或 ≤ 0 返回 null */
const normalizeWidth = (raw: string): string | null => {
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return String(v);
};

/** 非负像素值（border-radius / rx），非法或 < 0 返回 null */
const normalizeRadius = (raw: string): string | null => {
  const v = Number.parseFloat(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  return String(v);
};

// ------------------------------------------------------------ KEY_RENDERERS

/** SVG 全景视图的落点：shape = 节点矩形、text = 文本、group = 节点整体 */
export type SvgApplyTarget = 'shape' | 'text' | 'group';

/** 单个 key 的渲染声明（语义 → 当前画法） */
export interface IKeyRenderer {
  /** 样式类参与样式映射；行为类接交互层（折叠状态机 / 调试叠加层 / 锁定） */
  kind: 'style' | 'behavior';
  /** DOM 探索视图：节点元素的 CSS 属性名；null = 不作用于节点元素 */
  domProp: string | null;
  /** SVG 全景视图：落点与属性名；null = 不作用于节点 */
  svg: { target: SvgApplyTarget; prop: string } | null;
  /** 值归一化器：非法返回 null（该条不应用）。行为类恒等返回 */
  normalize: (raw: string) => string | null;
}

/**
 * 渲染兼容性映射表（规范 §10.7）。行为类三个 key 接交互层，与画法无关，
 * 在表中无样式落点；line-color / line-width 作用于连线（两画法的连线均为 SVG
 * path，DOM 探索视图无对应的节点 CSS 属性）。同落点冲突时按本表声明顺序
 * 应用、后者覆盖前者（color 与 text-color 同落文字色，text-color 声明在后胜出）
 */
export const KEY_RENDERERS: Readonly<Record<DirectiveKey, IKeyRenderer>> = {
  'color': { kind: 'style', domProp: 'color', svg: { target: 'text', prop: 'fill' }, normalize: normalizeColor },
  'text-color': { kind: 'style', domProp: 'color', svg: { target: 'text', prop: 'fill' }, normalize: normalizeColor },
  'line-color': { kind: 'style', domProp: null, svg: null, normalize: normalizeColor },
  'line-width': { kind: 'style', domProp: null, svg: null, normalize: normalizeWidth },
  'border-radius': { kind: 'style', domProp: 'border-radius', svg: { target: 'shape', prop: 'rx' }, normalize: normalizeRadius },
  'background': { kind: 'style', domProp: 'background-color', svg: { target: 'shape', prop: 'fill' }, normalize: normalizeColor },
  'opacity': { kind: 'style', domProp: 'opacity', svg: { target: 'group', prop: 'opacity' }, normalize: normalizeOpacity },
  'collapsed': { kind: 'behavior', domProp: null, svg: null, normalize: (raw) => raw },
  'debug': { kind: 'behavior', domProp: null, svg: null, normalize: (raw) => raw },
  'locked': { kind: 'behavior', domProp: null, svg: null, normalize: (raw) => raw },
};

/** 按 KNOWN_DIRECTIVE_KEYS 声明顺序迭代的有效样式 key（应用顺序的单一依据） */
const STYLE_KEY_ORDER: readonly DirectiveKey[] = KNOWN_DIRECTIVE_KEYS.filter(
  (key) => KEY_RENDERERS[key as DirectiveKey].kind === 'style',
) as DirectiveKey[];

// ------------------------------------------------------------ 继承

/**
 * 解析节点的有效扩展（含继承）。
 *
 * - 自身的 extensions 全部生效（含行为类）
 * - 样式类 key 缺失时沿祖先链就近补齐：自身有值优先，其次父链最近者
 * - 行为类 key（见 BEHAVIOR_DIRECTIVE_KEYS）不继承——父级的 collapsed 不影响子级
 * - 多父节点（同名合并）取第一条父链
 * - `base`（文档级 extensions）作为最低优先级兜底：祖先链查完仍缺失的 key 从中补齐
 *
 * 不复制指令：每次调用即时求值，源节点的 extensions 不被修改
 */
export function resolveExtensions(
  node: IMmsNode,
  nodeMap: Map<string, IMmsNode>,
  base?: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = { ...(node.extensions ?? {}) };

  const visited = new Set<string>([node.id]);
  let parentId = node.parentIds[0];
  while (parentId !== undefined) {
    const parent = nodeMap.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);

    for (const [key, value] of Object.entries(parent.extensions ?? {})) {
      if (BEHAVIOR_DIRECTIVE_KEYS.includes(key)) continue;
      if (!(key in result)) result[key] = value;
    }
    parentId = parent.parentIds[0];
  }

  for (const [key, value] of Object.entries(base ?? {})) {
    if (BEHAVIOR_DIRECTIVE_KEYS.includes(key)) continue;
    if (!(key in result)) result[key] = value;
  }
  return result;
}

// ------------------------------------------------------------ 画法映射

/** DOM 探索视图：extensions → 节点元素的 inline CSS 声明集（行为类不出现） */
export function domNodeStyle(ext: Record<string, string>): Record<string, string> {
  const style: Record<string, string> = {};
  for (const key of STYLE_KEY_ORDER) {
    const renderer = KEY_RENDERERS[key];
    if (!renderer.domProp || !(key in ext)) continue;
    const value = renderer.normalize(ext[key]);
    if (value === null) continue;
    // DOM 长度值需要单位；SVG rx 走 svgNodeStyle，互不干扰
    style[renderer.domProp] = key === 'border-radius' ? `${value}px` : value;
  }
  return style;
}

/** SVG 全景视图：extensions → rect / text / g 三类落点的属性集（行为类不出现） */
export function svgNodeStyle(ext: Record<string, string>): {
  shape: Record<string, string>;
  text: Record<string, string>;
  group: Record<string, string>;
} {
  const shape: Record<string, string> = {};
  const text: Record<string, string> = {};
  const group: Record<string, string> = {};
  for (const key of STYLE_KEY_ORDER) {
    const renderer = KEY_RENDERERS[key];
    if (!renderer.svg || !(key in ext)) continue;
    const value = renderer.normalize(ext[key]);
    if (value === null) continue;
    if (renderer.svg.target === 'shape') shape[renderer.svg.prop] = value;
    else if (renderer.svg.target === 'text') text[renderer.svg.prop] = value;
    else group[renderer.svg.prop] = value;
  }
  return { shape, text, group };
}

/**
 * 连线样式覆盖：树边取子节点（to 端）的有效 extensions（含沿祖先链继承，
 * 因此父级声明的 line-color 会 styling 整个分支的连线）。
 * 返回 null = 无覆盖，走默认画法
 */
export function edgeStyleOf(ext: Record<string, string>): { stroke?: string; strokeWidth?: number } | null {
  let stroke: string | undefined;
  let strokeWidth: number | undefined;
  if ('line-color' in ext) {
    const v = KEY_RENDERERS['line-color'].normalize(ext['line-color']);
    if (v !== null) stroke = v;
  }
  if ('line-width' in ext) {
    const v = KEY_RENDERERS['line-width'].normalize(ext['line-width']);
    if (v !== null) strokeWidth = Number.parseFloat(v);
  }
  if (stroke === undefined && strokeWidth === undefined) return null;
  const result: { stroke?: string; strokeWidth?: number } = {};
  if (stroke !== undefined) result.stroke = stroke;
  if (strokeWidth !== undefined) result.strokeWidth = strokeWidth;
  return result;
}

/**
 * 行为类判定：key 的有效值为 `'true'` 时启用。
 * ext 应传 resolveExtensions 的结果（行为类不继承，仅自身声明生效）
 */
export function behaviorEnabled(ext: Record<string, string> | undefined, key: 'collapsed' | 'debug' | 'locked'): boolean {
  return ext?.[key] === 'true';
}

// ------------------------------------------------------------ 折叠剪枝

/** 折叠剪枝结果：裁剪后的节点映射与每个折叠节点隐藏的后代总数 */
export interface IPruneResult {
  map: Map<string, IMmsNode>;
  hiddenCounts: Map<string, number>;
}

/**
 * 折叠剪枝：从根出发深度优先，折叠节点的子孙不入布局。
 * 返回浅拷贝的节点映射（仅截断折叠节点的 childIds），原 nodeMap 不被修改；
 * 多父节点只要任一父链可见即保留。hiddenCounts 基于原始全树统计，
 * 供折叠徽标显示「+N」
 */
export function pruneCollapsed(
  rootId: string | null,
  nodeMap: Map<string, IMmsNode>,
  collapsedIds: ReadonlySet<string>,
): IPruneResult {
  const hiddenCounts = new Map<string, number>();

  /** 统计以 id 为根的整棵子树的后代总数（原始树，含折叠嵌套） */
  const countDescendants = (id: string, seen: Set<string>): number => {
    let total = 0;
    for (const childId of nodeMap.get(id)?.childIds ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      total += 1 + countDescendants(childId, seen);
    }
    return total;
  };
  for (const id of collapsedIds) {
    if (nodeMap.has(id)) hiddenCounts.set(id, countDescendants(id, new Set([id])));
  }

  const map = new Map<string, IMmsNode>();
  const visit = (id: string): void => {
    if (map.has(id)) return;
    const node = nodeMap.get(id);
    if (!node) return;
    // 布局只读 childIds：未折叠节点直接复用引用，折叠节点浅拷贝截断子列表
    map.set(id, collapsedIds.has(id) ? { ...node, childIds: [] } : node);
    if (collapsedIds.has(id)) return;
    for (const childId of node.childIds) visit(childId);
  };
  if (rootId !== null) visit(rootId);

  return { map, hiddenCounts };
}

// ------------------------------------------------------------ 渲染期运行时

/** 单个节点的指令渲染聚合（画法无关部分，DOM / SVG 各自再算样式映射） */
export interface INodeDirectiveMeta {
  /** 含继承的有效 extensions（行为类仅自身） */
  ext: Record<string, string>;
  locked: boolean;
  debug: boolean;
  /** 原始全树上有子节点（无论是否折叠）才显示折叠徽标；auto 补齐节点
   *  无真实声明行、无法写回文档指令，不提供折叠 */
  foldable: boolean;
  collapsed: boolean;
  hiddenCount: number;
}

/** 渲染期指令运行时：探索视图与全景视图共用 */
export interface IDirectiveRuntime {
  /** 各节点的有效 extensions（含文档级兜底） */
  readonly extOf: ReadonlyMap<string, Record<string, string>>;
  /** 有效折叠态集合（指令初始态 + 视图层运行时覆盖） */
  readonly collapsedIds: ReadonlySet<string>;
  /** 各折叠节点隐藏的后代总数（基于原始全树） */
  readonly hiddenCounts: ReadonlyMap<string, number>;
  metaOf(node: IMmsNode): INodeDirectiveMeta;
  /** 树边样式覆盖：传子节点（to 端）id */
  edgeStyle(toId: string): { stroke?: string; strokeWidth?: number } | null;
}

/**
 * 构建渲染期指令运行时。overrides 为注入的折叠态覆盖（优先于指令初始态）；
 * 视图层不再持有——折叠徽标点击直接写回文档 collapsed 指令行（见 main.ts），
 * 参数保留供测试与外部注入
 */
export function createDirectiveRuntime(
  doc: IParsedDoc,
  overrides?: ReadonlyMap<string, boolean>,
): IDirectiveRuntime {
  const extOf = new Map<string, Record<string, string>>();
  for (const node of doc.nodes) {
    extOf.set(node.id, resolveExtensions(node, doc.nodeMap, doc.extensions));
  }

  const collapsedIds = new Set<string>();
  for (const node of doc.nodes) {
    const override = overrides?.get(node.id);
    const collapsed = override !== undefined ? override : behaviorEnabled(extOf.get(node.id), 'collapsed');
    if (collapsed) collapsedIds.add(node.id);
  }

  const hiddenCounts = pruneCollapsed(doc.rootId, doc.nodeMap, collapsedIds).hiddenCounts;

  return {
    extOf,
    collapsedIds,
    hiddenCounts,
    metaOf(node: IMmsNode): INodeDirectiveMeta {
      const ext = extOf.get(node.id) ?? {};
      const raw = doc.nodeMap.get(node.id);
      return {
        ext,
        locked: behaviorEnabled(ext, 'locked'),
        debug: behaviorEnabled(ext, 'debug'),
        foldable: !!raw && !raw.isAutoFix && raw.childIds.length > 0,
        collapsed: collapsedIds.has(node.id),
        hiddenCount: hiddenCounts.get(node.id) ?? 0,
      };
    },
    edgeStyle: (toId: string) => edgeStyleOf(extOf.get(toId) ?? {}),
  };
}
