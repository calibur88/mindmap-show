/**
 * @module ui/left-panel
 * @description 左栏面板：标签分组 / 文件浏览器 / 解析警告 / 状态卡
 */

import type { IOpener, ITreeOps, IUiHost, IWarning, IExportFlow } from '../host/types';
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

/** 目录树节点：name 为显示名（根为「根目录」），path 为完整路径（根为 ''） */
export interface ITreeFolder {
  name: string;
  path: string;
  children: Map<string, ITreeFolder>;
  files: IFileStat[];
}

/**
 * 按 UTF-8 字节序比较两个字符串（纯函数，可单测）。
 * 与 localeCompare 不同：ASCII 字母（0x41-0x5A）恒排在中文（0xE4+ 三字节）之前，
 * 即「A书」<「B书」<「书A」<「书B」；数字、字母、符号也按字节序自然排位。
 * 用于文件树同级（目录＋文件混排）的稳定排序
 */
export function compareUtf8(a: string, b: string): number {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const n = Math.min(ea.length, eb.length);
  for (let i = 0; i < n; i++) {
    if (ea[i] !== eb[i]) return ea[i] - eb[i];
  }
  return ea.length - eb.length;
}

/**
 * 把文件列表构建成递归目录树（纯函数，可单测）。
 * 按 '/' 分段逐级建目录；文件挂到其直接父目录的 files。
 * 排序在渲染层按同级混排统一处理，此处仅保证插入顺序稳定
 */
