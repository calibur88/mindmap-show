/**
 * @module core/index-builder
 * @description 跨文件引用解析与出链聚合的唯一实现。纯逻辑，宿主只负责注入与查询
 */

import type { IMmsNode, IOutlink, IParsedDoc, IWarning } from '../host/types';

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

function findNodesByName(doc: IParsedDoc, text: string): IMmsNode[] {
  return doc.nodes.filter((node) => !node.isAutoFix && node.text === text);
}

function findNodeByName(doc: IParsedDoc, text: string): IMmsNode | null {
  return findNodesByName(doc, text)[0] ?? null;
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

        const hits = findNodesByName(targetDoc, ref.targetNodeId);
        if (hits.length === 0) {
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
        // 与同文件跨边保持一致：多个同名节点时指向第一个，并留 info 告警说明落点
        if (hits.length > 1) {
          warnings.push({
            type: 'missing-target',
            severity: 'info',
            message: `跨边目标 "${ref.rawTarget}" 在 ${targetDoc.filePath} 中有 ${hits.length} 个同名节点，已指向第一个`,
            filePath: doc.filePath,
            lineNo: ref.lineNo,
            autoFixed: true,
          });
        }
        const hit = hits[0];

        ref.targetFilePath = targetDoc.filePath;
        ref.targetNodeId = hit.id;
        ref.resolved = true;
        hit.incomingRefs.push({
          sourcePath: doc.filePath,
          sourceLine: ref.lineNo,
          sourceNodeId: node.id,
        });
      }
    }
  }
}

/**
 * 解析跨文件 `::` 节点引用。与跨边不同，节点引用只做定位、不建边，
 * 因此失败时不产生警告，仅保持 `resolved=false` 供右栏「引用链」灰显
 */
export function resolveCrossFileNodeRefs(docs: readonly IParsedDoc[]): void {
  const byPath = new Map<string, IParsedDoc>();
  for (const doc of docs) byPath.set(doc.filePath, doc);

  for (const doc of docs) {
    for (const node of doc.nodes) {
      for (const ref of node.nodeRefs) {
        if (ref.resolved) continue;
        if (ref.targetFilePath === doc.filePath) continue;

        const targetDoc = findDoc(docs, byPath, ref.targetFilePath);
        if (!targetDoc) continue;

        const hit = findNodeByName(targetDoc, ref.targetNodeId);
        if (!hit) continue;

        ref.targetFilePath = targetDoc.filePath;
        ref.targetNodeId = hit.id;
        ref.resolved = true;
      }
    }
  }
}

/**
 * 聚合每个文件指向外部的 `<=>` 出链（不含同文件引用）。
 * 已解析的条目带目标节点行号与节点 id，未解析的保持 `resolved=false`
 */
export function buildOutgoingRefs(docs: readonly IParsedDoc[]): void {
  const byPath = new Map<string, IParsedDoc>();
  for (const doc of docs) byPath.set(doc.filePath, doc);

  for (const doc of docs) {
    const outlinks: IOutlink[] = [];
    for (const node of doc.nodes) {
      for (const ref of node.crossRefs) {
        // 同文件 `<=>` 只画虚线，不计入出链
        if (ref.targetFilePath === doc.filePath) continue;

        let targetNodeId: string | null = null;
        let targetLine = 0;
        if (ref.resolved) {
          targetNodeId = ref.targetNodeId;
          targetLine = byPath.get(ref.targetFilePath)?.nodeMap.get(ref.targetNodeId)?.lineNo ?? 0;
        }

        outlinks.push({
          targetPath: ref.targetFilePath,
          targetLine,
          sourceNodeId: node.id,
          sourceText: node.text,
          sourceLineNo: ref.lineNo,
          targetNodeId,
          resolved: ref.resolved,
        });
      }
    }
    doc.outgoingRefs = outlinks;
  }
}
