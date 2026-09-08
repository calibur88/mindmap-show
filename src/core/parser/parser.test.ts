/**
 * @module core/parser/parser.test
 * @description .mms 语法解析的单元测试
 */

import { describe, expect, it } from 'vitest';
import { parseMms } from '../parser';

const parse = (body: string, path = 'demo/t.mms') => parseMms(body, path);

describe('标题层级', () => {
  it('# 数量决定深度，且不受 H1~H6 限制', () => {
    const doc = parse('# R\n## A\n### B\n#### C\n##### D\n###### E\n####### F\n######## G');
    expect(doc.rootId).toBe('R');
    expect(doc.nodeMap.get('R>A>B>C>D>E>F>G')?.depth).toBe(7);
  });

  it('首个标题不是 # 时降级为根并记 no-root 警告', () => {
    const doc = parse('## A\n### B');
    expect(doc.rootId).toBe('A');
    expect(doc.nodeMap.get('A')?.depth).toBe(0);
    expect(doc.warnings.some((w) => w.type === 'no-root')).toBe(true);
  });

  it('跳级时自动补齐中间层级并记 level-skip', () => {
    const doc = parse('# R\n## A\n##### B');
    const fillers = doc.nodes.filter((n) => n.isAutoFix);
    expect(fillers).toHaveLength(2);
    expect(doc.nodeMap.get('R>A>B')).toBeUndefined();
    expect(doc.warnings.some((w) => w.type === 'level-skip')).toBe(true);
  });
});

describe('子节点与正文', () => {
  it('-- 挂在最近标题下且互为兄弟', () => {
    const doc = parse('# R\n## A\n-- x\n-- y\n## B');
    expect(doc.nodeMap.get('R>A>x')?.type).toBe('child');
    expect(doc.nodeMap.get('R>A>y')?.type).toBe('child');
    expect(doc.nodeMap.get('R>A')?.childIds).toEqual(['R>A>x', 'R>A>y']);
  });

  it('content 支持多行，遇到下一个标题即终止', () => {
    const doc = parse('# R\n第一行\n第二行\n## A');
    expect(doc.nodeMap.get('R')?.content).toEqual(['第一行', '第二行']);
    expect(doc.nodeMap.get('R>A')?.content).toEqual([]);
  });

  it('空行不计入 content', () => {
    const doc = parse('# R\n\n第一行\n\n');
    expect(doc.nodeMap.get('R')?.content).toEqual(['第一行']);
  });
});

describe('注释 (annotation) 分流', () => {
  it('** + 空格开头的行写入 annotation，与 content 分开', () => {
    const doc = parse('# R\n正文一行\n** 这是注释\n## A');
    expect(doc.nodeMap.get('R')?.content).toEqual(['正文一行']);
    expect(doc.nodeMap.get('R')?.annotation).toEqual(['这是注释']);
  });

  it('多行注释按顺序追加', () => {
    const doc = parse('# R\n** 第一行\n** 第二行');
    expect(doc.nodeMap.get('R')?.annotation).toEqual(['第一行', '第二行']);
  });

  it('**文本（紧贴）不解析为注释，保留为 content', () => {
    const doc = parse('# R\n**紧贴文本');
    expect(doc.nodeMap.get('R')?.annotation).toEqual([]);
    expect(doc.nodeMap.get('R')?.content).toEqual(['**紧贴文本']);
  });

  it('下一个 # 标题终止当前节点的注释收集', () => {
    const doc = parse('# R\n** 上一节点注释\n## A\n** 下一节点注释');
    expect(doc.nodeMap.get('R')?.annotation).toEqual(['上一节点注释']);
    expect(doc.nodeMap.get('R>A')?.annotation).toEqual(['下一节点注释']);
  });
});

