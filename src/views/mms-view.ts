/**
 * @module views/mms-view
 * @description MMS 主视图：继承 FileView 接管 .mms 文件，承载画布。
 *
 * 节点详情不在本视图内，由挂在右侧 sidebar 的 MmsDetailView 展示，
 * 两者通过 MmsSelection 总线同步当前文件与选中节点
 */

import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type { IMmsNode, IOpener, IUiHost, IParsedDoc, UiStatus } from '../host/types';
import type { MmsIndex } from '../controller/refresh';
import type { MmsSelection } from '../controller/selection';
import type { MmsSettings } from '../settings/schema';
import { renderExplore } from '../render/dom';
import { renderPanorama } from '../render/svg';
import { CanvasViewport } from '../render/canvas-viewport';
import { el } from '../utils/dom';

/** 视图类型标识，注册与 getLeavesOfType 查询共用 */
export const MMS_VIEW_TYPE = 'mind-map-view';

export interface IMmsViewDeps {
  index: MmsIndex;
  opener: IOpener;
  uiHost: IUiHost;
  selection: MmsSelection;
  getSettings: () => MmsSettings;
  /** 首次打开 .mms 时把详情面板挂到右侧 sidebar，之后不再自动弹出 */
  ensureDetailLeaf: () => void;
  /** 订阅设置变更，返回注销函数 */
  onSettingsChange: (fn: () => void) => () => void;
  /** 折叠徽标点击的写回入口：在文档中插入 / 改写 / 删除 collapsed 指令行（持久化即文档） */
  setNodeCollapsed: (filePath: string, nodeId: string, collapsed: boolean) => void;
}

export class MmsView extends FileView {
  /** 视图切换竞态守卫，防止快速切换时旧渲染覆盖新视图 */
  private switchSeq = 0;
  private currentPath: string | null = null;
  private viewMode: 'explore' | 'panorama' = 'explore';

  private canvasBody: HTMLElement | null = null;
  private footerEl: HTMLElement | null = null;
  private toolbarEl: HTMLElement | null = null;
  /** 搜索输入框实例：renderToolbar 重建时保留输入内容与焦点 */
  private searchBox: HTMLInputElement | null = null;
  private readonly viewport = new CanvasViewport();
  /** 用户手动点过「探索 / 全景」后置位，此后不再跟随 defaultView 设置 */
  private viewModeOverridden = false;
  /** 标签区展开态（默认折叠防溢出，移动端友好）；切换文件时重置 */
  private tagsExpanded = false;
  /** 搜索词：renderToolbar 重建时回填输入框；切换文件时重置 */
  private searchQuery = '';
  /** 最近一次搜索的命中节点 id 列表与当前下标；「上一个/下一个」循环导航用，切换文件/改输入时失效 */
  private searchHits: string[] = [];
  private searchHitIdx = -1;
  private searchNavEl: HTMLElement | null = null;
  private searchCounterEl: HTMLElement | null = null;

