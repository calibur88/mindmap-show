/**
 * @module test/ui/left-panel
 * @description 左栏文件树纯函数单测：UTF-8 字节序比较与递归目录树构建
 * 只测无 DOM 依赖的导出纯函数（buildFolderTree / compareUtf8）
 */

import { describe, expect, it } from 'vitest';
import {
  findAll,
  installDomStub,
  makeContainer,
  textsOf,
  type StubElement,
} from '../helpers/dom-stub';
import { LeftPanel, buildFolderTree, compareUtf8 } from '../../src/ui/left-panel';
import type { IFileStat } from '../../src/ui/left-panel';
import type { IExportFlow, IOpener, ITreeOps, IUiHost } from '../../src/host/types';

installDomStub();

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

// ---------------------------------------------------------------- 文件树渲染（DOM 替身）

function makePanel(): { panel: LeftPanel; treeBox: StubElement } {
  const uiHost: IUiHost = {
    setStatus: () => {},
    onStatus: () => {},
    offStatus: () => {},
    getLastState: () => 'synced',
    getLastDetail: () => '',
  };
  const opener: IOpener = { openMindMap: async () => {}, openSource: async () => {} };
  const exportFlow: IExportFlow = {
    requestExport: () => ({ defaultPath: '', svg: '' }),
    confirmSave: async () => {},
  };
  const treeOps: ITreeOps = {
    createMmsFile: async () => ({ ok: true, path: '' }),
    deleteMmsFile: async () => ({ ok: true, path: '' }),
  };
  const panel = new LeftPanel(
    makeContainer() as unknown as HTMLElement,
    opener,
    uiHost,
    () => {},
    () => {},
    () => {},
    () => [],
    () => {},
    exportFlow,
    treeOps,
  );
  return { panel, treeBox: (panel as unknown as { treeBox: StubElement }).treeBox };
}

const SNAPSHOT_FILES: IFileStat[] = [
  { path: '目录一/子目录/a.mms', name: 'a.mms', nodeCount: 3, tags: [] },
  { path: '目录一/b.mms', name: 'b.mms', nodeCount: 1, tags: [] },
  { path: 'z.mms', name: 'z.mms', nodeCount: 2, tags: [] },
];

function renderTree(): StubElement {
  const { panel, treeBox } = makePanel();
  panel.render(
    { files: SNAPSHOT_FILES, tags: [], activeTag: null, warnings: [], currentFilePath: null },
    false,
  );
  return treeBox;
}

const namesIn = (root: StubElement, cls: string): string[] =>
  textsOf(findAll(root, (el) => el.classList.contains(cls)));

describe('文件树渲染（渲染入口直调 renderChildren，根不渲染自身行）', () => {
  it('根目录不渲染自身行，只渲染其子目录', () => {
    const folderNames = namesIn(renderTree(), 'mms-folder-name');
    expect(folderNames).toEqual(['目录一/', '子目录/']);
    expect(folderNames).not.toContain('根目录/');
  });

  it('顶层结构为 目录行 → 子容器 → 直接文件（目录在前、文件在后）', () => {
    const treeBox = renderTree();
    expect(treeBox.childNodes.map((el) => el.className)).toEqual([
      'mms-folder-row',
      'mms-folder-children',
      'mms-file-item',
    ]);
    expect(namesIn(treeBox.childNodes[2], 'mms-file-name')).toEqual(['z.mms']);
  });

  it('二级目录逐级嵌套，文件挂在直接父目录', () => {
    const treeBox = renderTree();
    const dirBox = treeBox.childNodes[1];
    expect(namesIn(treeBox.childNodes[0], 'mms-folder-name')).toEqual(['目录一/']);
    expect(dirBox.childNodes.map((el) => el.className)).toEqual([
      'mms-folder-row',
      'mms-folder-children',
      'mms-file-item',
    ]);
    expect(namesIn(dirBox.childNodes[2], 'mms-file-name')).toEqual(['b.mms']);
    expect(namesIn(dirBox.childNodes[1], 'mms-file-name')).toEqual(['a.mms']);
  });

  it('当前文件高亮 is-active', () => {
    const { panel, treeBox } = makePanel();
    panel.render(
      {
        files: SNAPSHOT_FILES,
        tags: [],
        activeTag: null,
        warnings: [],
        currentFilePath: '目录一/子目录/a.mms',
      },
      false,
    );
    const active = findAll(treeBox, (el) => el.classList.contains('is-active'));
    expect(active).toHaveLength(1);
    expect(namesIn(active[0], 'mms-file-name')).toEqual(['a.mms']);
  });
});
