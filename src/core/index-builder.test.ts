/**
 * @module core/index-builder.test
 * @description 跨文件引用解析与反链索引的单元测试
 */

import { describe, expect, it } from 'vitest';
import { buildBacklinkIndex, resolveCrossFileRefs } from './index-builder';
import { parseMms } from './parser';
import { makeBacklinkKey } from '../utils/make-key';
import type { IWarning } from '../host/types';

describe('resolveCrossFileRefs', () => {
  it('解析 文件.mms::节点 形式的跨文件引用', () => {
    const a = parseMms('# R\n## A\n<=> b.mms::B\n', 'dir/a.mms');
    const b = parseMms('# R2\n## B\n', 'dir/b.mms');
    const warnings: IWarning[] = [];

    resolveCrossFileRefs([a, b], warnings);

    const ref = a.nodeMap.get('R>A')?.crossRefs[0];
    expect(ref?.resolved).toBe(true);
    expect(ref?.targetNodeId).toBe('R2>B');
    expect(b.nodeMap.get('R2>B')?.incomingRefs).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('目标文件不存在时记警告', () => {
    const a = parseMms('# R\n## A\n<=> 缺失.mms::B\n', 'dir/a.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a], warnings);
    expect(warnings.some((w) => w.message.includes('缺失.mms'))).toBe(true);
  });

  it('目标节点不存在时记警告', () => {
    const a = parseMms('# R\n## A\n<=> b.mms::不存在\n', 'dir/a.mms');
    const b = parseMms('# R2\n## B\n', 'dir/b.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a, b], warnings);
    expect(warnings.some((w) => w.type === 'missing-target')).toBe(true);
  });
});

describe('buildBacklinkIndex', () => {
  it('把出边登记到目标节点的反链列表', () => {
    const doc = parseMms('# R\n## A\n<=> B\n## B', 'demo/t.mms');
    const index = buildBacklinkIndex([doc]);
    const list = index.get(makeBacklinkKey('demo/t.mms', 'R>B'));
    expect(list).toHaveLength(1);
    expect(list?.[0].sourcePath).toBe('demo/t.mms');
    expect(list?.[0].sourceLine).toBe(3);
  });

  it('未解析的引用不进索引', () => {
    const doc = parseMms('# R\n## A\n<=> 不存在', 'demo/t.mms');
    expect(buildBacklinkIndex([doc]).getAll().size).toBe(0);
  });

  it('多来源按解析顺序聚合', () => {
    const doc = parseMms('# R\n## A\n<=> C\n## B\n<=> C\n## C', 'demo/t.mms');
    const index = buildBacklinkIndex([doc]);
    expect(index.get(makeBacklinkKey('demo/t.mms', 'R>C'))).toHaveLength(2);
  });
});
