/**
 * @module views/mms-view
 * @description MMS 主视图：继承 FileView 接管 .mms 文件，承载画布。
 *
 * 节点详情不在本视图内，由挂在右侧 sidebar 的 MmsDetailView 展示，
 * 两者通过 MmsSelection 总线同步当前文件与选中节点
 */

import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type { IOpener, IUiHost, IParsedDoc, UiStatus } from '../host/types';
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
  private readonly viewport = new CanvasViewport();
  /** 用户手动点过「探索 / 全景」后置位，此后不再跟随 defaultView 设置 */
  private viewModeOverridden = false;

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

  private renderToolbar(): void {
    if (!this.toolbarEl) return;
    this.toolbarEl.empty();

    const doc = this.currentDoc();
    this.toolbarEl.appendChild(el('span', { cls: 'mms-canvas-name', text: doc?.displayName ?? '（未打开）' }));
    for (const tag of doc?.tags ?? []) {
      this.toolbarEl.appendChild(el('span', { cls: 'mms-tag-chip', text: tag }));
    }
    this.toolbarEl.appendChild(el('span', { cls: 'mms-spacer' }));

    const reset = el('button', { cls: 'mms-mini-btn', text: '重置视图', attr: { type: 'button' } });
    reset.addEventListener('click', () => this.viewport.reset());
    this.toolbarEl.appendChild(reset);

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
      this.toolbarEl.appendChild(btn);
    }
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
