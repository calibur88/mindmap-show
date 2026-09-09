/**
 * @module controller/refresh
 * @description 刷新流水线与全局索引。跨视图共享，避免每个标签页各自扫描一遍
 */

import type {
  IParsedDoc,
  IUiHost,
  IVaultHost,
  IWarning,
} from '../host/types';
import { buildOutgoingRefs, resolveCrossFileNodeRefs, resolveCrossFileRefs } from '../core/index-builder';
import { parseMms } from '../core/parser';

/** 左栏需要的每个文件摘要 */
export interface IFileSummary {
  path: string;
  name: string;
  nodeCount: number;
  tags: string[];
}

/** 全局索引。唯一持有全部解析结果的地方 */
export class MmsIndex {
  private docs: IParsedDoc[] = [];
  private listeners: (() => void)[] = [];
  /** 并发守卫：多次连续调用复用同一个 promise，避免启动 + 视图挂载时双扫 */
  private inflight: Promise<void> | null = null;

  constructor(
    private vaultHost: IVaultHost,
    private uiHost: IUiHost,
  ) {}

  /** 完整刷新流水线：扫描 → 解析 → 跨文件引用与节点引用 → 出链聚合 */
  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      this.uiHost.setStatus('synced', '正在扫描');
      try {
        const paths = await this.vaultHost.listMmsFiles();
        const docs: IParsedDoc[] = [];
        const warnings: IWarning[] = [];
        for (const path of paths) {
          const content = await this.vaultHost.readFile(path);
          const doc = parseMms(content, path);
          docs.push(doc);
          warnings.push(...doc.warnings);
        }
        resolveCrossFileRefs(docs, warnings);
        resolveCrossFileNodeRefs(docs);
        buildOutgoingRefs(docs);
        this.docs = docs;
        this.uiHost.setStatus('synced', `已同步 ${docs.length} 个文件`);
      } catch (error) {
        // 状态卡文案指向控制台，这里必须真的留下错误日志
        console.error('[MMS] 刷新失败:', error);
        this.uiHost.setStatus('error', error instanceof Error ? error.message : String(error));
      }
      for (const listener of [...this.listeners]) {
        try {
          listener();
        } catch (error) {
          // 单个视图渲染异常不应中断其余视图的刷新
          console.error('[MMS] 索引监听器执行失败:', error);
        }
      }
    })();
    try {
      await this.inflight;
    } finally {
      this.inflight = null;
    }
  }

  /** 注册索引更新监听 */
  onUpdate(listener: () => void): void {
    this.listeners.push(listener);
  }

  /** 注销监听。视图层 onClose 必须调用，否则同 leaf 反复开闭会累积回调 */
  offUpdate(listener: () => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  getDoc(filePath: string): IParsedDoc | undefined {
    return this.docs.find((doc) => doc.filePath === filePath);
  }

  getFileSummaries(): IFileSummary[] {
    return this.docs.map((doc) => ({
      path: doc.filePath,
      name: doc.displayName,
      nodeCount: doc.nodes.filter((node) => !node.isAutoFix).length,
      tags: doc.tags,
    }));
  }

  /** 全部文档的解析警告（副本），按 error → warning → info、文件路径、行号排序 */
  getAllWarnings(): IWarning[] {
    const out: IWarning[] = [];
    for (const doc of this.docs) out.push(...doc.warnings);
    const rank: Record<IWarning['severity'], number> = { error: 0, warning: 1, info: 2 };
    return out.sort((a, b) => {
      const dr = rank[a.severity] - rank[b.severity];
      if (dr !== 0) return dr;
      const fp = a.filePath.localeCompare(b.filePath);
      if (fp !== 0) return fp;
      return (a.lineNo ?? 0) - (b.lineNo ?? 0);
    });
  }

  /** 标签及其文件数，按文件数降序 */
  getTagStats(): { name: string; count: number }[] {
    const counter = new Map<string, number>();
    for (const doc of this.docs) {
      for (const tag of doc.tags) counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
    return [...counter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }
}
