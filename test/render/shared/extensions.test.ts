/**
 * @module test/render/shared/extensions.test
 * @description `!--` 指令渲染期继承与语义→画法映射的单元测试：
 * 就近覆盖、行为类不继承、不复制指令、KEY_RENDERERS 映射、折叠剪枝与运行时
 */

import { describe, expect, it } from 'vitest';
import { parseMms } from '../../../src/core/parser';
import {
  behaviorEnabled,
  createDirectiveRuntime,
  domNodeStyle,
  edgeStyleOf,
  KEY_RENDERERS,
  pruneCollapsed,
  resolveExtensions,
  svgNodeStyle,
} from '../../../src/render/shared/extensions';
import { KNOWN_DIRECTIVE_KEYS } from '../../../src/core/parser/directive';
import type { IMmsNode } from '../../../src/host/types';

const parse = (body: string, path = 'demo/t.mms') => parseMms(body, path);

/** 构造最小节点，仅填 resolveExtensions 关心的字段 */
const mkNode = (
  id: string,
  parentIds: string[],
  extensions?: Record<string, string>,
): IMmsNode => ({
  id,
  text: id,
  type: 'heading',
  depth: 0,
  lineNo: 1,
  content: [],
  annotation: [],
  childIds: [],
  parentIds,
  crossRefs: [],
  nodeRefs: [],
  incomingRefs: [],
  embeds: [],
  sourceFilePath: 'demo/t.mms',
  isAutoFix: false,
  extensions,
});

describe('样式类继承', () => {
  it('自身无值时沿祖先链就近补齐', () => {
    const doc = parse('# R\n!-- color > red\n## A\n-- x');
    const x = doc.nodeMap.get('R>A>x')!;
    expect(x.extensions).toEqual({});
    expect(resolveExtensions(x, doc.nodeMap)).toEqual({ color: 'red' });
  });

  it('自身有值优先（就近覆盖）', () => {
    const doc = parse('# R\n!-- color > red\n## A\n!-- color > blue\n-- x');
    const a = doc.nodeMap.get('R>A')!;
    const x = doc.nodeMap.get('R>A>x')!;
    expect(resolveExtensions(a, doc.nodeMap)).toEqual({ color: 'blue' });
    // 子节点取最近的祖先（A 的 blue），而非更远的 R
    expect(resolveExtensions(x, doc.nodeMap)).toEqual({ color: 'blue' });
  });

  it('中间层就近覆盖，其余 key 继续沿链补齐', () => {
    const doc = parse('# R\n!-- color > red\n!-- background > white\n## A\n!-- color > blue\n-- x');
    const x = doc.nodeMap.get('R>A>x')!;
    expect(resolveExtensions(x, doc.nodeMap)).toEqual({ color: 'blue', background: 'white' });
  });

  it('多层祖先链逐级向上查找', () => {
    const doc = parse('# R\n!-- color > red\n## A\n### B\n#### C');
    const c = doc.nodeMap.get('R>A>B>C')!;
    expect(resolveExtensions(c, doc.nodeMap)).toEqual({ color: 'red' });
  });
});

describe('行为类不继承', () => {
  it('父级的 collapsed 不影响子级', () => {
    const doc = parse('# R\n!-- collapsed\n## A\n-- x');
    const r = doc.nodeMap.get('R')!;
    const x = doc.nodeMap.get('R>A>x')!;
    expect(resolveExtensions(r, doc.nodeMap)).toEqual({ collapsed: 'true' });
    expect(resolveExtensions(x, doc.nodeMap)).toEqual({});
  });

  it('行为类在自身节点正常生效', () => {
    const doc = parse('# R\n## A\n!-- collapsed <-- ## A\n-- x');
    const a = doc.nodeMap.get('R>A')!;
    expect(resolveExtensions(a, doc.nodeMap)).toEqual({ collapsed: 'true' });
  });

  it('行为类不阻断同级样式类的继承', () => {
    const doc = parse('# R\n!-- collapsed\n!-- color > red\n## A\n-- x');
    const x = doc.nodeMap.get('R>A>x')!;
    expect(resolveExtensions(x, doc.nodeMap)).toEqual({ color: 'red' });
  });
});

