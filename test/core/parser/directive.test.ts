/**
 * @module test/core/parser/directive.test
 * @description `!--` 指令语法的单元测试：行格式、绑定、目标寻址、冲突与警告
 */

import { describe, expect, it } from 'vitest';
import { parseMms } from '../../../src/core/parser';

const parse = (body: string, path = 'demo/t.mms') => parseMms(body, path);

// ------------------------------------------------------------ 行格式与剥离

describe('指令：行尾注释 <** 剥离', () => {
  it('标题行的 <** 剥离，不进入标题文本', () => {
    const doc = parse('## 你好 <**行尾注释在标题行生效');
    expect(doc.nodes.map((n) => n.text)).toEqual(['你好']);
  });

  it('指令行的 <** 剥离，其后即使有 <-- 也一并丢弃', () => {
    const doc = parse('# R\n!-- color > red <**注释 <-- ## X\n## X');
    // <-- 在注释内被丢弃 → 默认绑定到 R
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({});
  });

  it('content 行的 <** 剥离', () => {
    const doc = parse('# R\n正文一行 <**这是行尾注释');
    expect(doc.nodeMap.get('R')?.content).toEqual(['正文一行']);
  });

  it('child 行的 <** 剥离', () => {
    const doc = parse('# R\n-- 子节点 <**行尾注释');
    expect(doc.nodeMap.get('R>子节点')?.text).toBe('子节点');
  });
});

describe('指令：行格式解析', () => {
  it('key > value 基本格式', () => {
    const doc = parse('# R\n!-- color > #ff0000');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: '#ff0000' });
  });

  it('无 > 时 value 为空串（样式类）', () => {
    const doc = parse('# R\n!-- color');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: '' });
  });

  it('有 > 但 value 为空与无 > 行为一致（样式类）', () => {
    const doc = parse('# R\n!-- color >');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: '' });
  });

  it('value 中的其余 > 原样保留', () => {
    const doc = parse('# R\n!-- background > linear-gradient(red > blue)');
    expect(doc.nodeMap.get('R')?.extensions?.background).toBe('linear-gradient(red > blue)');
  });

  it('<!-- 右侧为空视同无目标（默认绑定）', () => {
    const doc = parse('# R\n!-- color > red <--\n## X');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({});
  });

  it('<-- 多次出现：首个生效，其余属目标文本', () => {
    const doc = parse('# R\n!-- color > red <-- ## X <-- ## Y\n## X\n## Y');
    // 目标文本为「X <-- ## Y」，无此节点 → warning，指令不绑定
    expect(doc.warnings.some((w) => w.type === 'directive-target-missing')).toBe(true);
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({});
  });

  it('无有效 key（!-- 或 !-- > 值）静默忽略，不产生警告', () => {
    const doc = parse('# R\n!--\n!-- > 值');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({});
    expect(doc.warnings).toHaveLength(0);
  });
});

describe('指令：key 归一化', () => {
  it('连续空格归一为单个 - 并转小写（line color → line-color）', () => {
    const doc = parse('# R\n!-- line color > red');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ 'line-color': 'red' });
  });

  it('大写 key 与多空格写法归一后等价', () => {
    const doc = parse('# R\n!-- Line  COLOR > red');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ 'line-color': 'red' });
  });

  it('归一化后同名 key 视为冲突', () => {
    const doc = parse('# R\n!-- line color > red\n!-- Line-Color > blue');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ 'line-color': 'red' });
    expect(doc.warnings.some((w) => w.type === 'directive-conflict')).toBe(true);
  });

  it('未知 key 记 directive-unknown-key 警告且不存储', () => {
    const doc = parse('# R\n!-- custom key > 任意值');
    const warn = doc.warnings.find((w) => w.type === 'directive-unknown-key');
    expect(warn).toBeDefined();
    expect(warn?.lineNo).toBe(2);
    expect(warn?.severity).toBe('warning');
    expect(warn?.message).toContain('custom-key');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({});
  });

  it('transform / shadow / font / line-dash 等清单外 key 一律按未知 key 告警', () => {
    const doc = parse('# R\n!-- transform > scale(1.2)\n!-- font > bold\n!-- line-dash > 4');
    expect(doc.warnings.filter((w) => w.type === 'directive-unknown-key')).toHaveLength(3);
    expect(doc.nodeMap.get('R')?.extensions).toEqual({});
  });

  it('归一化后命中白名单的 key 正常存储（line color → line-color）', () => {
    const doc = parse('# R\n!-- Line  Color > red');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ 'line-color': 'red' });
    expect(doc.warnings).toHaveLength(0);
  });
});

