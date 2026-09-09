/**
 * @module core/index-builder.test
 * @description 跨文件引用解析、节点引用解析与出链聚合的单元测试
 */

import { describe, expect, it } from 'vitest';
import { buildOutgoingRefs, resolveCrossFileNodeRefs, resolveCrossFileRefs } from './index-builder';
import { parseMms } from './parser';
import type { IWarning } from '../host/types';

describe('resolveCrossFileRefs', () => {
  it('解析 文件.mms 节点 形式的跨文件引用（空格分隔）', () => {
    const a = parseMms('# R\n## A\n<=> b.mms B\n', 'dir/a.mms');
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
    const a = parseMms('# R\n## A\n<=> 缺失.mms B\n', 'dir/a.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a], warnings);
    expect(warnings.some((w) => w.message.includes('缺失.mms'))).toBe(true);
  });

  it('目标节点不存在时记警告', () => {
    const a = parseMms('# R\n## A\n<=> b.mms 不存在\n', 'dir/a.mms');
    const b = parseMms('# R2\n## B\n', 'dir/b.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a, b], warnings);
    expect(warnings.some((w) => w.type === 'missing-target')).toBe(true);
  });
});

describe('resolveCrossFileNodeRefs', () => {
  it('解析 文件名.mms::节点 形式的跨文件节点引用，不建边', () => {
    const a = parseMms('# R\n## A\n:: b.mms::B\n', 'dir/a.mms');
    const b = parseMms('# R2\n## B\n', 'dir/b.mms');

    resolveCrossFileNodeRefs([a, b]);

    const ref = a.nodeMap.get('R>A')?.nodeRefs[0];
    expect(ref?.resolved).toBe(true);
    expect(ref?.targetNodeId).toBe('R2>B');
    // 节点引用不建边，目标节点不产生入链
    expect(b.nodeMap.get('R2>B')?.incomingRefs).toHaveLength(0);
  });

  it('目标缺失时不告警，仅保持 resolved=false', () => {
    const a = parseMms('# R\n## A\n:: 缺失.mms::B\n', 'dir/a.mms');
    resolveCrossFileNodeRefs([a]);
    expect(a.nodeMap.get('R>A')?.nodeRefs[0].resolved).toBe(false);
  });
});

describe('buildOutgoingRefs', () => {
  it('聚合本文件指向外部的出链，并带目标行号', () => {
    const a = parseMms('# R\n## A\n<=> b.mms B\n', 'dir/a.mms');
    const b = parseMms('# R2\n## B\n', 'dir/b.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a, b], warnings);
    buildOutgoingRefs([a, b]);

    const out = a.outgoingRefs;
    expect(out).toHaveLength(1);
    expect(out[0].targetPath).toBe('dir/b.mms');
    expect(out[0].targetNodeId).toBe('R2>B');
    expect(out[0].targetLine).toBe(b.nodeMap.get('R2>B')?.lineNo);
    expect(out[0].sourceNodeId).toBe('R>A');
    expect(out[0].resolved).toBe(true);
  });

  it('同文件引用不计入出链', () => {
    const a = parseMms('# R\n## A\n<=> B\n## B\n', 'dir/a.mms');
    resolveCrossFileRefs([a], []);
    buildOutgoingRefs([a]);
    expect(a.outgoingRefs).toHaveLength(0);
  });

  it('断链出链保持 resolved=false', () => {
    const a = parseMms('# R\n## A\n<=> 缺失.mms B\n', 'dir/a.mms');
    resolveCrossFileRefs([a], []);
    buildOutgoingRefs([a]);
    expect(a.outgoingRefs).toHaveLength(1);
    expect(a.outgoingRefs[0].resolved).toBe(false);
    expect(a.outgoingRefs[0].targetNodeId).toBeNull();
    expect(a.outgoingRefs[0].targetLine).toBe(0);
  });
});
