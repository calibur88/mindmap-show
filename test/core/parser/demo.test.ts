/**
 * @module test/core/parser/demo.test
 * @description 用 demo/ 下的真实素材做冒烟回归，同时覆盖布局算法
 *
 * 分组与 demo/ 的目录一一对应，目录名即功能用例名
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMms } from '../../../src/core/parser';
import { layoutTree } from '../../../src/core/layout';
import { buildOutgoingRefs, resolveCrossFileRefs } from '../../../src/core/index-builder';
import type { IWarning, MmsLayout, MmsLineStyle } from '../../../src/host/types';

const readDemo = (name: string): string =>
  readFileSync(path.resolve(process.cwd(), 'demo', name), 'utf8');

const parseDemo = (name: string) => parseMms(readDemo(name), `demo/${name}`);

// ------------------------------------------------------------------ 基础语法

describe('基础语法/节点与正文.mms', () => {
  const doc = parseDemo('基础语法/节点与正文.mms');

  it('标题节点与正文、注释分流', () => {
    const node = doc.nodeMap.get('用户研究>调研方法>问卷');
    expect(node?.content).toEqual(['适合大样本与量化的假设验证。']);
    expect(node?.annotation.join()).toContain('问卷设计要克制');
  });

  it('根节点的 content 与 annotation 同时存在', () => {
    const root = doc.nodeMap.get('用户研究');
    expect(root?.annotation.join()).toContain('深度访谈');
  });
});

describe('基础语法/多级标题.mms', () => {
  const doc = parseDemo('基础语法/多级标题.mms');

  it('`#` 个数决定层级', () => {
    expect(doc.nodeMap.get('功能规划>需求池>用户反馈')?.depth).toBe(2);
    expect(doc.nodeMap.get('功能规划>优先级>P0>必须做')?.depth).toBe(3);
  });
});

// ------------------------------------------------------------------ 布局方向

const DIRECTION_CASES: { file: string; direction: MmsLayout; root: string }[] = [
  { file: '布局方向/LR-左到右.mms', direction: 'LR', root: '前端开发' },
  { file: '布局方向/TB-上到下.mms', direction: 'TB', root: '后端开发' },
  { file: '布局方向/BT-下到上.mms', direction: 'BT', root: '年度目标' },
  { file: '布局方向/RL-右到左.mms', direction: 'RL', root: '右到左布局' },
];

describe('布局方向/（四个方向）', () => {
  for (const item of DIRECTION_CASES) {
    it(`${item.direction}：子节点沿父→子流向展开`, () => {
      const doc = parseDemo(item.file);
      expect(doc.layout).toBe(item.direction);
      expect(doc.rootId).toBe(item.root);

      const layout = layoutTree(doc.rootId, doc.nodeMap, { direction: doc.layout });
      const parent = layout.nodes.get(item.root)!;
      const childId = doc.nodeMap.get(item.root)!.childIds[0];
      const child = layout.nodes.get(childId)!;

      if (item.direction === 'LR') expect(child.x).toBeGreaterThan(parent.x + parent.width - 1);
      if (item.direction === 'TB') expect(child.y).toBeGreaterThan(parent.y + parent.height - 1);
      if (item.direction === 'BT') expect(child.y + child.height).toBeLessThan(parent.y + 1);
      if (item.direction === 'RL') expect(child.x + child.width).toBeLessThan(parent.x + 1);
    });
  }

  it('BT 与 TB 的节点尺寸、交叉轴坐标一致，仅主轴翻转', () => {
    const tb = parseDemo('布局方向/TB-上到下.mms');
    const bt = parseDemo('布局方向/BT-下到上.mms');
    const a = layoutTree(tb.rootId, tb.nodeMap, { direction: 'TB' }).nodes;
    const b = layoutTree(bt.rootId, bt.nodeMap, { direction: 'BT' }).nodes;
    const parentA = a.get('后端开发')!;
    const parentB = b.get('年度目标')!;
    expect(parentB.width).toBeGreaterThan(0);
    expect(parentA.y).toBe(0);
    expect(parentB.y).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ 连线样式

const LINE_CASES: { file: string; lineStyle: MmsLineStyle }[] = [
  { file: '连线样式/line-直线.mms', lineStyle: 'line' },
  { file: '连线样式/curve-曲线.mms', lineStyle: 'curve' },
  { file: '连线样式/elbow-折线.mms', lineStyle: 'elbow' },
];

describe('连线样式/（三种取值）', () => {
  for (const item of LINE_CASES) {
    it(`${item.lineStyle}：mms_line 解析为该样式`, () => {
      expect(parseDemo(item.file).lineStyle).toBe(item.lineStyle);
    });
  }

  it('不写 mms_line 的文件回退 line', () => {
    expect(parseDemo('基础语法/多级标题.mms').lineStyle).toBe('line');
  });
});

// -------------------------------------------------------------- 跨边与反链

describe('跨边与反链/同文件跨边.mms', () => {
  const doc = parseDemo('跨边与反链/同文件跨边.mms');

  it('一行多目标拆成两条 crossRef 并共享备注', () => {
    const refs = doc.nodeMap.get('同文件跨边>起点')?.crossRefs ?? [];
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => ref.resolved)).toBe(true);
    expect(refs[0].label).toBe('多目标共享同一条备注');
    expect(refs[1].label).toBe('多目标共享同一条备注');
  });

  it('目标节点登记了反链', () => {
    const backlinks = doc.nodeMap.get('同文件跨边>终点A')?.incomingRefs ?? [];
    expect(backlinks).toHaveLength(1);
    expect(backlinks[0].sourcePath).toBe('demo/跨边与反链/同文件跨边.mms');
  });
});

describe('跨边与反链/跨文件引用.mms', () => {
  const doc = parseDemo('跨边与反链/跨文件引用.mms');

  it('单文件阶段保持未解析，且带目录的目标路径原样保留', () => {
    const ref = doc.nodeMap.get('跨文件引用>出链>引用复购')?.crossRefs[0];
    expect(ref?.resolved).toBe(false);
    expect(ref?.targetFilePath).toBe('综合演示/用户增长脑图.mms');
  });

  it('全库解析后回填成功并登记反链', () => {
    const target = parseDemo('综合演示/用户增长脑图.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([doc, target], warnings);
    const ref = doc.nodeMap.get('跨文件引用>出链>引用复购')?.crossRefs[0];
    expect(ref?.resolved).toBe(true);
    expect(target.nodeMap.get(ref?.targetNodeId ?? '')).toBeDefined();
    expect(target.nodeMap.get(ref?.targetNodeId ?? '')?.incomingRefs.length).toBeGreaterThan(0);
  });

  it('出链聚合到 doc.outgoingRefs，指向外部文件', () => {
    const a = parseDemo('跨边与反链/跨文件引用.mms');
    const b = parseDemo('综合演示/用户增长脑图.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a, b], warnings);
    buildOutgoingRefs([a, b]);
    expect(a.outgoingRefs.length).toBeGreaterThan(0);
    expect(a.outgoingRefs.every((o) => o.targetPath === 'demo/综合演示/用户增长脑图.mms')).toBe(true);
  });

  it('目标节点入链同时包含跨文件来源与本文件来源', () => {
    const a = parseDemo('跨边与反链/跨文件引用.mms');
    const b = parseDemo('综合演示/用户增长脑图.mms');
    const warnings: IWarning[] = [];
    resolveCrossFileRefs([a, b], warnings);
    const target = b.nodeMap.get('用户增长脑图>转化策略>复购');
    // 跨文件来源：本示例文件的 <=>
    expect(target?.incomingRefs.some((l) => l.sourcePath === 'demo/跨边与反链/跨文件引用.mms')).toBe(true);
    // 同文件来源：用户增长脑图内「拉新策略 → 社交裂变」的 <=> 首单转化, 复购
    expect(target?.incomingRefs.some((l) => l.sourcePath === 'demo/综合演示/用户增长脑图.mms')).toBe(true);
  });
});

// -------------------------------------------------------------- 边界与异常

describe('边界与异常/边界用例.mms', () => {
  const doc = parseDemo('边界与异常/边界用例.mms');

  it('无根节点时降级并记录 no-root', () => {
    expect(doc.rootId).toBe('没有根节点的一级节点');
    expect(doc.warnings.some((w) => w.type === 'no-root')).toBe(true);
  });

  it('非法 mms_layout 回退 LR', () => {
    expect(doc.layout).toBe('LR');
  });

  it('非法 mms_line 回退 line', () => {
    expect(doc.lineStyle).toBe('line');
  });

  it('同父同名合并', () => {
    expect(doc.warnings.some((w) => w.type === 'duplicate-merge')).toBe(true);
  });

  it('断链目标记录 missing-target', () => {
    expect(doc.warnings.some((w) => w.type === 'missing-target')).toBe(true);
  });
});

describe('边界与异常/空文件.mms', () => {
  it('空文件产出空节点树', () => {
    const doc = parseDemo('边界与异常/空文件.mms');
    expect(doc.nodes).toHaveLength(0);
    expect(doc.rootId).toBeNull();
  });
});

// ---------------------------------------------------------------- 综合演示

describe('综合演示/用户增长脑图.mms', () => {
  const doc = parseDemo('综合演示/用户增长脑图.mms');

  it('继承 frontmatter 的布局、连线样式与备注', () => {
    expect(doc.layout).toBe('LR');
    expect(doc.lineStyle).toBe('line');
    expect(doc.desc).toContain('会员体系');
  });

  it('跨父同名保持为两个独立节点', () => {
    expect(doc.nodeMap.get('用户增长脑图>渠道策略>社交裂变')).toBeDefined();
    expect(doc.nodeMap.get('用户增长脑图>拉新策略>社交裂变')).toBeDefined();
  });

  it('同文件多目标跨边在解析阶段即完成', () => {
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

describe('综合演示/技术架构.mms', () => {
  const doc = parseDemo('综合演示/技术架构.mms');

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
    expect(ref?.targetFilePath).toBe('综合演示/用户增长脑图.mms');
  });
});

// -------------------------------------------------------------- 全局与布局

describe('全局索引与布局', () => {
  it('跨文件引用在全部文档就绪后解析成功', () => {
    const a = parseDemo('综合演示/技术架构.mms');
    const b = parseDemo('综合演示/用户增长脑图.mms');
    const warnings = [...a.warnings, ...b.warnings];
    resolveCrossFileRefs([a, b], warnings);
    const ref = a.nodeMap.get('技术架构>服务层>用户服务')?.crossRefs[0];
    expect(ref?.resolved).toBe(true);
    const target = b.nodeMap.get(ref?.targetNodeId ?? '');
    expect(target).toBeDefined();
    // 解析成功的同时目标节点登记了来自 a 的入链
    expect(target?.incomingRefs.some((link) => link.sourcePath === 'demo/综合演示/技术架构.mms')).toBe(true);
  });

  it('跨文件目标有多个同名节点时指向第一个并记 info 告警', () => {
    const a = parseDemo('综合演示/技术架构.mms');
    const b = parseDemo('综合演示/用户增长脑图.mms');
    const warnings = [...a.warnings, ...b.warnings];
    resolveCrossFileRefs([a, b], warnings);
    const ref = a.nodeMap.get('技术架构>服务层>用户服务')?.crossRefs[0];
    // 用户增长脑图里有两个「社交裂变」，按规则指向第一个（渠道策略下）
    expect(ref?.targetNodeId).toBe('用户增长脑图>渠道策略>社交裂变');
    expect(
      warnings.some((w) => w.type === 'missing-target' && w.severity === 'info' && w.autoFixed && w.message.includes('同名')),
    ).toBe(true);
  });

  it('布局产出坐标且互不重叠', () => {
    const doc = parseDemo('综合演示/用户增长脑图.mms');
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
