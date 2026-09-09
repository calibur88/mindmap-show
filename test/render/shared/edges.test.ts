/**
 * @module test/render/shared/edges.test
 * @description 连线路径的单元测试：锚点取值、直线插值与曲线安全推力
 */

import { describe, expect, it } from 'vitest';
import { buildEdgePath } from '../../../src/render/shared/edges';
import type { ILayoutNode, MmsLayout, MmsLineStyle } from '../../../src/host/types';

const node = (x: number, y: number, width = 100, height = 40): ILayoutNode => ({
  id: `${x},${y}`,
  x,
  y,
  width,
  height,
  depth: 0,
});

const path = (
  from: ILayoutNode,
  to: ILayoutNode,
  direction: MmsLayout,
  lineStyle: MmsLineStyle = 'line',
  gap = 64,
): string => buildEdgePath(from, to, { direction, lineStyle, gap });

describe('锚点取值', () => {
  it('TB 取父下中 → 子上中', () => {
    expect(path(node(0, 0), node(0, 100), 'TB')).toBe('M 50 40 L 50 100');
  });

  it('BT 取父上中 → 子下中', () => {
    expect(path(node(0, 200), node(0, 0), 'BT')).toBe('M 50 200 L 50 40');
  });

  it('LR 取父右中 → 子左中', () => {
    expect(path(node(0, 0), node(200, 0), 'LR')).toBe('M 100 20 L 200 20');
  });

  it('RL 取父左中 → 子右中', () => {
    expect(path(node(200, 0), node(0, 0), 'RL')).toBe('M 200 20 L 100 20');
  });
});

describe('直角折线模式', () => {
  it('垂直布局先竖后横，拐点取纵向中线', () => {
    expect(path(node(0, 0), node(100, 100), 'TB', 'elbow')).toBe(
      'M 50 40 L 50 70 L 150 70 L 150 100',
    );
  });

  it('水平布局先横后竖，拐点取横向中线', () => {
    expect(path(node(0, 0), node(200, 100), 'LR', 'elbow')).toBe(
      'M 100 20 L 150 20 L 150 120 L 200 120',
    );
  });

  it('BT / RL 同样以中线拐点连接，只是锚点翻转', () => {
    expect(path(node(0, 200), node(100, 0), 'BT', 'elbow')).toBe(
      'M 50 200 L 50 120 L 150 120 L 150 40',
    );
    expect(path(node(300, 0), node(0, 100), 'RL', 'elbow')).toBe(
      'M 300 20 L 200 20 L 200 120 L 100 120',
    );
  });
});

describe('曲线模式 · 安全推力', () => {
  it('正对直连强制 ≥ 25px 鼓起', () => {
    // spread = 0 → h 由 5 抬到 25，控制点在中线两侧对称
    expect(path(node(0, 0), node(0, 100), 'TB', 'curve')).toBe('M 50 40 C 75 70 25 70 50 100');
  });

  it('左侧子节点向左鼓，右侧子节点向右鼓', () => {
    const left = path(node(0, 0), node(-150, 100), 'TB', 'curve');
    const right = path(node(0, 0), node(150, 100), 'TB', 'curve');
    // 左子：起点 50，控制点 -14 / -36，终点 -100
    expect(left).toBe('M 50 40 C -14 70 -36 70 -100 100');
    // 右子：控制点取正方向
    expect(right).toBe('M 50 40 C 114 70 136 70 200 100');
  });

  it('推力不超过预设间距 H0', () => {
    // spread 足够大时 h 被 gap 截断（gap = 20）
    expect(path(node(0, 0), node(400, 100), 'TB', 'curve', 20)).toBe(
      'M 50 40 C 70 70 430 70 450 100',
    );
  });

  it('极限陡坡按流向轴位移增压', () => {
    // 水平布局：spread = 5、flow = 500，触发 0.18 增压 → h = 90
    expect(path(node(0, 0), node(600, 5), 'LR', 'curve', 100)).toBe(
      'M 100 20 C 350 110 350 -65 600 25',
    );
  });

  it('控制点不交错：h ≤ 0.45 × |展开轴位移|', () => {
    // spread = 100 → h ≤ 45，取 min(gap=64, 45) = 45
    expect(path(node(0, 0), node(100, 200), 'TB', 'curve')).toBe(
      'M 50 40 C 95 120 105 120 150 200',
    );
  });
});
