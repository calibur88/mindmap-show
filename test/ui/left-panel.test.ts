/**
 * @module test/ui/left-panel
 * @description 左栏文件树纯函数单测：UTF-8 字节序比较与递归目录树构建
 * 只测无 DOM 依赖的导出纯函数（buildFolderTree / compareUtf8）
 */

import { describe, expect, it } from 'vitest';
import { buildFolderTree, compareUtf8 } from '../../src/ui/left-panel';
import type { IFileStat } from '../../src/ui/left-panel';

function stat(path: string, nodeCount = 1): IFileStat {
  const name = path.split('/').pop() ?? path;
  return { path, name, nodeCount, tags: [] };
}

describe('compareUtf8（UTF-8 字节序）', () => {
  it('ASCII 字母恒在中文之前：A书 < B书 < 书A < 书B', () => {
    const items = ['书B', 'A书', '书A', 'B书'].sort(compareUtf8);
    expect(items).toEqual(['A书', 'B书', '书A', '书B']);
  });

  it('与 localeCompare 不同：不按拼音而按字节序', () => {
    // 中文按拼音「书shū / 目mù」会得目在前；字节序则书(0xE4B9A6) 先于 目(0xE79BAE)
    const items = ['目录', '书'].sort(compareUtf8);
    expect(items[0]).toBe('书');
  });

  it('纯 ASCII 按字典序', () => {
    expect(compareUtf8('a.txt', 'b.txt')).toBeLessThan(0);
    expect(compareUtf8('b', 'a')).toBeGreaterThan(0);
    expect(compareUtf8('a', 'a')).toBe(0);
  });

  it('较短串是较长串的前缀时，短串在前', () => {
    expect(compareUtf8('a', 'a.txt')).toBeLessThan(0);
  });
});

describe('buildFolderTree（递归目录树）', () => {
  it('三级目录逐级嵌套，文件挂到直接父目录', () => {
    const tree = buildFolderTree([
      stat('目录一/目录二/目录三/文件C.txt'),
      stat('目录一/目录二/文件B.txt'),
      stat('目录一/文件A.txt'),
    ]);

    expect(tree.name).toBe('根目录');
    expect(tree.path).toBe('');

    const dir1 = tree.children.get('目录一')!;
    expect(dir1.path).toBe('目录一');
    expect(dir1.files.map((f) => f.name)).toEqual(['文件A.txt']);

    const dir2 = dir1.children.get('目录二')!;
    expect(dir2.path).toBe('目录一/目录二');
    expect(dir2.files.map((f) => f.name)).toEqual(['文件B.txt']);

    const dir3 = dir2.children.get('目录三')!;
    expect(dir3.path).toBe('目录一/目录二/目录三');
    expect(dir3.files.map((f) => f.name)).toEqual(['文件C.txt']);
  });

  it('根目录下直接文件挂在根节点', () => {
    const tree = buildFolderTree([stat('根文件.mms'), stat('目录一/子文件.mms')]);
    expect(tree.files.map((f) => f.name)).toEqual(['根文件.mms']);
    expect(tree.children.has('目录一')).toBe(true);
  });

  it('同名目录合并为同一节点，不重复建目录', () => {
    const tree = buildFolderTree([
      stat('a/1.mms'),
      stat('a/b/2.mms'),
      stat('a/b/3.mms'),
    ]);
    expect(tree.children.size).toBe(1);
    const b = tree.children.get('a')!.children.get('b')!;
    expect(b.files.map((f) => f.name)).toEqual(['2.mms', '3.mms']);
  });
});
