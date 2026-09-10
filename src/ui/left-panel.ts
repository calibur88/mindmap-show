/**
 * @module ui/left-panel
 * @description 左栏面板：标签分组 / 文件浏览器 / 解析警告 / 状态卡
 */

import type { IOpener, IUiHost, IWarning } from '../host/types';
import { el } from '../utils/dom';
import { StatusCard, type ExportFlow } from './status-card';

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
  private searchInput: HTMLInputElement;
  private treeBox: HTMLElement;
  private warnBox: HTMLElement;
  private warnSection: HTMLElement;
  private statusCard: StatusCard;
  /** 当前生效的搜索关键词，空串表示不过滤 */
  private keyword = '';
  /** 最近一次全量快照，供搜索 / 清空只重绘文件树，避免整栏重建 */
  private snapshot: IScanSnapshot | null = null;

  constructor(
    container: HTMLElement,
    private opener: IOpener,
    uiHost: IUiHost,
    onRefresh: () => void,
    private onSelectTag: (tag: string | null) => void,
    openDetailPanel: () => void,
    /** 读持久化的折叠文件夹列表（settings.collapsedFolders） */
    private getCollapsedFolders: () => string[],
    /** 持久化折叠列表（静默写盘，不触发整栏重渲染） */
    private persistCollapsedFolders: (folders: string[]) => void,
    /** 导出图片的两步回调（由 main 注入），UI 不感知 vault 实现 */
    exportFlow: ExportFlow,
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

    // ---------------------- 文件搜索工具栏 ----------------------
    const searchSection = el('div', { cls: 'mms-section mms-section-search' });
    const searchBar = el('div', { cls: 'mms-search-bar' });
    this.searchInput = el('input', {
      cls: 'mms-search-input',
      attr: { type: 'search', placeholder: '搜索文件名，回车确认' },
    });
    this.searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.applySearch();
    });
    // 原生 type=search 的清空（×）按钮只派发 search 事件：空值时走清空逻辑
    this.searchInput.addEventListener('search', () => {
      if (this.searchInput.value.trim() === '') this.clearSearch();
      else this.applySearch();
    });
    searchBar.appendChild(this.searchInput);

    const actionBox = el('div', { cls: 'mms-search-actions' });
    const doSearch = el('button', {
      cls: 'mms-search-btn mms-search-go',
      text: '搜索',
      attr: { type: 'button' },
    });
    doSearch.addEventListener('click', () => this.applySearch());
    const doClear = el('button', {
      cls: 'mms-search-btn',
      text: '清空',
      attr: { type: 'button' },
    });
    doClear.addEventListener('click', () => this.clearSearch());
    actionBox.appendChild(doSearch);
    actionBox.appendChild(doClear);
    searchBar.appendChild(actionBox);
    searchSection.appendChild(searchBar);
    this.rootEl.appendChild(searchSection);

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

    this.statusCard = new StatusCard(this.rootEl, uiHost, onRefresh, openDetailPanel, exportFlow);
  }

  /** 注销状态卡监听并移除整栏 DOM。侧栏视图 onClose 必须调用 */
  destroy(): void {
    this.statusCard.destroy();
    this.rootEl.remove();
  }

  render(snapshot: IScanSnapshot, showWarnings: boolean): void {
    this.snapshot = snapshot;
    this.renderTags(snapshot);
    this.renderTree(snapshot);
    this.renderWarnings(snapshot, showWarnings);
  }

  /**
   * 执行搜索：只在当前标签分组内按文件名过滤。
   * 输入框为空时忽略本次操作——不刷新、不报错。
   * 搜索态渲染时临时忽略折叠状态（等效全部展开，避免折叠目录吞掉结果），
   * 但不改写持久化的折叠偏好：清空搜索后自动恢复
   */
  private applySearch(): void {
    const raw = this.searchInput.value.trim();
    if (!raw) return;
    this.keyword = raw;
    this.renderTreeOnly();
  }

  /**
   * 清空：撤销关键词过滤，回退到当前标签分组的默认视图。
   * 关键词已经是空串时只清输入框，不触发列表刷新
   */
  private clearSearch(): void {
    this.searchInput.value = '';
    if (this.keyword === '') return;
    this.keyword = '';
    this.renderTreeOnly();
  }

  private renderTreeOnly(): void {
    if (this.snapshot) this.renderTree(this.snapshot);
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
      item.addEventListener('click', () => this.handleSelectTag(isAll ? null : tag.name));
      this.tagBox.appendChild(item);
    }
  }

  /** 切换标签分组时同步清空搜索，避免旧关键词继续隐式过滤新分组 */
  private handleSelectTag(tag: string | null): void {
    this.searchInput.value = '';
    this.keyword = '';
    this.onSelectTag(tag);
  }

  private renderTree(snapshot: IScanSnapshot): void {
    this.treeBox.empty();
    const inTag = snapshot.activeTag
      ? snapshot.files.filter((file) => file.tags.includes(snapshot.activeTag as string))
      : snapshot.files;
    // 搜索只在当前标签分组内按文件名（不含路径、忽略大小写）过滤
    const visible = this.keyword
      ? inTag.filter((file) => file.name.toLowerCase().includes(this.keyword.toLowerCase()))
      : inTag;

    if (visible.length === 0) {
      this.treeBox.appendChild(el('div', {
        cls: 'mms-empty-hint',
        text: this.keyword ? `当前标签分组内没有匹配「${this.keyword}」的文件` : '没有匹配的 .mms 文件',
      }));
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

    // 搜索态临时忽略持久化的折叠状态（全部展开）；正常态照常应用
    const collapsedList = this.keyword ? [] : this.getCollapsedFolders();

    for (const folder of folders) {
      const files = byFolder.get(folder)!;
      const collapsed = collapsedList.includes(folder);

      const folderRow = el('div', { cls: 'mms-folder-row' });
      const toggle = el('span', { cls: 'mms-folder-toggle', text: collapsed ? '▸' : '▾' });
      folderRow.appendChild(toggle);
      const display = folder === '/' ? '根目录' : folder;
      folderRow.appendChild(el('span', { cls: 'mms-folder-name', text: `${display}/` }));

      // 子文件始终渲染进独立容器，折叠只是 toggle 容器的 is-collapsed，
      // 展开时无需重建 DOM；点击后局部更新，不整树重绘，滚动位置保持
      const childrenBox = el('div', {
        cls: `mms-folder-children${collapsed ? ' is-collapsed' : ''}`,
      });
      for (const file of files) {
        const item = el('div', {
          cls: `mms-file-item${file.path === snapshot.currentFilePath ? ' is-active' : ''}`,
        });
        item.appendChild(el('span', { cls: 'mms-file-name', text: file.name }));
        item.appendChild(el('span', { cls: 'mms-file-count', text: `(${file.nodeCount})` }));
        item.addEventListener('click', () => {
          void this.opener.openMindMap(file.path);
        });
        childrenBox.appendChild(item);
      }

      folderRow.addEventListener('click', () => {
        const nowCollapsed = !childrenBox.classList.contains('is-collapsed');
        childrenBox.classList.toggle('is-collapsed', nowCollapsed);
        toggle.textContent = nowCollapsed ? '▸' : '▾';
        this.persistCollapsedFolders(this.withFolderToggled(folder, nowCollapsed));
      });
      this.treeBox.appendChild(folderRow);
      this.treeBox.appendChild(childrenBox);
    }
  }

  /** 复制当前持久化数组并按目标态增删一个文件夹路径 */
  private withFolderToggled(folder: string, collapsed: boolean): string[] {
    const list = [...this.getCollapsedFolders()];
    const idx = list.indexOf(folder);
    if (collapsed && idx < 0) list.push(folder);
    if (!collapsed && idx >= 0) list.splice(idx, 1);
    return list;
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
