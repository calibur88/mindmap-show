/**
 * @module core/frontmatter
 * @description .mms 文件 Frontmatter 的唯一剥离实现。纯字符串操作，无宿主依赖
 */

import type { MmsFrontmatter, MmsLayout } from '../host/types';
import { DEFAULT_LAYOUT } from '../utils/make-key';

export interface SplitResult {
  frontmatter: MmsFrontmatter | null;
  /** 剥离 Frontmatter 后的纯正文，下传给层级解析器 */
  body: string;
  /** body 第一行在源文件中的行号（1 起），用于警告与跳转定位 */
  bodyStartLine: number;
}

const VALID_LAYOUTS: readonly MmsLayout[] = ['LR', 'TB', 'RL'];

/**
 * 去掉行尾的行内注释。
 * MMS 用正则提取键值，`# 注释` 若不手动剥离会被当成值的一部分
 */
function stripInlineComment(value: string): string {
  return value.replace(/\s+#.*$/, '').trim();
}

/** 解析 mms_tags，同时支持 `a, b` 与 `[a, b]` 两种写法 */
function parseTags(raw: string): string[] {
  let value = stripInlineComment(raw);
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  return value
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * 剥离并解析 Frontmatter。
 * 只有文件首行为 `---` 时才进入解析流程，正文中的 `---` 分隔线不会误触发；
 * 没有闭合边界时整体降级为正文，避免把整篇内容吞掉
 */
export function splitFrontmatter(content: string): SplitResult {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { frontmatter: null, body: normalized, bodyStartLine: 1 };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return { frontmatter: null, body: normalized, bodyStartLine: 1 };
  }

  const rawFm = lines.slice(1, endIdx).join('\n');
  const result: MmsFrontmatter = {};

  const nameMatch = rawFm.match(/^mms_name:\s*(.*)/mi);
  if (nameMatch) result.mms_name = stripInlineComment(nameMatch[1]);

  const tagsMatch = rawFm.match(/^mms_tags:\s*(.*)/mi);
  if (tagsMatch) result.mms_tags = parseTags(tagsMatch[1]);

  const layoutMatch = rawFm.match(/^mms_layout:\s*(.*)/mi);
  if (layoutMatch) {
    const value = stripInlineComment(layoutMatch[1]).toUpperCase();
    if (VALID_LAYOUTS.includes(value as MmsLayout)) {
      result.mms_layout = value as MmsLayout;
    }
  }

  const descMatch = rawFm.match(/^mms_desc:\s*(.*)/mi);
  if (descMatch) result.mms_desc = stripInlineComment(descMatch[1]);

  return {
    frontmatter: Object.keys(result).length ? result : null,
    body: lines.slice(endIdx + 1).join('\n'),
    bodyStartLine: endIdx + 2,
  };
}

/** 取生效的布局方向，frontmatter 缺失或非法时回退默认值 */
export function resolveLayout(frontmatter: MmsFrontmatter | null): MmsLayout {
  return frontmatter?.mms_layout ?? DEFAULT_LAYOUT;
}
