/**
 * @module views/mms-view
 * @description MMS 主视图：继承 FileView 接管 .mms 文件，承载画布。
 *
 * 节点详情不在本视图内，由挂在右侧 sidebar 的 MmsDetailView 展示，
 * 两者通过 MmsSelection 总线同步当前文件与选中节点
 */

import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type { IOpener, IUiHost, IParsedDoc } from '../host/types';
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
      body.appendChild(el('div', { cls: 'mms-empty-hint', text: '未打开 .mms 文件，或点左栏「刷新」按钮扫描全部 mms' }));
      return;
    }

    const seq = ++this.switchSeq;
    body.empty();

    const settings = this.deps.getSettings();
    const fragment =
      this.viewMode === 'panorama'
        ? renderPanorama(doc, {
            lineWidth: settings.panoramaLineWidth,
            crossLineWidth: settings.crossLineWidth,
            nodeGap: settings.panoramaNodeGap,
            levelGap: settings.panoramaLevelGap,
            onNodeClick: (nodeId) => this.selectNode(nodeId),
          })
        : renderExplore(doc, {
            lineWidth: settings.exploreLineWidth,
            crossLineWidth: settings.crossLineWidth,
            nodeGap: settings.exploreNodeGap,
            levelGap: settings.exploreLevelGap,
            onNodeClick: (nodeId) => this.selectNode(nodeId),
          });

    if (seq !== this.switchSeq) return;

    const holder = el('div', { cls: this.viewMode === 'panorama' ? 'mms-svg-holder' : 'mms-dom-holder' });
    holder.appendChild(fragment);
    body.appendChild(holder);
    this.viewport.attach(body, holder);

    if (this.footerEl) {
      this.footerEl.empty();
      this.footerEl.appendChild(el('span', { text: this.deps.uiHost.getLastDetail() }));
    }
  }

  private selectNode(nodeId: string): void {
    this.deps.selection.set(this.currentPath, nodeId);
  }

  private currentDoc(): IParsedDoc | undefined {
    return this.currentPath ? this.deps.index.getDoc(this.currentPath) : undefined;
  }
}