describe('跨边引用', () => {
  it('支持前向引用', () => {
    const doc = parse('# R\n## A\n<=> B\n## B');
    const ref = doc.nodeMap.get('R>A')?.crossRefs[0];
    expect(ref?.resolved).toBe(true);
    expect(ref?.targetNodeId).toBe('R>B');
  });

  it('支持多目标与 Tab 分隔的备注', () => {
    const doc = parse('# R\n## A\n<=> B, C\t联动链路\n## B\n## C');
    const refs = doc.nodeMap.get('R>A')?.crossRefs ?? [];
    expect(refs).toHaveLength(2);
    expect(refs[0].label).toBe('联动链路');
    expect(refs[1].targetNodeId).toBe('R>C');
  });

  it('备注也支持两个以上空格分隔', () => {
    const doc = parse('# R\n## A\n<=> B   备注文本\n## B');
    expect(doc.nodeMap.get('R>A')?.crossRefs[0].label).toBe('备注文本');
  });

  it('目标不存在时记 missing-target 且不抛异常', () => {
    const doc = parse('# R\n## A\n<=> 不存在');
    expect(doc.nodeMap.get('R')?.crossRefs).toHaveLength(0);
    const ref = doc.nodeMap.get('R>A')?.crossRefs[0];
    expect(ref?.resolved).toBe(false);
    expect(doc.warnings.some((w) => w.type === 'missing-target')).toBe(true);
  });

  it('目标节点记录 incomingRefs', () => {
    const doc = parse('# R\n## A\n<=> B\n## B');
    expect(doc.nodeMap.get('R>B')?.incomingRefs).toHaveLength(1);
  });
});

describe('嵌入分流', () => {
  it('按扩展名分为 image / mms / file / url', () => {
    const doc = parse('# R\n## A\n![[a.png]]\n![[b.mms]]\n![[c.pdf]]\nhttps://example.com');
    const kinds = doc.nodeMap.get('R>A')?.embeds.map((e) => e.kind);
    expect(kinds).toEqual(['image', 'mms', 'file', 'url']);
  });
});

describe('同名节点合并', () => {
  it('同父下同名合并为一个节点', () => {
    const doc = parse('# R\n## A\n-- x\n-- x');
    expect(doc.nodes.filter((n) => n.id === 'R>A>x')).toHaveLength(1);
    expect(doc.nodeMap.get('R>A>x')?.parentIds).toEqual(['R>A']);
    expect(doc.warnings.some((w) => w.type === 'duplicate-merge')).toBe(true);
  });

  it('跨父同名保持独立', () => {
    const doc = parse('# R\n## A\n-- x\n## B\n-- x');
    expect(doc.nodeMap.get('R>A>x')).toBeDefined();
    expect(doc.nodeMap.get('R>B>x')).toBeDefined();
    expect(doc.nodeMap.get('R>A>x')).not.toBe(doc.nodeMap.get('R>B>x'));
  });
});

describe('边界情况', () => {
  it('空文件给出 no-root 警告与空节点树', () => {
    const doc = parse('');
    expect(doc.nodes).toHaveLength(0);
    expect(doc.rootId).toBeNull();
    expect(doc.warnings.some((w) => w.type === 'no-root')).toBe(true);
  });

  it('行号包含 frontmatter 偏移，指向源文件真实行', () => {
    const content = '---\nmms_name: X\nmms_desc: Y\n---\n# R\n## A';
    const doc = parse(content);
    expect(doc.nodeMap.get('R')?.lineNo).toBe(5);
    expect(doc.nodeMap.get('R>A')?.lineNo).toBe(6);
  });

  it('显示名优先 frontmatter，否则取文件名', () => {
    expect(parse('# R', 'demo/文件.mms').displayName).toBe('文件');
    expect(parse('---\nmms_name: 别名\n---\n# R', 'demo/文件.mms').displayName).toBe('别名');
  });

  it('继承 frontmatter 的标签与备注', () => {
    const doc = parse('---\nmms_tags: [a, b]\nmms_desc: 说明\n---\n# R');
    expect(doc.tags).toEqual(['a', 'b']);
    expect(doc.desc).toBe('说明');
  });
});
