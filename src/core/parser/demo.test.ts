/**
 * @module core/parser/demo.test
 * @description 用 demo/ 下的真实素材做冒烟回归，同时覆盖布局算法
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMms } from './index';
import { layoutTree } from '../layout';
import { buildBacklinkIndex, resolveCrossFileRefs } from '../index-builder';

const readDemo = (name: string): string =>
  readFileSync(path.resolve(process.cwd(), 'demo', name), 'utf8');

describe('demo/用户增长脑图.mms', () => {
  const doc = parseMms(readDemo('用户增长脑图.mms'), 'demo/用户增长脑图.mms');

  it('继承 frontmatter 的标签、布局与备注', () => {
    expect(doc.tags).toEqual(['任务', '进度']);
    expect(doc.layout).toBe('LR');
    expect(doc.desc).toContain('会员体系');
  });

  it('跨父同名保持为两个独立节点', () => {
    expect(doc.nodeMap.get('用户增长脑图>渠道策略>社交裂变')).toBeDefined();
    expect(doc.nodeMap.get('用户增长脑图>拉新策略>社交裂变')).toBeDefined();
  });

  it('跨边引用解析到转化策略下的目标', () => {
    const refs = doc.nodeMap.get('用户增长脑图>拉新策略>社交裂变')?.crossRefs ?? [];
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => ref.resolved)).toBe(true);
    expect(refs[0].label).toBe('联动转化链路');
  });

  it('四类嵌入都被识别', () => {
    const kinds = doc.nodeMap.get('用户增长脑图>数据看板')?.embeds.map((e) => e.kind);
    expect(kinds).toEqual(['image', 'mms', 'file', 'url']);
  });
});

describe('demo/技术架构.mms', () => {
  const doc = parseMms(readDemo('技术架构.mms'), 'demo/技术架构.mms');

  it('跳级处自动补空节点', () => {
    expect(doc.nodes.some((n) => n.isAutoFix)).toBe(true);
    expect(doc.warnings.some((w) => w.type === 'level-skip')).toBe(true);
  });

  it('支持超过 H6 的深层嵌套', () => {
    expect(doc.nodes.some((n) => n.depth === 7)).toBe(true);
  });

  it('跨文件引用在单文件解析阶段保持未解析', () => {
    const ref = doc.nodeMap.get('技术架构>服务层>用户服务')?.crossRefs[0];
    expect(ref?.resolved).toBe(false);
    expect(ref?.targetFilePath).toBe('用户增长脑图.mms');
  });
});

describe('demo/边界用例.mms', () => {
  const doc = parseMms(readDemo('边界用例.mms'), 'demo/边界用例.mms');

  it('无根节点时降级并记录 no-root', () => {
    expect(doc.rootId).toBe('没有根节点的一级节点');
    expect(doc.warnings.some((w) => w.type === 'no-root')).toBe(true);
  });

  it('非法 mms_layout 回退 LR', () => {
    expect(doc.layout).toBe('LR');
  });

  it('同父同名合并', () => {
    expect(doc.warnings.some((w) => w.type === 'duplicate-merge')).toBe(true);
  });

  it('断链目标记录 missing-target', () => {
    expect(doc.warnings.some((w) => w.type === 'missing-target')).toBe(true);
  });
});

describe('demo/空文件.mms', () => {
  it('空文件产出空节点树', () => {
    const doc = parseMms(readDemo('空文件.mms'), 'demo/空文件.mms');
    expect(doc.nodes).toHaveLength(0);
    expect(doc.rootId).toBeNull();
  });
});

describe('全局索引与布局', () => {
  it('跨文件引用在全部文档就绪后解析成功', () => {
    const a = parseMms(readDemo('技术架构.mms'), 'demo/技术架构.mms');
    const b = parseMms(readDemo('用户增长脑图.mms'), 'demo/用户增长脑图.mms');
    const warnings = [...a.warnings, ...b.warnings];
    resolveCrossFileRefs([a, b], warnings);
    const ref = a.nodeMap.get('技术架构>服务层>用户服务')?.crossRefs[0];
    expect(ref?.resolved).toBe(true);
    expect(b.nodeMap.get(ref?.targetNodeId ?? '')).toBeDefined();
    expect(buildBacklinkIndex([a, b]).getAll().size).toBeGreaterThan(0);
  });

  it('布局产出坐标且互不重叠', () => {
    const doc = parseMms(readDemo('用户增长脑图.mms'), 'demo/用户增长脑图.mms');
    const layout = layoutTree(doc.rootId, doc.nodeMap, { direction: doc.layout });
    expect(layout.nodes.size).toBe(doc.nodes.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);

    const boxes = [...layout.nodes.values()];
    for (const box of boxes) {
      expect(Number.isFinite(box.x)).toBe(true);
      expect(Number.isFinite(box.y)).toBe(true);
    }
    const first = boxes[0];
    const sameSpot = boxes.filter((b) => b !== first && b.x === first.x && b.y === first.y);
    expect(sameSpot).toHaveLength(0);
  });

  it('空文档布局返回空结果而不是抛错', () => {
    const doc = parseMms('', 'demo/空.mms');
    const layout = layoutTree(doc.rootId, doc.nodeMap);
    expect(layout.nodes.size).toBe(0);
    expect(layout.width).toBe(0);
  });
});
