/**
 * @module core/parser/directive
 * @description `!--` 指令行的解析与第二遍回填。
 * 分流优先级低于 `#` / `--` / `<=>` / `::` / `![[` / `**`：仅当上述前缀全部
 * 不匹配且行首（trim 后）为 `!--` 时才进入指令解析（分流本体在 body.ts）。
 *
 * 行格式：`!-- [key] > [value] <-- [目标] <** 行尾注释`
 * 解析顺序：剥注释 → 切目标 → 切 kv → 解析目标
 */

import type { IDirectiveBinding, IMmsNode } from '../../host/types';

/** 指令行前缀（行首 trim 后匹配） */
export const DIRECTIVE_PREFIX = '!--';
/** 行尾注释起始标记：首个 `<**` 到行尾整段丢弃（含其后的 `<--`） */
export const LINE_COMMENT_MARK = '<**';
/** 目标分隔标记：首个 `<--` 左右切分，右侧为空视同无目标（默认绑定） */
export const TARGET_SEP = '<--';

/**
 * 标准 key 白名单（规范 §10.7 为唯一权威来源）。只声明语义不声明 CSS 属性，
 * 渲染映射见 render/shared/extensions.ts 的 KEY_RENDERERS（同置一处、同步维护）。
 * 清单外 key 一律记 `directive-unknown-key` 警告且不存储
 */
export const KNOWN_DIRECTIVE_KEYS: readonly string[] = [
  'color',
  'text-color',
  'line-color',
  'line-width',
  'border-radius',
  'background',
  'opacity',
  'collapsed',
  'debug',
  'locked',
];

/**
 * 行为类 key 清单（标准 key 清单的子集，规范 §7 为唯一权威来源）。
 * 行为类 value 在比较前 trim 且不区分大小写（空 value 归 `'true'`），
 * 且不参与渲染期的祖先链继承（见 render/shared/extensions.ts）。
 * 三个行为 key 接交互层（折叠状态机 / 调试叠加层 / 锁定），与画法无关
 */
export const BEHAVIOR_DIRECTIVE_KEYS: readonly string[] = ['collapsed', 'debug', 'locked'];

/** 待回填的一条指令：第一遍主循环收集，第二遍统一回填（支持前向引用） */
export interface PendingDirective {
  /** 指令行号（1 起），冲突裁决的先后依据 */
  lineNo: number;
  /** 归一化后的 key */
  key: string;
  /** 行为类已归一（trim + 小写，空 → 'true'）；样式类仅 trim */
  value: string;
  /** `<--` 右侧的目标原文；null = 默认绑定 */
  targetRaw: string | null;
  /** 默认绑定的目标节点 id（上方最近节点声明行）；null = 孤儿（挂文档级） */
  boundOwnerId: string | null;
}

/** 指令行解析结果 */
export interface ParsedDirectiveLine {
  key: string;
  value: string;
  targetRaw: string | null;
}

/** 目标寻址规格：`[#+] 节点文本`，# 个数对应节点层级（1 起） */
export interface DirectiveTargetSpec {
  /** null = 未带 # 前缀，层级不限；N = 寻址第 N 层（`##` → 2） */
  hashCount: number | null;
  text: string;
}

/** 剥离行尾注释：首个 `<**` 起到行尾整段丢弃，返回剩余部分（不 trim） */
export function stripLineComment(text: string): string {
  const idx = text.indexOf(LINE_COMMENT_MARK);
  return idx >= 0 ? text.slice(0, idx) : text;
}

/** 归一化指令 key：trim → 连续空白折叠为单个 `-` → 小写（`line color` → `line-color`） */
export function normalizeDirectiveKey(raw: string): string {
  return raw.trim().replace(/\s+/g, '-').toLowerCase();
}

/**
 * 归一化指令 value。行为类：trim + 小写，空归 `'true'`，其余非 `'false'`
 * 值一律按 `'true'` 处理（布尔语义，只认 false）；样式类：仅 trim，
 * 区分大小写（颜色值等原样保留），空存 `''`
 */
export function normalizeDirectiveValue(key: string, raw: string): string {
  const trimmed = raw.trim();
  if (!BEHAVIOR_DIRECTIVE_KEYS.includes(key)) return trimmed;
  if (!trimmed) return 'true';
  return trimmed.toLowerCase() === 'false' ? 'false' : 'true';
}

/**
 * 解析一条指令行（调用方需已确认该行 trim 后以 `!--` 开头）。
 * 无有效 key（`!--` 或 `!-- > 值`）返回 null，静默忽略
 */
