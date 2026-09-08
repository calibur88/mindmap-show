/**
 * @module core/index-builder
 * @description 跨文件引用解析与全局反链索引的唯一实现。纯逻辑，宿主只负责注入与查询
 */

import type { BacklinkIndex, IBacklink, IMmsNode, IParsedDoc, IWarning } from '../host/types';
import { makeBacklinkKey } from '../utils/make-key';

/** 按扩展名后缀匹配，容忍 `文件.mms`、`目录/文件.mms` 等不同写法 */
function findDoc(docs: readonly IParsedDoc[], byPath: Map<string, IParsedDoc>, ref: string): IParsedDoc | null {
  const exact = byPath.get(ref);
  if (exact) return exact;
  const needle = ref.replace(/^\.?\//, '').toLowerCase();
  return (
    docs.find((doc) => doc.filePath.toLowerCase() === needle) ??
    docs.find((doc) => doc.filePath.toLowerCase().endsWith(`/${needle}`)) ??
    null
  );
}

function findNodeByName(doc: IParsedDoc, text: string): IMmsNode | null {
  return doc.nodes.find((node) => !node.isAutoFix && node.text === text) ?? null;
}

/**
 * 解析跨文件跨边引用。
 * 单文件内无法判断其他文件有什么节点，这一步必须在全部文档就绪后执行
 */
export function resolveCrossFileRefs(docs: readonly IParsedDoc[], warnings: IWarning[]): void {
  const byPath = new Map<string, IParsedDoc>();
  for (const doc of docs) byPath.set(doc.filePath, doc);

  for (const doc of docs) {
    for (const node of doc.nodes) {
      for (const ref of node.crossRefs) {
        if (ref.resolved) continue;
        // 文件内引用在解析阶段已判定为不存在，这里不再重复报错
        if (ref.targetFilePath === doc.filePath) continue;

        const targetDoc = findDoc(docs, byPath, ref.targetFilePath);
        if (!targetDoc) {
          warnings.push({
            type: 'missing-target',
            severity: 'warning',
            message: `跨边引用的文件 "${ref.targetFilePath}" 不存在`,
            filePath: doc.filePath,
            lineNo: ref.lineNo,
            autoFixed: false,
          });
          continue;
        }

        const hit = findNodeByName(targetDoc, ref.targetNodeId);
        if (!hit) {
          warnings.push({
            type: 'missing-target',
            severity: 'warning',
            message: `跨边目标 "${ref.rawTarget}" 在 ${targetDoc.filePath} 中不存在`,
            filePath: doc.filePath,
            lineNo: ref.lineNo,
            autoFixed: false,
          });
          continue;
        }

        ref.targetFilePath = targetDoc.filePath;
        ref.targetNodeId = hit.id;
        ref.resolved = true;
        hit.incomingRefs.push({
          sourcePath: doc.filePath,
          sourceLine: ref.lineNo,
          targetNode: hit.id,
        });
      }
    }
  }
}

/** 遍历每个节点的出边 crossRefs，登记到目标节点的反链列表 */
export function buildBacklinkIndex(docs: readonly IParsedDoc[]): BacklinkIndex {
  const map = new Map<string, IBacklink[]>();

  for (const doc of docs) {
    for (const node of doc.nodes) {
      for (const ref of node.crossRefs) {
        if (!ref.resolved) continue;
        const key = makeBacklinkKey(ref.targetFilePath, ref.targetNodeId);
        const entry: IBacklink = {
          sourcePath: doc.filePath,
          sourceLine: ref.lineNo,
          targetNode: ref.targetNodeId,
        };
        const list = map.get(key);
        if (list) list.push(entry);
        else map.set(key, [entry]);
      }
    }
  }

  return {
    get: (key: string) => map.get(key),
    getAll: () => new Map(map),
  };
}
