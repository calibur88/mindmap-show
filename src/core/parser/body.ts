/**
 * @module core/parser/body
 * @description 层级解析器。只接收剥离 Frontmatter 后的纯正文，完全不感知 Frontmatter
 */

import type { IDirectiveBinding, ICrossRef, IMmsNode, INodeRef, IWarning } from '../../host/types';
import { makeNodeId, normalizeText, parseNodeRefTarget, parseRefTarget, shortNodeName } from '../../utils/make-key';
import { extractEmbeds, isExternalUrlLine } from './embed';
import { DIRECTIVE_PREFIX, KNOWN_DIRECTIVE_KEYS, parseDirectiveLine, resolveDirectives, stripLineComment, type PendingDirective } from './directive';

const HEADING_RE = /^(#{1,})\s+(.*)$/;
const CHILD_RE = /^--\s+(.*)$/;
const REF_RE = /^<=>\s*(.*)$/;
// `::` 节点引用（点对点定位，不建边）
const NODEREF_RE = /^::\s*(.*)$/;
// 注释行：`** ` 后至少一个空格才合法；`**文本`（紧贴）保留为正文，避免和加粗语法歧义
const ANNOTATION_RE = /^\*\*\s+(.*)$/;
/** 目标列表与备注之间的分隔：Tab 或两个以上空格 */
const REF_LABEL_SEP = /\t|\s{2,}/;

export interface BodyParseResult {
  nodes: IMmsNode[];
  nodeMap: Map<string, IMmsNode>;
  rootId: string | null;
  /** 文档级指令（首个节点声明之前的孤儿指令的落点） */
  extensions: Record<string, string>;
  /** 成功绑定的指令行索引（按文档序），供 UI 写回文档定位指令行 */
  directiveBindings: IDirectiveBinding[];
}

interface PendingRef {
  ownerId: string;
  lineNo: number;
  rawTargets: string;
  label: string;
}

interface PendingNodeRef {
  ownerId: string;
  lineNo: number;
  rawTarget: string;
}

/**
 * 将纯正文解析为节点树。非致命问题只写入 warnings，不抛异常
 *
 * @param startLine - body 第一行在源文件中的行号（1 起）
 * @param docName - 兜底根节点名，正文首行就是 `--` 时使用
 */
export function parseBody(
  body: string,
  filePath: string,
  startLine: number,
  docName: string,
  warnings: IWarning[],
): BodyParseResult {
  const nodeMap = new Map<string, IMmsNode>();
  const order: string[] = [];
  const pendingRefs: PendingRef[] = [];
  const pendingNodeRefs: PendingNodeRef[] = [];
  const pendingDirectives: PendingDirective[] = [];
  const docExtensions: Record<string, string> = {};
  /** heading 行号 → 声明 `#` 个数：指令寻址的层级匹配依据（缺根降级不改变声明层级） */
  const declaredLevels = new Map<number, number>();
  /** pathStack[d] 保存当前路径上 depth 为 d 的节点 */
  const pathStack: IMmsNode[] = [];

  let lastHeading: IMmsNode | null = null;
  let current: IMmsNode | null = null;
  let rootId: string | null = null;

  const warn = (
    type: IWarning['type'],
    severity: IWarning['severity'],
    message: string,
    lineNo?: number,
    autoFixed = false,
  ): void => {
    warnings.push({ type, severity, message, filePath, lineNo, autoFixed });
  };

  const attach = (parent: IMmsNode | null, node: IMmsNode): void => {
    if (!parent) return;
    if (!node.parentIds.includes(parent.id)) node.parentIds.push(parent.id);
    if (!parent.childIds.includes(node.id)) parent.childIds.push(node.id);
  };

  const createNode = (
    parent: IMmsNode | null,
    text: string,
    type: IMmsNode['type'],
    depth: number,
    lineNo: number,
  ): IMmsNode => {
    const id = makeNodeId(parent ? parent.id : null, text);
    const existing = nodeMap.get(id);

    if (existing) {
      attach(parent, existing);
      warn('duplicate-merge', 'info', `节点 "${shortNodeName(id)}" 在同一父节点下重复，已合并`, lineNo, true);
      return existing;
    }

    const node: IMmsNode = {
      id,
      text: normalizeText(text),
      type,
      depth,
      lineNo,
      content: [],
      annotation: [],
      childIds: [],
      parentIds: [],
      crossRefs: [],
      nodeRefs: [],
      incomingRefs: [],
      embeds: [],
      sourceFilePath: filePath,
      isAutoFix: false,
      extensions: {},
    };
    attach(parent, node);
    nodeMap.set(id, node);
    order.push(id);
    return node;
  };

  const lines = body.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNo = startLine + i;
    const line = lines[i];

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const rawDepth = heading[1].length - 1;
      declaredLevels.set(lineNo, heading[1].length);
      const text = stripLineComment(heading[2]).trim();
      let depth = rawDepth;

      if (pathStack.length === 0) {
        // 没有 # 根节点时，取第一个遇到的标题为根
        if (depth > 0) {
          warn('no-root', 'warning', `文件缺少 # 根节点，已将首个标题 "${text}" 作为根`, lineNo, true);
          depth = 0;
        }
      } else if (depth > pathStack.length) {
        const from = pathStack.length - 1;
        warn('level-skip', 'info', `层级从 ${from} 跳到 ${depth - 1}，缺失层级已自动补空节点`, lineNo, true);
        while (pathStack.length < depth) {
          const parent = pathStack[pathStack.length - 1] ?? null;
          const filler = createNode(parent, '', 'auto', pathStack.length, lineNo);
          filler.isAutoFix = true;
          pathStack.push(filler);
        }
      }

      // 画布只从 rootId 起遍历：出现第二个根级标题时，其子树会整体不可见，必须显式告知
      if (depth === 0 && rootId !== null) {
        warn('no-root', 'warning', `多个根级标题：仅渲染首个根的子树，"${text}" 分支不显示`, lineNo, false);
      }

      const parent = depth === 0 ? null : pathStack[depth - 1] ?? null;
      const node = createNode(parent, text, 'heading', depth, lineNo);
      pathStack.length = depth;
      pathStack[depth] = node;
      lastHeading = node;
      current = node;
      if (rootId === null) rootId = node.id;
      continue;
    }

    const child = CHILD_RE.exec(line);
    if (child) {
      const childText = stripLineComment(child[1]).trim();
      let parent: IMmsNode | null = lastHeading;
      if (!parent) {
        warn('missing-parent', 'warning', `-- 节点 "${childText}" 之前没有标题，已挂到自动根节点`, lineNo, true);
        parent = createNode(null, docName, 'auto', 0, lineNo);
        parent.isAutoFix = true;
        pathStack.length = 0;
        pathStack[0] = parent;
        lastHeading = parent;
        if (rootId === null) rootId = parent.id;
      }
      const node = createNode(parent, childText, 'child', parent.depth + 1, lineNo);
      current = node;
      continue;
    }

    const ref = REF_RE.exec(line);
    if (ref) {
      const rest = ref[1] ?? '';
      const sepAt = rest.search(REF_LABEL_SEP);
      const rawTargets = sepAt >= 0 ? rest.slice(0, sepAt) : rest;
      const label = sepAt >= 0 ? rest.slice(sepAt).trim() : '';
      if (!current) {
        warn('missing-parent', 'warning', `跨边引用 "${rawTargets.trim()}" 没有所属节点，已忽略`, lineNo, false);
        continue;
      }
      pendingRefs.push({ ownerId: current.id, lineNo, rawTargets, label });
      continue;
    }

    const nodeRef = NODEREF_RE.exec(line);
    if (nodeRef) {
      const raw = (nodeRef[1] ?? '').trim();
      if (!raw) continue; // 空 `::` 无目标，静默忽略
      if (!current) {
        warn('missing-parent', 'warning', `节点引用 "${raw}" 没有所属节点，已忽略`, lineNo, false);
        continue;
      }
      pendingNodeRefs.push({ ownerId: current.id, lineNo, rawTarget: raw });
      continue;
    }

    // `!--` 指令行：分流优先级低于上方全部行首前缀（# / -- / <=> / ::）。
    // 必须先于 `![[` 的 includes 判定——指令行内的 ![[ 属于 value / 目标文本，不入 embeds
    if (line.trim().startsWith(DIRECTIVE_PREFIX)) {
      const parsed = parseDirectiveLine(line);
      if (parsed) {
        // 白名单拦截：仅支持已实现渲染的标准 key（§10.7），清单外记警告且不存储
        if (!KNOWN_DIRECTIVE_KEYS.includes(parsed.key)) {
          warn(
            'directive-unknown-key',
            'warning',
            `未知指令 key "${parsed.key}"，仅支持规范 §10.7 清单内 key，指令已忽略`,
            lineNo,
            false,
          );
          continue;
        }
        pendingDirectives.push({
          lineNo,
          ...parsed,
          // 默认绑定落点：上方最近的节点声明行；null = 孤儿（挂文档级）
          boundOwnerId: current ? current.id : null,
        });
      }
      continue;
    }

    if (line.includes('![[')) {
      if (current) current.embeds.push(...extractEmbeds(line, lineNo));
      continue;
    }

    if (isExternalUrlLine(line)) {
      if (current) {
        current.embeds.push({ kind: 'url', raw: line.trim(), target: line.trim(), lineNo });
      }
      continue;
    }

    if (line.trim() === '') continue;

    const annotation = ANNOTATION_RE.exec(line.trim());
    if (annotation) {
      if (current) current.annotation.push(annotation[1].trim());
      continue;
    }

    const contentText = stripLineComment(line).trim();
    if (contentText && current) current.content.push(contentText);
  }

  resolveRefs(pendingRefs, nodeMap, filePath, warn);
  resolveNodeRefs(pendingNodeRefs, nodeMap, filePath);
  const orderedNodes = order.map((id) => nodeMap.get(id) as IMmsNode);
  const directiveBindings: IDirectiveBinding[] = [];
  resolveDirectives(pendingDirectives, orderedNodes, nodeMap, declaredLevels, docExtensions, (type, severity, message, lineNo, autoFixed = false) => {
    warnings.push({ type, severity, message, filePath, lineNo, autoFixed });
  }, directiveBindings);

  return {
    nodes: orderedNodes,
    nodeMap,
    rootId,
    extensions: docExtensions,
    directiveBindings,
  };
}

