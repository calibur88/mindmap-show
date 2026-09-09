/**
 * @module core/layout/layout.test
 * @description 四方向布局的单元测试：验证主轴推进方向与层级翻转
 */

import { describe, expect, it } from 'vitest';
import { parseMms } from '../parser';
import { layoutTree } from './index';
import type { MmsLayout } from '../../host/types';

const doc = parseMms('# R\n## A\n## B', 'demo/t.mms');

function layout(direction: MmsLayout) {
  return layoutTree(doc.rootId, doc.nodeMap, { direction, nodeGap: 16, levelGap: 64 });
}

describe('布局方向', () => {
  it('TB：父在上，子在下', () => {
    const { nodes } = layout('TB');
    const root = nodes.get('R')!;
    const child = nodes.get('R>A')!;
    expect(child.y).toBeGreaterThan(root.y + root.height - 1);
    // 子节点在水平方向展开，两个兄弟不重叠
    const a = nodes.get('R>A')!;
    const b = nodes.get('R>B')!;
    expect(a.x).not.toBe(b.x);
    expect(a.y).toBe(b.y);
  });

  it('BT：父在下，子向上展开', () => {
    const { nodes } = layout('BT');
    const root = nodes.get('R')!;
    const child = nodes.get('R>A')!;
    expect(child.y + child.height).toBeLessThan(root.y + 1);
    // 交叉轴仍是水平，兄弟同 y
    expect(nodes.get('R>A')!.y).toBe(nodes.get('R>B')!.y);
  });

  it('BT 与 TB 的节点尺寸、交叉轴坐标一致，仅主轴翻转', () => {
    const tb = layout('TB').nodes;
    const bt = layout('BT').nodes;
    for (const [id, node] of tb) {
      expect(bt.get(id)!.x).toBe(node.x);
      expect(bt.get(id)!.width).toBe(node.width);
      expect(bt.get(id)!.height).toBe(node.height);
    }
    expect(tb.get('R')!.y).toBe(0);
    expect(bt.get('R')!.y).toBeGreaterThan(0);
  });

  it('LR / RL 保持原有语义', () => {
    const lr = layout('LR').nodes;
    const rl = layout('RL').nodes;
    expect(lr.get('R>A')!.x).toBeGreaterThan(lr.get('R')!.x);
    expect(rl.get('R>A')!.x + rl.get('R>A')!.width).toBeLessThan(rl.get('R')!.x + 1);
  });

  it('垂直布局的结果宽高由交叉轴 / 主轴决定', () => {
    const bt = layout('BT');
    const tb = layout('TB');
    expect(bt.width).toBe(tb.width);
    expect(bt.height).toBe(tb.height);
  });
});
