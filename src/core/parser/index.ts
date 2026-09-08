/**
 * @module core/parser/index
 * @description MMS 解析器入口：剥离 Frontmatter 后，将正文解析为节点树
 */

import type { IParsedDoc, IWarning } from '../../host/types';
import { resolveLayout, splitFrontmatter } from '../frontmatter';
import { parseBody } from './body';

/** 显示名优先 frontmatter 的 mms_name，否则用文件名去扩展名 */
function deriveDisplayName(filePath: string, mmsName?: string): string {
  if (mmsName && mmsName.trim()) return mmsName.trim();
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.mms$/i, '') || filePath;
}

/** 将 .mms 文件内容解析为结构化文档。Frontmatter 只在这里剥离一次 */
export function parseMms(content: string, filePath: string): IParsedDoc {
  const warnings: IWarning[] = [];
  const { frontmatter, body, bodyStartLine } = splitFrontmatter(content);
  const displayName = deriveDisplayName(filePath, frontmatter?.mms_name);

  const { nodes, nodeMap, rootId } = parseBody(body, filePath, bodyStartLine, displayName, warnings);

  if (nodeMap.size === 0) {
    warnings.push({
      type: 'no-root',
      severity: 'warning',
      message: '文件为空或没有任何节点',
      filePath,
      autoFixed: false,
    });
  }

  return {
    filePath,
    displayName,
    layout: resolveLayout(frontmatter),
    tags: frontmatter?.mms_tags ?? [],
    desc: frontmatter?.mms_desc ?? null,
    nodes,
    nodeMap,
    rootId,
    warnings,
  };
}