/** 构建「节点文本 → 节点 id 列表」索引，供跨边 / 节点引用第二遍解析使用 */
function buildTextToIds(nodeMap: Map<string, IMmsNode>): Map<string, string[]> {
  const textToIds = new Map<string, string[]>();
  for (const node of nodeMap.values()) {
    if (node.isAutoFix) continue;
    const list = textToIds.get(node.text);
    if (list) list.push(node.id);
    else textToIds.set(node.text, [node.id]);
  }
  return textToIds;
}

/**
 * 第二遍扫描：解析跨边引用，因此支持前向引用。
 * 跨文件目标不在本函数内判否，留给 controller 在全部文档就绪后回填
 */
function resolveRefs(
  pendingRefs: readonly PendingRef[],
  nodeMap: Map<string, IMmsNode>,
  filePath: string,
  warn: (
    type: IWarning['type'],
    severity: IWarning['severity'],
    message: string,
    lineNo?: number,
    autoFixed?: boolean,
  ) => void,
): void {
  const textToIds = buildTextToIds(nodeMap);

  for (const pending of pendingRefs) {
    const owner = nodeMap.get(pending.ownerId);
    if (!owner) continue;

    const targets = pending.rawTargets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (targets.length === 0) {
      warn('parse-error', 'warning', '跨边引用缺少目标节点', pending.lineNo, false);
      continue;
    }

    for (const raw of targets) {
      const { filePath: refFile, nodeText } = parseRefTarget(raw);
      const targetFile = refFile ?? filePath;
      let resolvedId: string | null = null;

      if (targetFile === filePath) {
        const ids = textToIds.get(nodeText);
        if (ids && ids.length > 0) {
          resolvedId = ids[0];
          if (ids.length > 1) {
            warn('missing-target', 'info', `跨边目标 "${nodeText}" 有 ${ids.length} 个同名节点，已指向第一个`, pending.lineNo, true);
          }
        } else {
          warn('missing-target', 'warning', `跨边目标 "${nodeText}" 不存在，虚线已忽略`, pending.lineNo, false);
        }
      }

      const crossRef: ICrossRef = {
        targetNodeId: resolvedId ?? nodeText,
        targetFilePath: targetFile,
        rawTarget: raw,
        label: pending.label,
        lineNo: pending.lineNo,
        resolved: resolvedId !== null,
      };
      owner.crossRefs.push(crossRef);

      if (resolvedId) {
        nodeMap.get(resolvedId)?.incomingRefs.push({
          sourcePath: filePath,
          sourceLine: pending.lineNo,
          sourceNodeId: owner.id,
        });
      }
    }
  }
}

/**
 * 第二遍扫描：解析 `::` 节点引用（点对点定位，不建边）。
 * 同文件目标在此即时判定；跨文件目标留给索引构建器在全部文档就绪后回填。
 * 定位失败不产生警告（引用是提示性功能，与跨边引用不同）
 */
function resolveNodeRefs(
  pendingNodeRefs: readonly PendingNodeRef[],
  nodeMap: Map<string, IMmsNode>,
  filePath: string,
): void {
  const textToIds = buildTextToIds(nodeMap);

  for (const pending of pendingNodeRefs) {
    const owner = nodeMap.get(pending.ownerId);
    if (!owner) continue;

    const { filePath: refFile, nodeText } = parseNodeRefTarget(pending.rawTarget);
    const targetFile = refFile ?? filePath;
    let resolvedId: string | null = null;

    if (targetFile === filePath) {
      resolvedId = textToIds.get(nodeText)?.[0] ?? null;
    }

    const nodeRef: INodeRef = {
      targetNodeId: resolvedId ?? nodeText,
      targetFilePath: targetFile,
      rawTarget: pending.rawTarget,
      lineNo: pending.lineNo,
      resolved: resolvedId !== null,
    };
    owner.nodeRefs.push(nodeRef);
  }
}
