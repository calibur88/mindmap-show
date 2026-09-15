/**
 * @module test/utils/make-key.test
 * @description 节点 id 构造与引用目标解析的单测（规范 §3.3 归一化 / §6.4 引用语法）
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  DEFAULT_LINE_STYLE,
  ID_SEP,
  makeNodeId,
  normalizeText,
  parseNodeRefTarget,
  parseRefTarget,
  shortNodeName,
} from '../../src/utils/make-key';

describe('常量', () => {
  it('默认布局与连线样式为规范的缺省值', () => {
    expect(DEFAULT_LAYOUT).toBe('LR');
    expect(DEFAULT_LINE_STYLE).toBe('line');
  });

  it('层级分隔符为 >', () => {
    expect(ID_SEP).toBe('>');
  });
});

describe('normalizeText（规范 §3.3：去零宽 → 折叠空白 → trim）', () => {
  it('去首尾空白', () => {
    expect(normalizeText('  a b  ')).toBe('a b');
  });

  it('折叠连续空白为一个半角空格', () => {
    expect(normalizeText('a  b')).toBe('a b');
    expect(normalizeText('a\t\tb')).toBe('a b');
  });

  it('去零宽字符（U+200B-U+200D 与 U+FEFF）', () => {
    expect(normalizeText('a\u200Bb')).toBe('ab');
    expect(normalizeText('a\u200Cb\u200Dc')).toBe('abc');
    expect(normalizeText('\uFEFFx')).toBe('x');
  });

  it('零宽字符挡在首尾时，其后的空白照样被去掉', () => {
    // 若把 trim 放在去零宽之前，这里会残留空格
    expect(normalizeText('\u200B  甲  \u200B')).toBe('甲');
  });

  it('纯空白与空串都归零', () => {
    expect(normalizeText('   ')).toBe('');
    expect(normalizeText('')).toBe('');
  });
});

describe('makeNodeId（仅同父下合并的基础）', () => {
  it('根节点 id 就是归一化文本', () => {
    expect(makeNodeId(null, ' 根 ')).toBe('根');
  });

  it('子节点 id 为 父id>文本', () => {
    expect(makeNodeId('根', '子')).toBe('根>子');
    expect(makeNodeId('根', '子')).toBe(`根${ID_SEP}子`);
  });

  it('零宽字符与多余空白不再区分 id', () => {
    expect(makeNodeId('R', 'a\u200Bb')).toBe(makeNodeId('R', 'ab'));
    expect(makeNodeId('R', ' a  b ')).toBe(makeNodeId('R', 'a b'));
  });
});

describe('parseRefTarget（<=> 跨边目标，跨文件用空格分隔）', () => {
  it('跨文件目标拆出文件路径与节点文本', () => {
    expect(parseRefTarget('其他.mms 目标节点')).toEqual({
      filePath: '其他.mms',
      nodeText: '目标节点',
    });
  });

  it('允许两个以上空白或 Tab 作分隔，两侧都 trim', () => {
    expect(parseRefTarget('  其他.mms \t 目标 节点  ')).toEqual({
      filePath: '其他.mms',
      nodeText: '目标 节点',
    });
  });

  it('同文件目标只有节点文本', () => {
    expect(parseRefTarget('目标节点')).toEqual({ filePath: null, nodeText: '目标节点' });
  });

  it('首个 token 不以 .mms 结尾时整体按同文件处理，绝不切出 filePath', () => {
    expect(parseRefTarget('其他 文件.mms 节点')).toEqual({
      filePath: null,
      nodeText: '其他 文件.mms 节点',
    });
    expect(parseRefTarget('其他.mms')).toEqual({ filePath: null, nodeText: '其他.mms' });
  });

  it('扩展名大小写不敏感，但保留原始大小写', () => {
    expect(parseRefTarget('A.MMS 节点')).toEqual({ filePath: 'A.MMS', nodeText: '节点' });
  });
});

describe('parseNodeRefTarget（:: 节点引用，跨文件用 ::）', () => {
  it('跨文件引用拆出文件路径与节点文本', () => {
    expect(parseNodeRefTarget('其他.mms::目标节点')).toEqual({
      filePath: '其他.mms',
      nodeText: '目标节点',
    });
  });

  it('分隔符两侧可有空白', () => {
    expect(parseNodeRefTarget('其他.mms :: 目标节点')).toEqual({
      filePath: '其他.mms',
      nodeText: '目标节点',
    });
  });

  it('无分隔符时只有节点文本', () => {
    expect(parseNodeRefTarget('目标节点')).toEqual({ filePath: null, nodeText: '目标节点' });
    expect(parseNodeRefTarget('  目标节点  ')).toEqual({ filePath: null, nodeText: '目标节点' });
  });

  it('以分隔符开头时空文件路径（调用方按假值当作同文件）', () => {
    expect(parseNodeRefTarget('::目标节点')).toEqual({ filePath: '', nodeText: '目标节点' });
  });
});

describe('shortNodeName', () => {
  it('取 id 最后一段', () => {
    expect(shortNodeName('根>A>叶')).toBe('叶');
  });

  it('无分隔符时原样返回', () => {
    expect(shortNodeName('根')).toBe('根');
  });

  it('空串不炸', () => {
    expect(shortNodeName('')).toBe('');
  });
});
