/**
 * @module ui/left-panel
 * @description 左栏面板：标签分组 / 文件浏览器 / 解析警告 / 状态卡
 */

import type { IOpener, IUiHost, IWarning } from '../host/types';
import { el } from '../utils/dom';
import { StatusCard } from './status-card';

/** 标签统计项 */
export interface ITagStat {
  name: string;
  count: number;
}

/** 文件统计项 */
export interface IFileStat {
  path: string;
  name: string;
  nodeCount: number;
  tags: string[];
}

/** 一次全量扫描的快照 */
export interface IScanSnapshot {
  files: IFileStat[];
  tags: ITagStat[];
  activeTag: string | null;
  warnings: IWarning[];
  currentFilePath: string | null;
}

const ALL_TAG = '__all__';

export class LeftPanel {
  private rootEl: HTMLElement;
  private tagBox: HTMLElement;
  private treeBox: HTMLElement;
  private warnBox: HTMLElement;
  private warnSection: HTMLElement;
  /** 文件夹折叠状态，键是文件夹路径（「/」= 根），重启后默认全展开 */
  private readonly collapsedFolders: Set<string> = new Set();

  constructor(
    container: HTMLElement,
    private opener: IOpener,
    uiHost: IUiHost,
    onRefresh: () => void,
    private onSelectTag: (tag: string | null) => void,
    openDetailPanel: () => void,
  ) {
    this.rootEl = el('div', { cls: 'mms-left-panel' });
    // ItemView.containerEl 是 .view-content（position: relative，无显式 height），
    // left-panel 用 absolute 才能撑满整个 sidebar 区域
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    this.rootEl.style.position = 'absolute';
    this.rootEl.style.inset = '0';
    container.appendChild(this.rootEl);

    const tagSection = el('div', { cls: 'mms-section mms-section-tag' });
    tagSection.appendChild(el('div', { cls: 'mms-section-title', text: '标签分组' }));
    this.tagBox = el('div', { cls: 'mms-tag-list mms-scroll' });
    tagSection.appendChild(this.tagBox);
    this.rootEl.appendChild(tagSection);

    const treeSection = el('div', { cls: 'mms-section mms-section-tree' });
    treeSection.appendChild(el('div', { cls: 'mms-section-title', text: '文件浏览器' }));
    this.treeBox = el('div', { cls: 'mms-file-tree mms-scroll' });
    treeSection.appendChild(this.treeBox);
    this.rootEl.appendChild(treeSection);

    this.warnSection = el('div', { cls: 'mms-section mms-section-warn' });
    this.warnSection.appendChild(el('div', { cls: 'mms-section-title', text: '调试信息' }));
    this.warnBox = el('div', { cls: 'mms-warning-box mms-scroll' });
    this.warnSection.appendChild(this.warnBox);
    this.rootEl.appendChild(this.warnSection);

    new StatusCard(this.rootEl, uiHost, onRefresh, openDetailPanel);
  }

  render(snapshot: IScanSnapshot, showWarnings: boolean): void {
    this.renderTags(snapshot);
    this.renderTree(snapshot);
    this.renderWarnings(snapshot, showWarnings);
  }

  private renderTags(snapshot: IScanSnapshot): void {
    this.tagBox.empty();
    const items: ITagStat[] = [{ name: ALL_TAG, count: snapshot.files.length }, ...snapshot.tags];
    for (const tag of items) {
      const isAll = tag.name === ALL_TAG;
      const active = isAll ? snapshot.activeTag === null : snapshot.activeTag === tag.name;
      const item = el('div', {
        cls: `mms-tag-item${active ? ' is-active' : ''}`,
        text: isAll ? '全部' : tag.name,
      });
      item.appendChild(el('span', { cls: 'mms-tag-count', text: `(${tag.count})` }));
      item.addEventListener('click', () => this.onSelectTag(isAll ? null : tag.name));
      this.tagBox.appendChild(item);
    }
  }

  private renderTree(snapshot: IScanSnapshot): void {
    this.treeBox.empty();
    const visible = snapshot.activeTag
      ? snapshot.files.filter((file) => file.tags.includes(snapshot.activeTag as string))
      : snapshot.files;

    if (visible.length === 0) {
      this.treeBox.appendChild(el('div', { cls: 'mms-empty-hint', text: '没有匹配的 .mms 文件' }));
      return;
    }

    const byFolder = new Map<string, IFileStat[]>();
    for (const file of visible) {
      const slash = file.path.lastIndexOf('/');
      const folder = slash >= 0 ? file.path.slice(0, slash) : '/';
      const list = byFolder.get(folder);
      if (list) list.push(file);
      else byFolder.set(folder, [file]);
    }

    // 根目录（'/'）排第一，其余按路径字典序
    const folders = [...byFolder.keys()].sort((a, b) => {
      if (a === '/') return -1;
      if (b === '/') return 1;
      return a.localeCompare(b);
    });

    for (const folder of folders) {
      const files = byFolder.get(folder)!;
      const collapsed = this.collapsedFolders.has(folder);

      const folderRow = el('div', { cls: 'mms-folder-row' });
      folderRow.appendChild(
        el('span', { cls: 'mms-folder-toggle', text: collapsed ? '▶' : '▼' }),
      );
      const display = folder === '/' ? '根目录' : folder;
      folderRow.appendChild(el('span', { cls: 'mms-folder-name', text: `${display}/` }));
      folderRow.addEventListener('click', () => {
        if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
        else this.collapsedFolders.add(folder);
        this.renderTree(snapshot);
      });
      this.treeBox.appendChild(folderRow);

      if (collapsed) continue;

      for (const file of files) {
        const item = el('div', {
          cls: `mms-file-item${file.path === snapshot.currentFilePath ? ' is-active' : ''}`,
        });
        item.appendChild(el('span', { cls: 'mms-file-name', text: file.name }));
        item.appendChild(el('span', { cls: 'mms-file-count', text: `(${file.nodeCount})` }));
        item.addEventListener('click', () => {
          void this.opener.openMindMap(file.path);
        });
        this.treeBox.appendChild(item);
      }
    }
  }

  /**
   * currentFilePath 为 null（侧栏全局视图）→ 显示全部警告；
   * 非 null（单文件视图）→ 只显示当前文件。设置开启时常驻显示
   */
  private renderWarnings(snapshot: IScanSnapshot, showWarnings: boolean): void {
    this.warnBox.empty();

    if (!showWarnings) {
      this.warnSection.style.display = 'none';
      return;
    }

    this.warnSection.style.display = '';

    const list = snapshot.currentFilePath === null
      ? snapshot.warnings
      : snapshot.warnings.filter((w) => w.filePath === snapshot.currentFilePath);

    if (list.length === 0) {
      this.warnBox.appendChild(el('div', { cls: 'mms-empty-hint', text: '暂无解析警告' }));
      return;
    }

    for (const warning of list) {
      const item = el('div', { cls: `mms-warning-item severity-${warning.severity}` });
      const prefix = warning.lineNo ? `第 ${warning.lineNo} 行 · ` : '';
      item.textContent = `${prefix}[${warning.filePath}] ${warning.message}`;
      this.warnBox.appendChild(item);
    }
  }
}