  private readonly boundRenderAll = (): void => this.renderAll();
  private readonly boundSettingsChange = (): void => this.applySettings();
  private readonly boundSelectionChange = (): void => this.updateHighlight();
  private readonly boundStatusChange = (state: UiStatus, detail?: string): void => {
    this.updateFooter(detail ?? this.deps.uiHost.getLastDetail());
  };
  private unsubscribeSettings: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private deps: IMmsViewDeps) {
    super(leaf);
  }

  getViewType(): string {
    return MMS_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension === 'mms';
  }

  async onOpen(): Promise<void> {
    this.buildShell();
    this.deps.index.onUpdate(this.boundRenderAll);
    this.unsubscribeSettings = this.deps.onSettingsChange(this.boundSettingsChange);
    // footer 实时反映刷新状态；画布高亮跟随选中总线（含右栏反向选中）
    this.deps.uiHost.onStatus(this.boundStatusChange);
    this.deps.selection.onChange(this.boundSelectionChange);
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.currentPath = file.path;
    this.viewMode = this.deps.getSettings().defaultView;
    this.viewModeOverridden = false;
    this.tagsExpanded = false;
    this.searchQuery = '';
    this.searchHits = [];
    this.searchHitIdx = -1;
    this.deps.selection.set(file.path, null);
    this.deps.ensureDetailLeaf();
    if (!this.canvasBody) this.buildShell();
    this.renderAll();
  }

  async onClose(): Promise<void> {
    this.deps.index.offUpdate(this.boundRenderAll);
    this.unsubscribeSettings?.();
    this.unsubscribeSettings = null;
    this.deps.uiHost.offStatus(this.boundStatusChange);
    this.deps.selection.offChange(this.boundSelectionChange);
    this.viewport.detach();
  }

  /** 设置变更：未手动切过视图时同步 defaultView，其余参数由 renderAll 重新读取 */
  private applySettings(): void {
    if (!this.viewModeOverridden) this.viewMode = this.deps.getSettings().defaultView;
    this.renderAll();
  }

  async onUnloadFile(file: TFile): Promise<void> {
    if (this.currentPath === file.path) {
      this.currentPath = null;
      this.deps.selection.set(null, null);
    }
  }

  onResize(): void {
    this.renderAll();
  }

  private buildShell(): void {
    this.contentEl.empty();
    const workspace = this.contentEl.createDiv({ cls: 'mms-workspace' });

    const canvas = workspace.createDiv({ cls: 'mms-canvas-container' });
    this.toolbarEl = el('div', { cls: 'mms-canvas-toolbar' });
    canvas.appendChild(this.toolbarEl);
    this.canvasBody = el('div', { cls: 'mms-canvas-body' });
    canvas.appendChild(this.canvasBody);
    this.footerEl = el('div', { cls: 'mms-canvas-footer' });
    canvas.appendChild(this.footerEl);
  }

  private renderAll(): void {
    this.renderToolbar();
    void this.renderCanvas();
  }

  /** 折叠态最多展示的标签数，超出收进「+N」徽标（展开后全显） */
  private static readonly TAGS_PREVIEW_COUNT = 3;

  private renderToolbar(): void {
    if (!this.toolbarEl) return;
    // 重建前记录输入框焦点：重扫/设置变更触发重渲染时，正在输入的焦点不丢
    const hadFocus = document.activeElement === this.searchBox;
    this.toolbarEl.empty();

    const doc = this.currentDoc();

    // ---- 第一行：标签区（独立布局，可折叠，默认收起防多标签溢出）----
    const tagsRow = el('div', { cls: 'mms-toolbar-row mms-toolbar-tags' });
    tagsRow.appendChild(el('span', { cls: 'mms-canvas-name', text: doc?.displayName ?? '（未打开）' }));

    const tags = doc?.tags ?? [];
    const hasMore = tags.length > MmsView.TAGS_PREVIEW_COUNT;
    const visible = this.tagsExpanded ? tags : tags.slice(0, MmsView.TAGS_PREVIEW_COUNT);
    const tagsBox = el('span', { cls: `mms-tags-box${this.tagsExpanded ? ' is-expanded' : ''}` });
    for (const tag of visible) {
      tagsBox.appendChild(el('span', { cls: 'mms-tag-chip', text: tag }));
    }
    if (!this.tagsExpanded && hasMore) {
      tagsBox.appendChild(el('span', { cls: 'mms-tag-chip mms-tag-more', text: `+${tags.length - visible.length}` }));
    }
    tagsRow.appendChild(tagsBox);

    if (hasMore) {
      const toggle = el('button', {
        cls: 'mms-mini-btn mms-tags-toggle',
        text: this.tagsExpanded ? '▲ 收起' : '▼ 展开',
        attr: { type: 'button', title: this.tagsExpanded ? '收起标签' : '展开全部标签' },
      });
      toggle.addEventListener('click', () => {
        this.tagsExpanded = !this.tagsExpanded;
        this.renderToolbar();
      });
      tagsRow.appendChild(toggle);
    }
    tagsRow.appendChild(el('span', { cls: 'mms-spacer' }));
    this.toolbarEl.appendChild(tagsRow);

    // ---- 第二行：节点搜索 + 视图切换（移动端两行布局，输入框与按钮同排）----
    const searchRow = el('div', { cls: 'mms-toolbar-row mms-toolbar-search' });
    this.searchBox = el('input', {
      cls: 'mms-search-input',
      attr: { type: 'search', placeholder: '搜索节点名称、正文、注释、链接…', 'aria-label': '搜索当前文件的节点' },
    }) as HTMLInputElement;
    this.searchBox.value = this.searchQuery;
    this.searchBox.addEventListener('input', () => {
      this.searchQuery = this.searchBox?.value ?? '';
      this.searchBox?.classList.remove('is-invalid');
      // 输入变化后旧命中失效，清导航态（按「搜索」/ Enter 重新检索）
      if (this.searchHits.length > 0) {
        this.searchHits = [];
        this.searchHitIdx = -1;
        this.updateSearchNav();
      }
    });
    this.searchBox.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        this.searchNode(this.searchQuery);
      }
    });
    searchRow.appendChild(this.searchBox);
    if (hadFocus) this.searchBox.focus();

    const searchBtn = el('button', { cls: 'mms-mini-btn', text: '搜索', attr: { type: 'button' } });
    searchBtn.addEventListener('click', () => this.searchNode(this.searchQuery));
    searchRow.appendChild(searchBtn);

    // 命中导航：多个节点含相同文本（如重复正文）时「上一个/下一个」循环跳转，含计数
    this.searchNavEl = el('span', { cls: 'mms-search-nav is-hidden' });
    const prevBtn = el('button', { cls: 'mms-mini-btn', text: '‹ 上一个', attr: { type: 'button', title: '上一个匹配（循环）' } });
    prevBtn.addEventListener('click', () => this.gotoHit(this.searchHitIdx - 1));
    const nextBtn = el('button', { cls: 'mms-mini-btn', text: '下一个 ›', attr: { type: 'button', title: '下一个匹配（循环）' } });
    nextBtn.addEventListener('click', () => this.gotoHit(this.searchHitIdx + 1));
    this.searchCounterEl = el('span', { cls: 'mms-search-counter' });
    this.searchNavEl.appendChild(prevBtn);
    this.searchNavEl.appendChild(this.searchCounterEl);
    this.searchNavEl.appendChild(nextBtn);
    searchRow.appendChild(this.searchNavEl);
    this.updateSearchNav();

    searchRow.appendChild(el('span', { cls: 'mms-spacer' }));

    const reset = el('button', { cls: 'mms-mini-btn', text: '重置视图', attr: { type: 'button' } });
    reset.addEventListener('click', () => this.viewport.reset());
    searchRow.appendChild(reset);

    for (const mode of ['explore', 'panorama'] as const) {
      const btn = el('button', {
        cls: `mms-mini-btn${this.viewMode === mode ? ' is-active' : ''}`,
        text: mode === 'explore' ? '探索' : '全景',
        attr: { type: 'button' },
      });
      btn.addEventListener('click', () => {
        this.viewMode = mode;
        this.viewModeOverridden = true;
        void this.renderCanvas();
        this.renderToolbar();
      });
      searchRow.appendChild(btn);
    }
    this.toolbarEl.appendChild(searchRow);
  }

  /**
   * 节点搜索：检索当前文件全部展示文本（名称／正文／注释／`<=>`与`::`引用／嵌入），
   * 大小写不敏感；精确名称命中排最前，其余按源码行序。全部命中存入 searchHits，
   * 供「上一个／下一个」循环导航（节点 id 是内部标识，不参与匹配）
   */
  private searchNode(raw: string): void {
    const query = raw.trim();
    if (!query || !this.currentPath) return;
    const doc = this.currentDoc();
    if (!doc) return;

    const lower = query.toLowerCase();
    const matches = (n: IMmsNode): boolean =>
      n.text.toLowerCase().includes(lower) ||
      n.content.some((l) => l.toLowerCase().includes(lower)) ||
      n.annotation.some((l) => l.toLowerCase().includes(lower)) ||
      n.crossRefs.some((r) => r.rawTarget.toLowerCase().includes(lower) || r.label.toLowerCase().includes(lower)) ||
      n.nodeRefs.some((r) => r.rawTarget.toLowerCase().includes(lower)) ||
      n.embeds.some((e) => e.raw.toLowerCase().includes(lower));

    this.searchHits = [...doc.nodeMap.values()]
      .filter((n) => !n.isAutoFix && matches(n))
      .sort((a, b) => Number(b.text === query) - Number(a.text === query) || a.lineNo - b.lineNo)
      .map((n) => n.id);

    if (this.searchHits.length === 0) {
      this.searchHitIdx = -1;
      this.searchBox?.classList.add('is-invalid');
      this.updateFooter(`未找到匹配节点：${query}`);
      this.updateSearchNav();
      return;
    }
    this.searchBox?.classList.remove('is-invalid');
    this.gotoHit(0);
  }

  /** 跳转到第 idx 个命中（越界循环）：选中＋居中＋footer 计数提示 */
  private gotoHit(idx: number): void {
    const total = this.searchHits.length;
    if (total === 0) return;
    this.searchHitIdx = ((idx % total) + total) % total;
    const nodeId = this.searchHits[this.searchHitIdx];
    this.selectNode(nodeId);
    // 节点可能处于折叠分支（被剪枝不在 DOM）：只选中不居中，footer 说明
    const nodeEl = this.canvasBody?.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
    if (nodeEl) this.viewport.centerOnElement(nodeEl);
    const node = this.currentDoc()?.nodeMap.get(nodeId);
    const where = nodeEl ? '' : '（在折叠分支中，展开后可见）';
    this.updateFooter(`匹配 ${this.searchHitIdx + 1}/${total}${where}：${node?.text ?? nodeId}`);
    this.updateSearchNav();
  }

  /** 按命中状态刷新导航按钮显示与计数 */
  private updateSearchNav(): void {
    if (!this.searchNavEl || !this.searchCounterEl) return;
    const has = this.searchHits.length > 0 && this.searchHitIdx >= 0;
    this.searchNavEl.classList.toggle('is-hidden', !has);
    if (has) this.searchCounterEl.textContent = `${this.searchHitIdx + 1}/${this.searchHits.length}`;
  }

  private async renderCanvas(): Promise<void> {
    const body = this.canvasBody;
    if (!body) return;
    const doc = this.currentDoc();
    if (!doc) {
      body.empty();
      body.appendChild(
        el('div', {
          cls: 'mms-empty-hint',
          text: this.currentPath
            ? '文件已移动或索引未同步，点左栏「刷新」按钮重扫'
            : '未打开 .mms 文件，或点左栏「刷新」按钮扫描全部 mms',
        }),
      );
      return;
    }

    const seq = ++this.switchSeq;
    body.empty();

    const settings = this.deps.getSettings();
    const filePath = this.currentPath;
    const directiveOptions = {
      onToggleCollapse: (nodeId: string, currently: boolean): void => {
        // 折叠状态机持久化即文档：写回 collapsed 指令行，modify 事件触发防抖重扫后画布按新文档重渲染
        if (filePath) this.deps.setNodeCollapsed(filePath, nodeId, !currently);
      },
    };
    const fragment =
      this.viewMode === 'panorama'
        ? renderPanorama(doc, {
            lineWidth: settings.panoramaLineWidth,
            crossLineWidth: settings.crossLineWidth,
            lineStyle: doc.lineStyle,
            nodeGap: settings.panoramaNodeGap,
            levelGap: settings.panoramaLevelGap,
            onNodeClick: (nodeId) => this.selectNode(nodeId),
            ...directiveOptions,
          })
        : renderExplore(doc, {
            lineWidth: settings.exploreLineWidth,
            crossLineWidth: settings.crossLineWidth,
            lineStyle: doc.lineStyle,
            nodeGap: settings.exploreNodeGap,
            levelGap: settings.exploreLevelGap,
            onNodeClick: (nodeId) => this.selectNode(nodeId),
            ...directiveOptions,
          });

    if (seq !== this.switchSeq) return;

    const holder = el('div', { cls: this.viewMode === 'panorama' ? 'mms-svg-holder' : 'mms-dom-holder' });
    holder.appendChild(fragment);
    body.appendChild(holder);
    this.viewport.attach(body, holder);

    this.updateFooter();
    this.updateHighlight();
  }

  private selectNode(nodeId: string): void {
    this.deps.selection.set(this.currentPath, nodeId);
  }

  /** 画布 footer 显示最近一次刷新状态，uiHost 广播时实时更新 */
  private updateFooter(detail?: string): void {
    if (!this.footerEl) return;
    this.footerEl.empty();
    this.footerEl.appendChild(el('span', { text: detail ?? this.deps.uiHost.getLastDetail() }));
  }

  /** 按选中总线给画布节点加高亮。渲染后与 selection 变更（含右栏跳转）时都会调用 */
  private updateHighlight(): void {
    if (!this.canvasBody) return;
    const { filePath, nodeId } = this.deps.selection.get();
    // 选中态属于别的文件时清空本画布高亮
    const active = filePath === this.currentPath ? nodeId : null;
    // 探索视图是 HTMLElement、全景视图是 SVG <g>，统一按 Element 处理
    this.canvasBody.querySelectorAll<Element>('[data-node-id]').forEach((node) => {
      node.classList.toggle('is-selected', !!active && node.getAttribute('data-node-id') === active);
    });
  }

  private currentDoc(): IParsedDoc | undefined {
    return this.currentPath ? this.deps.index.getDoc(this.currentPath) : undefined;
  }
}
