/**
 * @module core/parser/embed
 * @description 嵌入语法分类。`![[xxx]]` 与裸 URL 的分流规则集中在此
 */

import type { EmbedKind, IEmbed } from '../../host/types';

const IMAGE_EXTS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'avif'];
const URL_RE = /^https?:\/\/\S+$/i;
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;

/** 取扩展名的小写形式；URL 先剥掉查询串，没有扩展名时返回空串 */
function extOf(target: string): string {
  const clean = target.split(/[?#]/)[0];
  const idx = clean.lastIndexOf('.');
  return idx >= 0 ? clean.slice(idx + 1).toLowerCase() : '';
}

/** 按扩展名判定嵌入类型 */
export function classifyEmbedTarget(target: string): EmbedKind {
  const ext = extOf(target);
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (ext === 'mms') return 'mms';
  if (URL_RE.test(target)) return 'url';
  return 'file';
}

/** 是否为外部链接行（裸 URL 独占一行） */
export function isExternalUrlLine(line: string): boolean {
  return URL_RE.test(line.trim());
}

/** 抽取一行中的所有 `![[]]` 嵌入；一行可能写多个，也可能内联出现在正文里 */
export function extractEmbeds(line: string, lineNo: number): IEmbed[] {
  const found: IEmbed[] = [];
  EMBED_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EMBED_RE.exec(line)) !== null) {
    const target = match[1].trim();
    found.push({
      kind: classifyEmbedTarget(target),
      raw: match[0],
      target,
      lineNo,
    });
  }
  return found;
}