export function buildFolderTree(files: IFileStat[]): ITreeFolder {
  const root: ITreeFolder = { name: '根目录', path: '', children: new Map(), files: [] };

  for (const file of files) {
    const segs = file.path.split('/');
    let node = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      let child = node.children.get(seg);
      if (!child) {
        child = {
          name: seg,
          path: segs.slice(0, i + 1).join('/'),
          children: new Map(),
          files: [],
        };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

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

  /** 文件管理器标题栏 + / − 按钮 */
  private treeNewBtn: HTMLButtonElement;
  private treeDeleteBtn: HTMLButtonElement;
  /** 就地输入行（新增/删除共一条，靠模式切换） */
  private treeInputBar: HTMLElement;
  private treeInput: HTMLInputElement;
  private treeConfirmBtn: HTMLButtonElement;
  private treeCancelBtn: HTMLButtonElement;
  /** 当前输入行模式：null=收起，'new'=新增，'delete'=删除 */
  private treeMode: 'new' | 'delete' | null = null;
  /** 确认执行中禁用按钮防连点 */
  private treeSaving = false;

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
    exportFlow: IExportFlow,
    /** 文件树新增/删除回调（由 main 注入），UI 不感知 vault 实现 */
    private treeOps: ITreeOps,
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

    // ---------------------- 文件浏览器：标题栏（左标题 + 右 [+][−]）--------------------
    const treeSection = el('div', { cls: 'mms-section mms-section-tree' });
    const treeHeader = el('div', { cls: 'mms-tree-header' });
    treeHeader.appendChild(el('span', { cls: 'mms-tree-title', text: '文件浏览器' }));
    const treeActions = el('span', { cls: 'mms-tree-actions' });
    this.treeNewBtn = el('button', {
      cls: 'mms-mini-btn mms-tree-btn',
      text: '+',
      attr: { type: 'button', 'data-action': 'new-file', 'aria-label': '新增文件', title: '新增 .mms 文件' },
    }) as HTMLButtonElement;
    this.treeNewBtn.addEventListener('click', () => this.toggleTreeMode('new'));
    this.treeDeleteBtn = el('button', {
      cls: 'mms-mini-btn mms-tree-btn',
      text: '\u2212',
      attr: { type: 'button', 'data-action': 'delete-file', 'aria-label': '删除文件', title: '删除 .mms 文件' },
    }) as HTMLButtonElement;
    this.treeDeleteBtn.addEventListener('click', () => this.toggleTreeMode('delete'));
    treeActions.appendChild(this.treeNewBtn);
    treeActions.appendChild(this.treeDeleteBtn);
    treeHeader.appendChild(treeActions);
    treeSection.appendChild(treeHeader);

    // 就地输入行：标题栏正下方，+ / − 复用，靠模式切换
    this.treeInputBar = el('div', { cls: 'mms-tree-input-bar' });
    const inputRow = el('div', { cls: 'mms-tree-input-row' });
    this.treeInput = el('input', {
      cls: 'mms-tree-input',
      attr: { type: 'text', placeholder: '新增文件', spellcheck: 'false' },
    }) as HTMLInputElement;
    // Enter=确认，Esc=取消；input 变化清红框
    this.treeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.confirmTree();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.collapseTreeBar();
      }
    });
    this.treeInput.addEventListener('input', () => this.treeInput.classList.remove('is-invalid'));
    this.treeConfirmBtn = el('button', {
      cls: 'mms-mini-btn',
      text: '确认',
      attr: { type: 'button' },
    }) as HTMLButtonElement;
    this.treeConfirmBtn.addEventListener('click', () => void this.confirmTree());
    this.treeCancelBtn = el('button', {
      cls: 'mms-mini-btn',
      text: '取消',
      attr: { type: 'button' },
    }) as HTMLButtonElement;
    this.treeCancelBtn.addEventListener('click', () => this.collapseTreeBar());
    inputRow.appendChild(this.treeInput);
    inputRow.appendChild(this.treeConfirmBtn);
    inputRow.appendChild(this.treeCancelBtn);
    this.treeInputBar.appendChild(inputRow);
    // 双保险隐藏：CSS 默认 none + 内联兜底
    this.treeInputBar.style.display = 'none';
    treeSection.appendChild(this.treeInputBar);

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

    // 递归目录树：折叠只显示当前层，展开逐级显示子目录与文件；
    // 搜索态临时忽略持久化折叠（全部展开），正常态照常应用
    const collapsedList = this.keyword ? [] : this.getCollapsedFolders();
    const root = buildFolderTree(visible);
    this.renderFolder(root, collapsedList, snapshot.currentFilePath, 0);
  }

  /**
   * 递归渲染一个目录节点：目录行（可折叠）+ 子目录 + 直接文件。
   * 缩进由 .mms-folder-children 的 padding-left 按层级累加；
   * 子文件/子目录始终渲染进独立容器，折叠只是 toggle 容器的 is-collapsed，
   * 展开时无需重建 DOM，点击后局部更新，滚动位置保持
   */
  private renderFolder(
    folder: ITreeFolder,
    collapsedList: string[],
    currentFilePath: string | null,
    depth: number,
  ): void {
    const isRoot = folder.path === '';
    if (!isRoot) {
      const collapsed = collapsedList.includes(folder.path);
      const folderRow = el('div', { cls: 'mms-folder-row' });
      const toggle = el('span', { cls: 'mms-folder-toggle', text: collapsed ? '▸' : '▾' });
      folderRow.appendChild(toggle);
      folderRow.appendChild(el('span', { cls: 'mms-folder-name', text: `${folder.name}/` }));
      this.treeBox.appendChild(folderRow);
      const childrenBox = el('div', {
        cls: `mms-folder-children${collapsed ? ' is-collapsed' : ''}`,
      });
      folderRow.addEventListener('click', () => {
        const nowCollapsed = !childrenBox.classList.contains('is-collapsed');
        childrenBox.classList.toggle('is-collapsed', nowCollapsed);
        toggle.textContent = nowCollapsed ? '▸' : '▾';
        this.persistCollapsedFolders(this.withFolderToggled(folder.path, nowCollapsed));
      });
      this.treeBox.appendChild(childrenBox);
      this.renderChildren(folder, collapsedList, currentFilePath, depth, childrenBox);
    } else {
      // 根目录不渲染自身行，直接渲染其子目录与文件（与扁平版根目录置顶一致）
      const childrenBox = this.treeBox;
      this.renderChildren(folder, collapsedList, currentFilePath, depth, childrenBox);
    }
  }

  /** 渲染一个目录下的所有子目录与直接文件（同级目录优先，同类按 UTF-8 字节序） */
  private renderChildren(
    folder: ITreeFolder,
    collapsedList: string[],
    currentFilePath: string | null,
    depth: number,
    container: HTMLElement,
  ): void {
    // 同级排序：先比类型（目录在前、文件在后），同类型再按名称 UTF-8 字节序。
    // sortKey 必须用纯显示名（不含路径与尾部斜杠），避免字节序被符号干扰
    type Entry = { kind: 'dir' | 'file'; sortKey: string; dir?: ITreeFolder; file?: IFileStat };
    const entries: Entry[] = [];
    for (const child of folder.children.values()) {
      entries.push({ kind: 'dir', sortKey: child.name, dir: child });
    }
    for (const file of folder.files) {
      entries.push({ kind: 'file', sortKey: file.name, file });
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return compareUtf8(a.sortKey, b.sortKey);
    });

    for (const entry of entries) {
      if (entry.kind === 'file' && entry.file) {
        const file = entry.file;
        const item = el('div', {
          cls: `mms-file-item${file.path === currentFilePath ? ' is-active' : ''}`,
        });
        item.appendChild(el('span', { cls: 'mms-file-name', text: file.name }));
        item.appendChild(el('span', { cls: 'mms-file-count', text: `(${file.nodeCount})` }));
        item.addEventListener('click', () => {
          void this.opener.openMindMap(file.path);
        });
        container.appendChild(item);
        continue;
      }
      const child = entry.dir!;
      const collapsed = collapsedList.includes(child.path);
      const folderRow = el('div', { cls: 'mms-folder-row' });
      const toggle = el('span', { cls: 'mms-folder-toggle', text: collapsed ? '▸' : '▾' });
      folderRow.appendChild(toggle);
      folderRow.appendChild(el('span', { cls: 'mms-folder-name', text: `${child.name}/` }));
      const childrenBox = el('div', {
        cls: `mms-folder-children${collapsed ? ' is-collapsed' : ''}`,
      });
      folderRow.addEventListener('click', () => {
        const nowCollapsed = !childrenBox.classList.contains('is-collapsed');
        childrenBox.classList.toggle('is-collapsed', nowCollapsed);
        toggle.textContent = nowCollapsed ? '▸' : '▾';
        this.persistCollapsedFolders(this.withFolderToggled(child.path, nowCollapsed));
      });
      container.appendChild(folderRow);
      container.appendChild(childrenBox);
      this.renderChildren(child, collapsedList, currentFilePath, depth + 1, childrenBox);
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

  // ============================ 新增/删除文件输入行 ============================

  /**
   * 点标题栏 + / −：
   * - 未激活该模式 → 展开输入行并进入该模式（清空输入、清红框、按钮 is-active）
   * - 已激活该模式 → 收起（等同取消）
   * - 切换模式时清空输入框，保证 placeholder 能正常显示
   */
  private toggleTreeMode(mode: 'new' | 'delete'): void {
    if (this.treeSaving) return;
    if (this.treeMode === mode) {
      this.collapseTreeBar();
      return;
    }
    this.treeMode = mode;
    this.treeInput.value = '';
    this.treeInput.classList.remove('is-invalid');
    this.treeInput.placeholder = mode === 'new' ? '新增文件' : '删除文件';
    this.treeNewBtn.classList.toggle('is-active', mode === 'new');
    this.treeDeleteBtn.classList.toggle('is-active', mode === 'delete');
    // 显式置 block：CSS 默认 display:none，清空内联样式会回落到 none 导致输入行永远出不来
    this.treeInputBar.style.display = 'block';
    queueMicrotask(() => this.treeInput.focus());
  }

  /** 确认按钮 / Enter：按当前模式调用 treeOps；执行中禁用按钮防连点 */
  private async confirmTree(): Promise<void> {
    if (this.treeSaving || !this.treeMode) return;
    const path = this.treeInput.value.trim();
    if (!path) {
      this.setTreeInvalid();
      return;
    }
    this.treeSaving = true;
    this.setTreeButtonsDisabled(true);
    try {
      const result =
        this.treeMode === 'new'
          ? await this.treeOps.createMmsFile(path)
          : await this.treeOps.deleteMmsFile(path);
      if (result.ok) {
        // 成功：收起并清空（含红框）
        this.collapseTreeBar();
        return;
      }
      // 失败：统一红框。删除找不到 → 清空内容、保留输入行打开
      this.setTreeInvalid();
      if (this.treeMode === 'delete' && result.reason === 'not-found') {
        this.treeInput.value = '';
        this.treeInput.focus();
      }
    } catch (err) {
      // 底层意外异常兜底：红框、保留输入
      this.setTreeInvalid();
      console.error('[MMS] 文件树操作失败', err);
    } finally {
      this.treeSaving = false;
      this.setTreeButtonsDisabled(false);
    }
  }

  /** 取消按钮 / Esc：收起并清空输入与红框 */
  private collapseTreeBar(): void {
    this.treeMode = null;
    this.treeInput.value = '';
    this.treeInput.classList.remove('is-invalid');
    this.treeNewBtn.classList.remove('is-active');
    this.treeDeleteBtn.classList.remove('is-active');
    this.treeInputBar.style.display = 'none';
  }

  /** 输入框红框错误态：不弹 Notice、不显示错误行，聚焦时保持红 */
  private setTreeInvalid(): void {
    this.treeInput.classList.add('is-invalid');
    this.treeInput.focus();
  }

  private setTreeButtonsDisabled(disabled: boolean): void {
    this.treeConfirmBtn.disabled = disabled;
    this.treeCancelBtn.disabled = disabled;
    this.treeInput.disabled = disabled;
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