describe('指令：行为类 value 表', () => {
  it('collapsed 无 value 归 true', () => {
    const doc = parse('# R\n!-- collapsed');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ collapsed: 'true' });
  });

  it('collapsed 空 value（带 >）同样归 true', () => {
    const doc = parse('# R\n!-- collapsed >');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ collapsed: 'true' });
  });

  it('collapsed value trim 且不区分大小写', () => {
    const doc = parse('# R\n!-- collapsed > FALSE');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ collapsed: 'false' });
  });

  it('样式类 value 区分大小写原样保留', () => {
    const doc = parse('# R\n!-- color > #FFaa00');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: '#FFaa00' });
  });
});

// --------------------------------------------------------------- 绑定规则

describe('指令：默认绑定', () => {
  it('无 <-- 时绑定上方最近的节点声明行', () => {
    const doc = parse('# R\n## A\n!-- color > red\n## B\n!-- color > blue');
    expect(doc.nodeMap.get('R>A')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R>B')?.extensions).toEqual({ color: 'blue' });
  });

  it('指令块穿插 ** 注释、空行、<=>、![[ 不打断绑定', () => {
    const doc = parse('# R\n** 批注\n\n<=> A\n![[a.png]]\n!-- color > red\n## A');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
  });

  it('仅新的节点声明行结束指令块（-- 同样接收）', () => {
    const doc = parse('# R\n-- x\n!-- color > red');
    expect(doc.nodeMap.get('R>x')?.extensions).toEqual({ color: 'red' });
  });

  it('孤儿指令挂文档级 document.extensions', () => {
    const doc = parse('!-- color > red\n# R');
    expect(doc.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R')?.extensions).toEqual({});
  });

  it('冗余写法：目标节点紧下方 <-- 指向自身，与默认绑定等价', () => {
    const doc = parse('# R\n!-- color > red <-- # R');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
  });
});

// --------------------------------------------------------------- 目标寻址

describe('指令：目标寻址', () => {
  it('# 个数 = 目标节点声明层级（精确匹配）', () => {
    const doc = parse('# R\n!-- color > red <-- ## X\n## X\n### Y');
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R>X>Y')?.extensions).toEqual({});
  });

  it('支持前向引用（目标在指令下方）', () => {
    const doc = parse('# R\n!-- color > red <-- ## X\n## X');
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({ color: 'red' });
  });

  it('最近距离匹配：上方更近命中上方（规范 §5 示例）', () => {
    const doc = parse('# 你好\n!-- color > #ffff <-- ## 不好\n## 不好\n# 其他\n## 不好');
    expect(doc.nodeMap.get('你好>不好')?.extensions).toEqual({ color: '#ffff' });
    expect(doc.nodeMap.get('其他>不好')?.extensions).toEqual({});
  });

  it('最近距离匹配：下方更近命中下方', () => {
    const doc = parse('## 不好\n# 其他\n## 不好\n!-- color > red <-- ## 不好');
    // 上方距离 3、下方距离 1 → 命中「其他>不好」
    expect(doc.nodeMap.get('其他>不好')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodes[0]?.extensions).toEqual({});
  });

  it('距离相同时文档序靠前（上方）者胜出', () => {
    const doc = parse('## X\n!-- color > red <-- ## X\n## X');
    expect(doc.nodes[0]?.extensions).toEqual({ color: 'red' });
    expect(doc.nodes[1]?.extensions).toEqual({});
  });

  it('层级不匹配触发 directive-target-missing 且指令不绑定', () => {
    const doc = parse('# R\n!-- color > red <-- ### X\n## X');
    const warn = doc.warnings.find((w) => w.type === 'directive-target-missing');
    expect(warn).toBeDefined();
    expect(warn?.lineNo).toBe(2);
    expect(warn?.severity).toBe('warning');
    expect(warn?.message).toContain('### X');
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({});
  });

  it('目标不存在时解析不报错、不影响其他指令', () => {
    const doc = parse('# R\n!-- color > red <-- ## 不存在\n!-- background > blue');
    expect(doc.warnings.some((w) => w.type === 'directive-target-missing')).toBe(true);
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ background: 'blue' });
  });

  it('节点文本区分大小写精确匹配', () => {
    const doc = parse('# R\n!-- color > red <-- ## x\n## X');
    expect(doc.warnings.some((w) => w.type === 'directive-target-missing')).toBe(true);
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({});
  });

  it('带层级的寻址同时覆盖 ## 标题与 -- 子节点（同一结构层）', () => {
    const doc = parse('# R\n-- x\n!-- color > red <-- ## x');
    // 「-- x」在 # R 之下，结构层级为 2，与 ## 声明同级，可被 ## 前缀寻址
    expect(doc.nodeMap.get('R>x')?.extensions).toEqual({ color: 'red' });
  });

  it('指令行内的 ![[ 不入 embeds', () => {
    const doc = parse('# R\n!-- color > red ![[a.png]]');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red ![[a.png]]' });
    expect(doc.nodeMap.get('R')?.embeds).toHaveLength(0);
  });
});

// --------------------------------------------------------------- 冲突裁决

