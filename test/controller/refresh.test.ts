/**
 * @module test/controller/refresh.test
 * @description MmsIndex 刷新流水线的单测：并发守卫、状态广播、警告排序、查询接口
 */

import { describe, expect, it } from 'vitest';
import { MmsIndex } from '../../src/controller/refresh';
import type { IUiHost, IVaultHost, UiStatus } from '../../src/host/types';

/** 记录 status 调用的最小 UI 宿主 */
function makeUiHost(): { host: IUiHost; statuses: string[] } {
  let state: UiStatus = 'synced';
  let detail = '';
  const statuses: string[] = [];
  const host: IUiHost = {
    setStatus(next, nextDetail) {
      state = next;
      detail = nextDetail ?? '';
      statuses.push(`${next}:${nextDetail ?? ''}`);
    },
    onStatus: () => {},
    offStatus: () => {},
    getLastState: () => state,
    getLastDetail: () => detail,
  };
  return { host, statuses };
}

/** 内存 vault 宿主；listCalls 用于验证并发守卫 */
function makeVault(files: Record<string, string>): {
  host: IVaultHost;
  listCalls: () => number;
  failRead: () => void;
} {
  let listCalls = 0;
  let failing = false;
  const host: IVaultHost = {
    async listMmsFiles() {
      listCalls++;
      return Object.keys(files);
    },
    async readFile(path: string) {
      if (failing) throw new Error('读文件失败');
      return files[path] ?? '';
    },
  };
  return { host, listCalls: () => listCalls, failRead: () => (failing = true) };
}

describe('refresh 并发守卫', () => {
  it('连续三次 refresh 复用同一个 Promise，只扫一次', async () => {
    const vault = makeVault({ 'a.mms': '# A' });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);

    await Promise.all([index.refresh(), index.refresh(), index.refresh()]);

    expect(vault.listCalls()).toBe(1);
  });

  it('前一次结束后再次 refresh 会重新扫描', async () => {
    const vault = makeVault({ 'a.mms': '# A' });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);

    await index.refresh();
    await index.refresh();

    expect(vault.listCalls()).toBe(2);
  });
});

describe('refresh 状态广播', () => {
  it('成功时先「正在扫描」再汇报文件数', async () => {
    const vault = makeVault({ 'a.mms': '# A', 'b.mms': '# B' });
    const ui = makeUiHost();
    await new MmsIndex(vault.host, ui.host).refresh();

    expect(ui.statuses[0]).toBe('synced:正在扫描');
    expect(ui.statuses.at(-1)).toBe('synced:已同步 2 个文件');
  });

  it('扫描抛错时置 error 且不向外抛，监听器仍然收到通知', async () => {
    const vault = makeVault({ 'a.mms': '# A' });
    vault.failRead();
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    let notified = 0;
    index.onUpdate(() => (notified += 1));

    await expect(index.refresh()).resolves.toBeUndefined();

    expect(ui.statuses.at(-1)).toBe('error:读文件失败');
    expect(notified).toBe(1);
  });

  it('offUpdate 后不再收到通知', async () => {
    const vault = makeVault({ 'a.mms': '# A' });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    let notified = 0;
    const listener = (): void => {
      notified += 1;
    };

    index.onUpdate(listener);
    index.offUpdate(listener);
    await index.refresh();

    expect(notified).toBe(0);
  });
});

describe('getAllWarnings 排序', () => {
  // 三个文件刻意按「非字典序」的键序排列，用来验证排序真的按 filePath 而非扫描顺序
  const FILES: Record<string, string> = {
    'z.mms': '---\nmms_layout: XX\n---\n# R',
    'a.mms': '# A\n### C',
    'm.mms': '## X',
  };

  it('先按 severity（warning 在 info 前），同 severity 按文件路径，再按行号', async () => {
    const vault = makeVault(FILES);
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    await index.refresh();

    const got = index.getAllWarnings().map((w) => `${w.severity}/${w.filePath}:${w.lineNo}/${w.type}`);

    expect(got).toEqual([
      'warning/m.mms:1/no-root',
      'warning/z.mms:1/frontmatter-fallback',
      'info/a.mms:2/level-skip',
    ]);
  });

  it('同文件同 severity 时按行号升序', async () => {
    const vault = makeVault({
      'a.mms': '# R\n## A\n!-- color > red\n!-- color > blue\n## B\n!-- color > red\n!-- color > blue',
    });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    await index.refresh();

    const conflicts = index
      .getAllWarnings()
      .filter((w) => w.type === 'directive-conflict')
      .map((w) => w.lineNo);

    expect(conflicts).toEqual([4, 7]);
  });
});

describe('查询接口', () => {
  it('getDoc 命中返回文档，未命中返回 undefined', async () => {
    const vault = makeVault({ 'a.mms': '# A' });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    await index.refresh();

    // 显示名优先 frontmatter 的 mms_name，本例没写 → 用文件名去扩展名（小写 a）
    expect(index.getDoc('a.mms')?.displayName).toBe('a');
    expect(index.getDoc('不存在.mms')).toBeUndefined();
  });

  it('getFileSummaries 的 nodeCount 不计自动补齐节点', async () => {
    // 跳级会补一个 auto 节点：实际节点 2 个（# A 与 ### C），计入的只有 2 个非 auto
    const vault = makeVault({ 'a.mms': '# A\n### C' });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    await index.refresh();

    const summary = index.getFileSummaries()[0];
    expect(summary.path).toBe('a.mms');
    expect(summary.name).toBe('a');
    // 节点总数 3（# A、补齐的 auto、### C），其中 auto 不计入
    expect(index.getDoc('a.mms')!.nodes.length).toBe(3);
    expect(summary.nodeCount).toBe(2);
  });

  it('getTagStats 按文件数降序', async () => {
    const vault = makeVault({
      'a.mms': '---\nmms_tags: 甲, 乙\n---\n# A',
      'b.mms': '---\nmms_tags: 甲\n---\n# B',
      'c.mms': '# C',
    });
    const ui = makeUiHost();
    const index = new MmsIndex(vault.host, ui.host);
    await index.refresh();

    expect(index.getTagStats()).toEqual([
      { name: '甲', count: 2 },
      { name: '乙', count: 1 },
    ]);
  });
});