export function parseDirectiveLine(line: string): ParsedDirectiveLine | null {
  // 1. 剥注释：首个 <** 到行尾丢弃（其后即使有 <-- 也一并丢弃）
  const stripped = stripLineComment(line).trim().slice(DIRECTIVE_PREFIX.length);

  // 2. 切目标：第一个 <-- 为界；右侧为空视同无目标（默认绑定）
  const sepAt = stripped.indexOf(TARGET_SEP);
  let kvPart = stripped;
  let targetRaw: string | null = null;
  if (sepAt >= 0) {
    kvPart = stripped.slice(0, sepAt);
    const right = stripped.slice(sepAt + TARGET_SEP.length).trim();
    if (right) targetRaw = right;
  }

  // 3. 切 kv：左半段按第一个 > 切分；value 中的其余 > 原样保留
  const gtAt = kvPart.indexOf('>');
  const rawKey = gtAt >= 0 ? kvPart.slice(0, gtAt) : kvPart;
  const rawValue = gtAt >= 0 ? kvPart.slice(gtAt + 1) : '';

  const key = normalizeDirectiveKey(rawKey);
  if (!key) return null;
  return { key, value: normalizeDirectiveValue(key, rawValue), targetRaw };
}

/** 解析 `<--` 目标段：`[#+] 节点文本`。`#` 后必须有空格，否则整段按纯文本处理 */
export function parseDirectiveTarget(raw: string): DirectiveTargetSpec {
  const m = /^(#+)\s+(.+)$/.exec(raw);
  if (m) return { hashCount: m[1].length, text: m[2].trim() };
  return { hashCount: null, text: raw.trim() };
}

/**
 * 节点的声明层级（1 起）：heading 按声明符号数（`## X` 是第 2 层，
 * 缺根降级不改变声明层级），child 按结构层级（depth + 1）。
 * 两类节点在同一层可被同一 `#` 前缀寻址
 */
export function directiveTargetLevel(
  node: IMmsNode,
  declaredLevels: ReadonlyMap<number, number>,
): number {
  return declaredLevels.get(node.lineNo) ?? node.depth + 1;
}

/**
 * 全文档扫描寻址：层级（带 # 前缀时精确匹配）+ 节点文本 trim 后精确匹配
 * （区分大小写）的候选中，取与指令行行号距离最小者（不区分上下方向）；
 * 距离相同取文档序靠前者。auto 补齐节点不参与寻址
 */
export function findDirectiveTarget(
  nodes: readonly IMmsNode[],
  declaredLevels: ReadonlyMap<number, number>,
  spec: DirectiveTargetSpec,
  directiveLineNo: number,
): IMmsNode | null {
  let best: IMmsNode | null = null;
  let bestDist = Infinity;
  for (const node of nodes) {
    if (node.isAutoFix) continue;
    if (spec.hashCount !== null && directiveTargetLevel(node, declaredLevels) !== spec.hashCount) continue;
    if (node.text !== spec.text) continue;
    const dist = Math.abs(node.lineNo - directiveLineNo);
    // 严格小于才覆盖：同距时先遍历到（文档序靠前）者胜出
    if (dist < bestDist) {
      best = node;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * 第二遍回填：寻址 + 冲突裁决。pending 按行号顺序处理，
 * 同一容器上同一 key 保留先写者，后到者记 `directive-conflict` 警告；
 * 目标寻址失败记 `directive-target-missing` 警告，该条指令不绑定。
 * 传入 bindings 数组时，成功绑定的指令按序写入（供 UI 写回文档定位指令行）
 */
export function resolveDirectives(
  pendingDirectives: readonly PendingDirective[],
  nodes: readonly IMmsNode[],
  nodeMap: Map<string, IMmsNode>,
  declaredLevels: ReadonlyMap<number, number>,
  docExtensions: Record<string, string>,
  warn: (
    type: 'directive-target-missing' | 'directive-conflict',
    severity: 'warning',
    message: string,
    lineNo?: number,
    autoFixed?: boolean,
  ) => void,
  bindings?: IDirectiveBinding[],
): void {
  for (const pending of pendingDirectives) {
    let ext: Record<string, string>;
    let nodeId: string | null = null;

    if (pending.targetRaw !== null) {
      const spec = parseDirectiveTarget(pending.targetRaw);
      const hit = findDirectiveTarget(nodes, declaredLevels, spec, pending.lineNo);
      if (!hit) {
        warn(
          'directive-target-missing',
          'warning',
          `指令目标 "${pending.targetRaw}" 不存在，指令 "${pending.key}" 未绑定`,
          pending.lineNo,
          false,
        );
        continue;
      }
      if (!hit.extensions) hit.extensions = {};
      ext = hit.extensions;
      nodeId = hit.id;
    } else if (pending.boundOwnerId !== null) {
      const owner = nodeMap.get(pending.boundOwnerId);
      if (!owner) continue;
      if (!owner.extensions) owner.extensions = {};
      ext = owner.extensions;
      nodeId = owner.id;
    } else {
      ext = docExtensions;
    }

    if (Object.prototype.hasOwnProperty.call(ext, pending.key)) {
      warn(
        'directive-conflict',
        'warning',
        `重复的指令 key "${pending.key}"，保留先写者`,
        pending.lineNo,
        false,
      );
      continue;
    }
    ext[pending.key] = pending.value;
    bindings?.push({ key: pending.key, lineNo: pending.lineNo, nodeId });
  }
}