describe('指令：冲突处理', () => {
  it('同一节点同一 key 保留先写者，后到者记 directive-conflict', () => {
    const doc = parse('# R\n!-- color > red\n!-- color > blue');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
    const warn = doc.warnings.find((w) => w.type === 'directive-conflict');
    expect(warn).toBeDefined();
    expect(warn?.lineNo).toBe(3);
    expect(warn?.severity).toBe('warning');
  });

  it('不同 key 不冲突', () => {
    const doc = parse('# R\n!-- color > red\n!-- background > blue');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red', background: 'blue' });
    expect(doc.warnings.some((w) => w.type === 'directive-conflict')).toBe(false);
  });

  it('默认绑定与显式目标指向同一节点时同样按行号裁决', () => {
    const doc = parse('# R\n!-- color > red\n!-- color > blue <-- # R');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
    expect(doc.warnings.some((w) => w.type === 'directive-conflict')).toBe(true);
  });

  it('不同节点上的同名 key 不冲突', () => {
    const doc = parse('# R\n!-- color > red\n## X\n!-- color > blue');
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
    expect(doc.nodeMap.get('R>X')?.extensions).toEqual({ color: 'blue' });
  });
});

describe('指令：绑定行索引 directiveBindings', () => {
  it('成功绑定的指令按文档序记录行号与归属，孤儿指令 nodeId 为 null', () => {
    const doc = parse(
      [
        '!-- background > white', // 1：孤儿 → 文档级
        '# R', // 2
        '!-- color > red', // 3：默认绑定 R
        '## A', // 4
        '!-- collapsed', // 5：默认绑定 A
        '-- x', // 6
        '!-- debug <-- ## A', // 7：目标绑定 A
      ].join('\n'),
    );
    expect(doc.directiveBindings).toEqual([
      { key: 'background', lineNo: 1, nodeId: null },
      { key: 'color', lineNo: 3, nodeId: 'R' },
      { key: 'collapsed', lineNo: 5, nodeId: 'R>A' },
      { key: 'debug', lineNo: 7, nodeId: 'R>A' },
    ]);
  });

  it('冲突与寻址失败的指令不进入 bindings', () => {
    const doc = parse('# R\n!-- color > red\n!-- color > blue\n!-- debug <-- ## 不存在');
    expect(doc.directiveBindings).toEqual([{ key: 'color', lineNo: 2, nodeId: 'R' }]);
  });
});

// --------------------------------------------------------------- 既有语法回归

describe('指令：分流优先级回归', () => {
  it('# 无空格不作为标题，也不进入指令解析', () => {
    const doc = parse('# R\n#无空格\n#!- 也不是指令');
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodeMap.get('R')?.content).toEqual(['#无空格', '#!- 也不是指令']);
  });

  it('** 注释行优先级高于指令，不被 !-- 分流影响', () => {
    const doc = parse('# R\n** 这是批注\n!-- color > red');
    expect(doc.nodeMap.get('R')?.annotation).toEqual(['这是批注']);
    expect(doc.nodeMap.get('R')?.extensions).toEqual({ color: 'red' });
  });

  it('<=> 与 :: 行不受指令分流影响', () => {
    const doc = parse('# R\n## A\n<=> B\n:: B\n## B\n!-- color > red');
    expect(doc.nodeMap.get('R>A')?.crossRefs[0]?.targetNodeId).toBe('R>B');
    expect(doc.nodeMap.get('R>A')?.nodeRefs[0]?.targetNodeId).toBe('R>B');
    expect(doc.nodeMap.get('R>B')?.extensions).toEqual({ color: 'red' });
  });

  it('规范 §9 示例一：注释剥离 + 目标寻址', () => {
    const doc = parse(
      '## 你好 <**行尾注释在标题行生效\n!-- color > #ffff <-- ## 你好\n## 不好\n# 其他\n## 不好',
    );
    expect(doc.nodes[0]?.text).toBe('你好');
    expect(doc.nodes[0]?.extensions).toEqual({ color: '#ffff' });
    expect(doc.nodes.filter((n) => n.text === '不好').every((n) => Object.keys(n.extensions ?? {}).length === 0)).toBe(true);
  });

  it('规范 §9 示例二：默认绑定 + 多 > value + 行为类', () => {
    const doc = parse(
      [
        '# 首页',
        '!-- color > #2C3E50',
        '!-- background > linear-gradient(red > blue) <-- ## 详情页',
        '## 详情页',
        '-- 组件A',
        '-- 组件B',
        '!-- collapsed <-- ## 详情页',
      ].join('\n'),
    );
    expect(doc.nodeMap.get('首页')?.extensions).toEqual({ color: '#2C3E50' });
    expect(doc.nodeMap.get('首页>详情页')?.extensions).toEqual({
      background: 'linear-gradient(red > blue)',
      collapsed: 'true',
    });
    expect(doc.nodeMap.get('首页>详情页>组件A')?.extensions).toEqual({});
    expect(doc.nodeMap.get('首页>详情页>组件B')?.extensions).toEqual({});
  });
});