describe('不复制指令', () => {
  it('求值不修改源节点的 extensions', () => {
    const doc = parse('# R\n!-- color > red\n## A\n-- x');
    const x = doc.nodeMap.get('R>A>x')!;
    resolveExtensions(x, doc.nodeMap);
    resolveExtensions(x, doc.nodeMap);
    expect(x.extensions).toEqual({});
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
  });
});

describe('边界情况', () => {
  it('无任何 extensions 时返回空对象', () => {
    const doc = parse('# R\n## A');
    const a = doc.nodeMap.get('R>A')!;
    expect(resolveExtensions(a, doc.nodeMap)).toEqual({});
  });

  it('多父节点（同名合并）取第一条父链', () => {
    const r1 = mkNode('R1', [], { color: 'red' });
    const r2 = mkNode('R2', [], { color: 'blue' });
    const child = mkNode('C', ['R1', 'R2']);
    const nodeMap = new Map([
      ['R1', r1],
      ['R2', r2],
      ['C', child],
    ]);
    expect(resolveExtensions(child, nodeMap)).toEqual({ color: 'red' });
  });

  it('父链出现环时不死循环', () => {
    const a = mkNode('A', ['B']);
    const b = mkNode('B', ['A']);
    const nodeMap = new Map([
      ['A', a],
      ['B', b],
    ]);
    expect(resolveExtensions(a, nodeMap)).toEqual({});
  });

  it('父 id 在 nodeMap 中不存在时安全终止', () => {
    const orphan = mkNode('O', ['幽灵']);
    expect(resolveExtensions(orphan, new Map([['O', orphan]]))).toEqual({});
  });

  it('文档级 extensions 作为最低优先级兜底补齐', () => {
    const doc = parse('!-- background > white\n# R\n## A\n-- x');
    const a = doc.nodeMap.get('R>A')!;
    // 孤儿指令挂文档级；A 自身与父链均无 background，从文档级兜底
    expect(doc.extensions).toEqual({ background: 'white' });
    expect(resolveExtensions(a, doc.nodeMap, doc.extensions)).toEqual({ background: 'white' });
  });
});

// ------------------------------------------------------------ 画法映射

describe('KEY_RENDERERS 完整性', () => {
  it('每个白名单 key 都有渲染声明', () => {
    for (const key of KNOWN_DIRECTIVE_KEYS) {
      expect(KEY_RENDERERS[key as keyof typeof KEY_RENDERERS]).toBeDefined();
    }
  });

  it('行为类三个 key 无样式落点', () => {
    for (const key of ['collapsed', 'debug', 'locked'] as const) {
      expect(KEY_RENDERERS[key].kind).toBe('behavior');
      expect(KEY_RENDERERS[key].domProp).toBeNull();
      expect(KEY_RENDERERS[key].svg).toBeNull();
    }
  });
});

describe('DOM 样式映射 domNodeStyle', () => {
  it('合法值映射到对应 CSS 属性，border-radius 补 px 单位', () => {
    expect(
      domNodeStyle({ color: 'red', 'border-radius': '8', opacity: '0.5' }),
    ).toEqual({ color: 'red', 'border-radius': '8px', opacity: '0.5' });
  });

  it('line-color / line-width 不作用于节点元素（连线专属）', () => {
    expect(domNodeStyle({ 'line-color': 'red', 'line-width': '2' })).toEqual({});
  });

  it('行为类 key 不进入样式映射', () => {
    expect(domNodeStyle({ collapsed: 'true', debug: 'true', locked: 'true' })).toEqual({});
  });

  it('非法颜色值不应用（防注入），合法 hex / rgb / 命名色通过', () => {
    expect(domNodeStyle({ color: 'expression(alert(1))' })).toEqual({});
    expect(domNodeStyle({ color: '#ff0000' })).toEqual({ color: '#ff0000' });
    expect(domNodeStyle({ color: 'rgb(1, 2, 3)' })).toEqual({ color: 'rgb(1, 2, 3)' });
    expect(domNodeStyle({ color: 'cornflowerblue' })).toEqual({ color: 'cornflowerblue' });
  });

  it('opacity 超界收敛到 [0,1]，非法值丢弃', () => {
    expect(domNodeStyle({ opacity: '2' })).toEqual({ opacity: '1' });
    expect(domNodeStyle({ opacity: '-1' })).toEqual({ opacity: '0' });
    expect(domNodeStyle({ opacity: 'abc' })).toEqual({});
  });

  it('同落点冲突按声明顺序后者覆盖（background 覆盖 color 的 DOM color 属性不受影响）', () => {
    // DOM 上 color→color、text-color→color 同落点，text-color 后声明则胜出
    expect(domNodeStyle({ color: 'red', 'text-color': 'blue' })).toEqual({ color: 'blue' });
  });
});

