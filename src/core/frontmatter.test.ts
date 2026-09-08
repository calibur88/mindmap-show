/**
 * @module core/frontmatter.test
 * @description Frontmatter 剥离与字段提取的单元测试
 */

import { describe, expect, it } from 'vitest';
import { resolveLayout, splitFrontmatter } from './frontmatter';

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

  it('mms_layout 非法值被忽略', () => {
    expect(splitFrontmatter('---\nmms_layout: XX\n---\n# R').frontmatter?.mms_layout).toBeUndefined();
    expect(resolveLayout(splitFrontmatter('---\nmms_layout: XX\n---\n# R').frontmatter)).toBe('LR');
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
