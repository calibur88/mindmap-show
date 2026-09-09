/**
 * @module test/core/frontmatter.test
 * @description Frontmatter 剥离与字段提取的单元测试
 */

import { describe, expect, it } from 'vitest';
import { resolveLayout, resolveLineStyle, splitFrontmatter } from '../../src/core/frontmatter';

describe('splitFrontmatter', () => {
  it('首行不是 --- 时不解析，正文为全文', () => {
    const result = splitFrontmatter('# 根\n正文\n---\n分割线');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('# 根\n正文\n---\n分割线');
    expect(result.bodyStartLine).toBe(1);
  });

  it('有开头无闭合时降级为纯正文', () => {
    const result = splitFrontmatter('---\nmms_name: X\n# 根');
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe('---\nmms_name: X\n# 根');
  });

  it('提取四个固定字段', () => {
    const result = splitFrontmatter('---\nmms_name: 增长\nmms_tags: 任务, 进度\nmms_layout: TB\nmms_desc: 备注\n---\n# 根');
    expect(result.frontmatter).toEqual({
      mms_name: '增长',
      mms_tags: ['任务', '进度'],
      mms_layout: 'TB',
      mms_desc: '备注',
    });
    expect(result.body).toBe('# 根');
  });

  it('mms_name 剥离行内注释', () => {
    const result = splitFrontmatter('---\nmms_name: 增长 # 这是注释\n---\n# 根');
    expect(result.frontmatter?.mms_name).toBe('增长');
  });

  it('mms_tags 同时支持字符串与数组两种写法', () => {
    expect(splitFrontmatter('---\nmms_tags: a, b\n---\n# R').frontmatter?.mms_tags).toEqual(['a', 'b']);
    expect(splitFrontmatter('---\nmms_tags: [a, b]\n---\n# R').frontmatter?.mms_tags).toEqual(['a', 'b']);
  });

  it('mms_tags 支持 YAML 块列表（Obsidian 属性面板写入格式）', () => {
    const fm = splitFrontmatter('---\nmms_name: 边界用例\nmms_tags:\n  - 示例\n  - 边界与异常\n  - 时代的\n---\n# 根').frontmatter;
    expect(fm?.mms_name).toBe('边界用例');
    expect(fm?.mms_tags).toEqual(['示例', '边界与异常', '时代的']);
  });

  it('mms_tags 块列表项带引号与行尾逗号时剥离', () => {
    const fm = splitFrontmatter('---\nmms_tags:\n  - "a",\n  - \'b\'\n---\n# R').frontmatter;
    expect(fm?.mms_tags).toEqual(['a', 'b']);
  });

  it('mms_tags 块列表在下一个键处停止，不吞其他字段', () => {
    const fm = splitFrontmatter('---\nmms_tags:\n  - a\nmms_layout: TB\nmms_desc: 备注\n---\n# R').frontmatter;
    expect(fm?.mms_tags).toEqual(['a']);
    expect(fm?.mms_layout).toBe('TB');
    expect(fm?.mms_desc).toBe('备注');
  });

  it('mms_tags 同行有值时优先同行，不读块列表', () => {
    const fm = splitFrontmatter('---\nmms_tags: a, b\nmms_layout: TB\n---\n# R').frontmatter;
    expect(fm?.mms_tags).toEqual(['a', 'b']);
  });

  it('mms_tags 空值且无块列表时为空数组（不误读下一个键）', () => {
    const fm = splitFrontmatter('---\nmms_tags:\nmms_layout: TB\n---\n# R').frontmatter;
    expect(fm?.mms_tags).toEqual([]);
  });

  it('mms_layout 非法值被忽略', () => {
    expect(splitFrontmatter('---\nmms_layout: XX\n---\n# R').frontmatter?.mms_layout).toBeUndefined();
    expect(resolveLayout(splitFrontmatter('---\nmms_layout: XX\n---\n# R').frontmatter)).toBe('LR');
  });

  it('mms_line 四个方向外的合法值只有 line 与 curve，且大小写不敏感', () => {
    expect(splitFrontmatter('---\nmms_line: CURVE\n---\n# R').frontmatter?.mms_line).toBe('curve');
    expect(splitFrontmatter('---\nmms_line: line\n---\n# R').frontmatter?.mms_line).toBe('line');
  });

  it('mms_line 非法值被忽略并回退 line', () => {
    expect(splitFrontmatter('---\nmms_line: ZZ\n---\n# R').frontmatter?.mms_line).toBeUndefined();
    expect(resolveLineStyle(splitFrontmatter('---\nmms_line: ZZ\n---\n# R').frontmatter)).toBe('line');
    expect(resolveLineStyle(null)).toBe('line');
  });

  it('返回正确的正文起始行号', () => {
    const result = splitFrontmatter('---\nmms_name: X\nmms_desc: Y\n---\n# 根\n## 子');
    expect(result.bodyStartLine).toBe(5);
    expect(result.body.split('\n')[0]).toBe('# 根');
  });

  it('归一化 CRLF 与 BOM', () => {
    const result = splitFrontmatter('\uFEFF---\r\nmms_name: X\r\n---\r\n# 根');
    expect(result.frontmatter?.mms_name).toBe('X');
    expect(result.body).toBe('# 根');
  });
});