describe('SVG 样式映射 svgNodeStyle', () => {
  it('shape / text / group 三类落点正确分发（color 染文字与 DOM 一致）', () => {
    const { shape, text, group } = svgNodeStyle({
      color: 'red',
      'text-color': 'blue',
      opacity: '0.6',
      'border-radius': '6',
    });
    expect(shape).toEqual({ rx: '6' });
    expect(text).toEqual({ fill: 'blue' });
    expect(group).toEqual({ opacity: '0.6' });
  });

  it('color 与 text-color 同落 text.fill，声明在后的 text-color 胜出；background 独占 shape.fill', () => {
    expect(svgNodeStyle({ color: 'red', 'text-color': 'blue' }).text).toEqual({ fill: 'blue' });
    expect(svgNodeStyle({ color: 'red', background: 'yellow' })).toEqual({
      shape: { fill: 'yellow' },
      text: { fill: 'red' },
      group: {},
    });
  });

  it('line-* 与行为类不产生任何落点', () => {
    const { shape, text, group } = svgNodeStyle({ 'line-color': 'red', collapsed: 'true' });
    expect(shape).toEqual({});
    expect(text).toEqual({});
    expect(group).toEqual({});
  });
});

describe('连线样式 edgeStyleOf', () => {
  it('line-color + line-width 同时生效', () => {
    expect(edgeStyleOf({ 'line-color': '#27AE60', 'line-width': '2.5' })).toEqual({
      stroke: '#27AE60',
      strokeWidth: 2.5,
    });
  });

  it('仅有 line-width 时只返回 strokeWidth（不返回空 stroke）', () => {
    expect(edgeStyleOf({ 'line-width': '3' })).toEqual({ strokeWidth: 3 });
  });

  it('无连线 key 或值非法时返回 null', () => {
    expect(edgeStyleOf({})).toBeNull();
    expect(edgeStyleOf({ color: 'red' })).toBeNull();
    expect(edgeStyleOf({ 'line-width': '0' })).toBeNull();
    expect(edgeStyleOf({ 'line-color': 'not a color!' })).toBeNull();
  });
});

describe('行为类判定 behaviorEnabled', () => {
  it('有效值为 true 字符串时启用', () => {
    expect(behaviorEnabled({ collapsed: 'true' }, 'collapsed')).toBe(true);
    expect(behaviorEnabled({ collapsed: 'false' }, 'collapsed')).toBe(false);
    expect(behaviorEnabled(undefined, 'locked')).toBe(false);
    expect(behaviorEnabled({}, 'debug')).toBe(false);
  });
});

// ------------------------------------------------------------ 折叠剪枝

describe('折叠剪枝 pruneCollapsed', () => {
  const doc = parse('# R\n## A\n### A1\n-- A1x\n### A2\n## B\n-- Bx');
  // R > A > (A1 > A1x, A2), B > Bx

  it('折叠节点的子孙不入布局，childIds 被截断', () => {
    const { map } = pruneCollapsed(doc.rootId, doc.nodeMap, new Set(['R>A']));
    expect(map.has('R>A')).toBe(true);
    expect(map.has('R>A>A1')).toBe(false);
    expect(map.has('R>A>A1>A1x')).toBe(false);
    expect(map.has('R>A>A2')).toBe(false);
    // 折叠节点本身保留且 childIds 为空
    expect(map.get('R>A')?.childIds).toEqual([]);
    // 兄弟分支不受影响
    expect(map.has('R>B')).toBe(true);
    expect(map.has('R>B>Bx')).toBe(true);
  });

  it('hiddenCounts 基于原始全树统计后代总数', () => {
    const { hiddenCounts } = pruneCollapsed(doc.rootId, doc.nodeMap, new Set(['R>A']));
    expect(hiddenCounts.get('R>A')).toBe(3);
  });

  it('原 nodeMap 不被修改（浅拷贝截断）', () => {
    pruneCollapsed(doc.rootId, doc.nodeMap, new Set(['R>A']));
    expect(doc.nodeMap.get('R>A')?.childIds.length).toBe(2);
  });

  it('未折叠时原样复用节点引用', () => {
    const { map } = pruneCollapsed(doc.rootId, doc.nodeMap, new Set());
    expect(map.get('R>A')).toBe(doc.nodeMap.get('R>A'));
    expect(map.size).toBe(doc.nodes.length);
  });
});

