/**
 * @module utils/make-key
 * @description 节点 id 与反链 key 的唯一构造函数。core 与 host 共用，避免 core 反向依赖 host
 */

import type { MmsLayout } from '../host/types';

/** 节点 id 的层级分隔符 */
export const ID_SEP = '>';

/** 反链 key 的文件与节点分隔符 */
export const KEY_SEP = '::';

/** 默认布局方向，frontmatter 缺失或非法时使用 */
export const DEFAULT_LAYOUT: MmsLayout = 'LR';

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

/** 构造反链索引 key */
export function makeBacklinkKey(filePath: string, nodeId: string): string {
  return `${filePath}${KEY_SEP}${nodeId}`;
}

/** 解析 `<=>` 的目标写法，支持 `文件.mms::节点` 与 `节点` 两种形式 */
export function parseRefTarget(raw: string): { filePath: string | null; nodeText: string } {
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
