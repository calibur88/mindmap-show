/**
 * @module utils/make-key
 * @description 节点 id 构造与引用目标解析的唯一出口。被 core 与 ui 共用，避免 core 反向依赖 host
 */

import type { MmsLayout, MmsLineStyle } from '../host/types';

/** 节点 id 的层级分隔符 */
export const ID_SEP = '>';

/** `::` 节点引用语法中文件与节点的分隔符（仅本模块使用） */
const KEY_SEP = '::';

/** 默认布局方向，frontmatter 缺失或非法时使用 */
export const DEFAULT_LAYOUT: MmsLayout = 'LR';

/** 默认连线样式，frontmatter 缺失或非法时使用 */
export const DEFAULT_LINE_STYLE: MmsLineStyle = 'line';

/** 归一化节点文本：去首尾空白，作为 id 的组成部分 */
export function normalizeText(text: string): string {
  return text.trim();
}

/**
 * 构造节点 id。仅当父 id 与文本都相同时才会得到同一个 id，
 * 这是「仅同父下合并」语义的基础
 */
export function makeNodeId(parentId: string | null, text: string): string {
  const t = normalizeText(text);
  return parentId ? `${parentId}${ID_SEP}${t}` : t;
}

/** 解析 `<=>` 跨边目标：跨文件为 `文件名.mms 节点文本`（空格分隔），同文件为 `节点文本` */
export function parseRefTarget(raw: string): { filePath: string | null; nodeText: string } {
  const trimmed = raw.trim();
  const cross = /^(\S+\.mms)\s+(.+)$/i.exec(trimmed);
  if (cross) {
    return { filePath: cross[1], nodeText: cross[2].trim() };
  }
  return { filePath: null, nodeText: trimmed };
}

/** 解析 `::` 节点引用目标：跨文件为 `文件名.mms::节点文本`，同文件为 `节点文本` */
export function parseNodeRefTarget(raw: string): { filePath: string | null; nodeText: string } {
  const idx = raw.indexOf(KEY_SEP);
  if (idx >= 0) {
    return {
      filePath: raw.slice(0, idx).trim(),
      nodeText: raw.slice(idx + KEY_SEP.length).trim(),
    };
  }
  return { filePath: null, nodeText: raw.trim() };
}

/** 取节点 id 的最后一段作为展示用的短名 */
export function shortNodeName(nodeId: string): string {
  const idx = nodeId.lastIndexOf(ID_SEP);
  return idx >= 0 ? nodeId.slice(idx + ID_SEP.length) : nodeId;
}