// ------------------------------------------------------------ 渲染期运行时

describe('渲染期运行时 createDirectiveRuntime', () => {
  const doc = parse(
    [
      '!-- background > white',
      '# R',
      '!-- line-color > red',
      '## A',
      '!-- collapsed',
      '-- x',
      '## B',
      '!-- locked <-- ## B',
      '!-- debug',
    ].join('\n'),
  );

  it('metaOf 聚合继承样式与行为标志', () => {
    const rt = createDirectiveRuntime(doc);
    const x = doc.nodeMap.get('R>A>x')!;
    const meta = rt.metaOf(x);
    // 样式类继承：line-color 沿链、background 文档级兜底
    expect(meta.ext).toEqual({ 'line-color': 'red', background: 'white' });
    // 行为类不继承：collapsed 挂在 A 上不影响 x
    expect(meta.collapsed).toBe(false);
    expect(meta.locked).toBe(false);
    expect(meta.debug).toBe(false);
    expect(meta.foldable).toBe(false);

    const a = doc.nodeMap.get('R>A')!;
    const metaA = rt.metaOf(a);
    expect(metaA.collapsed).toBe(true);
    expect(metaA.foldable).toBe(true);
    expect(metaA.hiddenCount).toBe(1);

    const b = doc.nodeMap.get('R>B')!;
    expect(rt.metaOf(b).locked).toBe(true);
    // debug 默认绑定到最近的声明行（R>B）
    expect(rt.metaOf(b).debug).toBe(true);
  });

  it('折叠态来自指令初始态，overrides 优先且可反向展开', () => {
    const rtDefault = createDirectiveRuntime(doc);
    expect(rtDefault.collapsedIds.has('R>A')).toBe(true);

    const rtOverride = createDirectiveRuntime(
      doc,
      new Map([
        ['R>A', false],
        ['R', true],
      ]),
    );
    expect(rtOverride.collapsedIds.has('R>A')).toBe(false);
    expect(rtOverride.collapsedIds.has('R')).toBe(true);
    expect(rtOverride.metaOf(doc.nodeMap.get('R')!).hiddenCount).toBe(doc.nodes.length - 1);
  });

  it('auto 补齐节点无真实声明行、无法写回文档指令，不提供折叠徽标', () => {
    // # R → ### A3 跳级：R 与 A3 之间补一个 auto 空节点（有子节点但不可折叠）
    const skipDoc = parse('# R\n### A3\n-- x');
    const auto = skipDoc.nodes.find((n) => n.isAutoFix)!;
    expect(auto.childIds.length).toBeGreaterThan(0);
    const rt = createDirectiveRuntime(skipDoc);
    expect(rt.metaOf(auto).foldable).toBe(false);
    expect(rt.metaOf(skipDoc.nodeMap.get(auto.childIds[0])!).foldable).toBe(true);
  });

  it('edgeStyle 取 to 端（子节点）的有效 extensions', () => {
    const rt = createDirectiveRuntime(doc);
    // R>A>x 继承了 line-color: red
    expect(rt.edgeStyle('R>A>x')).toEqual({ stroke: 'red' });
    // R 根节点不在任何指令覆盖内（line-color 挂在 R 自身 → 指向 R 的边也取 R 的 ext）
    expect(rt.edgeStyle('R')).toEqual({ stroke: 'red' });
    expect(rt.edgeStyle('不存在')).toBeNull();
  });
});
