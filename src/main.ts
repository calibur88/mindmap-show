/**
 * @module main
 * @description 插件入口。只做装配：宿主适配器 → 索引/选中总线 → 视图注册 → 命令/ribbon
 */

import { Modal, Notice, Plugin, TFile, TFolder, normalizePath } from 'obsidian';
import { MmsIndex } from './controller/refresh';
import { MmsSelection } from './controller/selection';
import { parseMms } from './core/parser';
import { ObsidianOpener } from './host/obsidian/opener';
import { ObsidianUiHost } from './host/obsidian/ui-host';
import { ObsidianVaultHost } from './host/obsidian/vault';
import { buildExportSvg } from './render/svg-export';
import { DEFAULT_SETTINGS } from './settings/defaults';
import type { MmsSettings } from './settings/schema';
import { MMS_DETAIL_VIEW_TYPE, MmsDetailView } from './views/detail-view';
import { MMS_VIEW_TYPE, MmsView } from './views/mms-view';
import { MMS_SIDE_VIEW_TYPE, MmsSideView } from './views/side-view';
import { MmsSettingTab } from './views/settings-tab';

const SETTINGS_DEBOUNCE_MS = 400;
/** vault 事件（编辑/重命名/删除）触发重扫的防抖窗口 */
const VAULT_RESCAN_DEBOUNCE_MS = 500;

export default class MmsPlugin extends Plugin {
  settings: MmsSettings = { ...DEFAULT_SETTINGS };

  private index: MmsIndex | null = null;
  /** 当前选中/打开的脑图文件总线。MmsView 写入，右栏详情面板与本插件的导出读取 */
  private selection: MmsSelection | null = null;
  private readonly settingsListeners: (() => void)[] = [];
  private settingsTimer: number | null = null;
  /** 防抖窗口内尚有未落盘的设置变更 */
  private settingsDirty = false;
  private vaultTimer: number | null = null;
  private detailAutoOpened = false;
  /** 防抖窗口内是否累积了需要广播重绘的设置变更（静默更新不置位） */
  private settingsBroadcast = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    const vaultHost = new ObsidianVaultHost(this.app);
    // 视图类型常量由 main 注入，host 层不反向依赖 views 层
    const opener = new ObsidianOpener(this.app, MMS_VIEW_TYPE);
    const uiHost = new ObsidianUiHost();
    const index = new MmsIndex(vaultHost, uiHost);
    const selection = new MmsSelection();
    this.index = index;
    this.selection = selection;

    this.registerView(
      MMS_VIEW_TYPE,
      (leaf) =>
        new MmsView(leaf, {
          index,
          opener,
          uiHost,
          selection,
          getSettings: () => this.settings,
          ensureDetailLeaf: () => this.ensureDetailLeaf(),
          onSettingsChange: (fn) => this.onSettingsChange(fn),
          setNodeCollapsed: (filePath, nodeId, collapsed) =>
            void this.writeCollapseDirective(filePath, nodeId, collapsed),
        }),
    );
    this.registerView(
      MMS_SIDE_VIEW_TYPE,
      (leaf) =>
        new MmsSideView(leaf, {
          index,
          opener,
          uiHost,
          getSettings: () => this.settings,
          onSettingsChange: (fn) => this.onSettingsChange(fn),
          openDetailPanel: () => void this.openDetailPanel(),
          // 导出图片两步回调打包成一个对象透传，UI / SideViewDeps 都不感知 vault
          exportFlow: {
            requestExport: () => this.requestExport(),
            confirmSave: (path, svg) => this.confirmSave(path, svg),
          },
          getCollapsedFolders: () => this.settings.collapsedFolders,
          persistCollapsedFolders: (folders) =>
            this.updateSettingsSilently({ collapsedFolders: folders }),
        }),
    );
    this.registerView(
      MMS_DETAIL_VIEW_TYPE,
      (leaf) => new MmsDetailView(leaf, { index, opener, selection }),
    );
    this.registerExtensions(['mms'], MMS_VIEW_TYPE);
    this.addSettingTab(new MmsSettingTab(this.app, this));

    this.addRibbonIcon('git-fork', 'MMS：打开文件面板', () => {
      void this.openSidePanel();
    });

    this.addCommand({
      id: 'mms-open-side',
      name: 'MMS：打开文件面板',
      callback: () => {
        void this.openSidePanel();
      },
    });

    this.addCommand({
      id: 'mms-open-detail',
      name: 'MMS：打开详情面板',
      callback: () => {
        void this.openDetailPanel();
      },
    });

    this.addCommand({
      id: 'mms-refresh',
      name: 'MMS：刷新全部 .mms',
      callback: () => {
        void index.refresh();
      },
    });

    // .mms 文件被编辑 / 重命名 / 删除后自动重扫（防抖合并连续事件）。
    // 文件夹重命名会连带改变内部 .mms 路径，一律触发
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        // 文件夹重命名：先把折叠记录迁移到新路径，再触发重扫
        if (file instanceof TFolder) this.remapCollapsedFolders(oldPath, file.path);
        if (!(file instanceof TFile) || file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        // 文件夹删除：清掉它及子路径的折叠记录，再触发重扫
        if (file instanceof TFolder) this.pruneCollapsedFolders(file.path);
        if (!(file instanceof TFile) || file.extension === 'mms') this.scheduleVaultRescan();
      }),
    );

    // 组件就绪后做首次全库扫描；空库时侧栏自己会给出提示
    void index.refresh();
  }

  onunload(): void {
    if (this.settingsTimer !== null) {
      window.clearTimeout(this.settingsTimer);
      this.settingsTimer = null;
    }
    if (this.vaultTimer !== null) {
      window.clearTimeout(this.vaultTimer);
      this.vaultTimer = null;
    }
    // 防抖窗口内未落盘的设置立即补写，避免卸载时丢失
    if (this.settingsDirty) void this.saveData(this.settings);
    this.settingsListeners.length = 0;
    this.index = null;
    this.selection = null;
  }

  /** 合并设置并安排防抖落盘与广播。非法输入由设置面板在调用前拦截 */
  updateSettings(patch: Partial<MmsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.settingsDirty = true;
    this.settingsBroadcast = true;
    this.scheduleSettingsFlush();
  }

  /**
   * 静默合并：只改内存与落盘，不广播设置变更、不触发重扫。
   * 供文件夹折叠等已做局部 DOM 更新的 UI 状态使用，避免整栏重绘丢滚动位置
   */
  updateSettingsSilently(patch: Partial<MmsSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.settingsDirty = true;
    this.scheduleSettingsFlush();
  }

  /**
   * 订阅设置变更。回调在防抖窗口结束后触发，已保证 this.settings 是最新值。
   * 返回注销函数，视图 onClose 必须调用
   */
  onSettingsChange(fn: () => void): () => void {
    this.settingsListeners.push(fn);
    return () => this.offSettingsChange(fn);
  }

  private offSettingsChange(fn: () => void): void {
    const idx = this.settingsListeners.indexOf(fn);
    if (idx >= 0) this.settingsListeners.splice(idx, 1);
  }

  /** 防抖落盘 + 广播：先保存；非静默变更再让各视图按新设置重绘并整库重扫 */
  private scheduleSettingsFlush(): void {
    if (this.settingsTimer !== null) window.clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => {
      this.settingsTimer = null;
      const broadcast = this.settingsBroadcast;
      this.settingsBroadcast = false;
      void (async () => {
        await this.saveData(this.settings);
        this.settingsDirty = false;
        if (!broadcast) return;
        for (const fn of [...this.settingsListeners]) fn();
        await this.index?.refresh();
      })();
    }, SETTINGS_DEBOUNCE_MS);
  }

  /** vault 事件防抖：短时间内多次编辑只触发一次全库重扫 */
  private scheduleVaultRescan(): void {
    if (this.vaultTimer !== null) window.clearTimeout(this.vaultTimer);
    this.vaultTimer = window.setTimeout(() => {
      this.vaultTimer = null;
      void this.index?.refresh();
    }, VAULT_RESCAN_DEBOUNCE_MS);
  }

  /**
   * 文件夹重命名后迁移折叠记录：精确匹配换新路径，子路径按前缀替换。
   * 根目录「/」不可重命名，无需处理其边界
   */
  private remapCollapsedFolders(oldPath: string, newPath: string): void {
    const list = this.settings.collapsedFolders;
    if (list.length === 0) return;
    const prefix = `${oldPath}/`;
    let changed = false;
    const next = list.map((p) => {
      if (p === oldPath) {
        changed = true;
        return newPath;
      }
      if (p.startsWith(prefix)) {
        changed = true;
        return `${newPath}${p.slice(oldPath.length)}`;
      }
      return p;
    });
    if (changed) this.updateSettingsSilently({ collapsedFolders: next });
  }

  /** 文件夹删除后清掉它及子路径的折叠记录 */
  private pruneCollapsedFolders(folderPath: string): void {
    const list = this.settings.collapsedFolders;
    if (list.length === 0) return;
    const prefix = `${folderPath}/`;
    const next = list.filter((p) => p !== folderPath && !p.startsWith(prefix));
    if (next.length !== list.length) this.updateSettingsSilently({ collapsedFolders: next });
  }

  private async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<MmsSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  /** 折叠写回串行队列：队尾指针，前一个任务完成（或失败）后一个才开始，防连点并发覆盖 */
  private collapseWriteTail: Promise<void> = Promise.resolve();

  /**
   * 折叠徽标点击的写回：在 .mms 文档中插入 / 改写 / 删除 collapsed 指令行。
   * 持久化即文档本身（不进设置文件）；写回后 modify 事件触发防抖重扫，画布按新文档重渲染。
   * 每个任务在执行时读最新文本并现场重解析定位行号：前一次写回会使行号整体漂移，
   * 而全局索引重扫有 500ms 防抖窗口，依赖旧 directiveBindings 会写错行
   */
  private writeCollapseDirective(filePath: string, nodeId: string, collapsed: boolean): Promise<void> {
    const task = async (): Promise<void> => {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) return;

      const text = await this.app.vault.read(file);
      const doc = parseMms(text, filePath);
      const node = doc.nodeMap.get(nodeId);
      if (!node || node.isAutoFix) return;

      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(/\r?\n/);
      // 该节点已有的 collapsed 指令行（含显式 `> false`），无则 null
      const bound = doc.directiveBindings?.find((b) => b.nodeId === nodeId && b.key === 'collapsed') ?? null;

      if (collapsed) {
        // 折叠：已有指令行改写为 true（覆盖显式 false），否则插入到声明行之后（默认绑定到该节点）
        const indent = /^[\t ]*/.exec(lines[node.lineNo - 1] ?? '')?.[0] ?? '';
        if (bound) lines[bound.lineNo - 1] = `${indent}!-- collapsed`;
        else lines.splice(node.lineNo, 0, `${indent}!-- collapsed`);
      } else {
        // 展开：删除绑定的指令行；无指令行属异常态，防御返回
        if (!bound) return;
        lines.splice(bound.lineNo - 1, 1);
      }

      await this.app.vault.modify(file, lines.join(eol));
    };

    const run = async (): Promise<void> => {
      try {
        await task();
      } catch (err) {
        // 单次失败只记日志，不断链：后续点击仍可继续排队写回
        console.error('[MMS] collapsed 指令写回失败', err);
      }
    };
    this.collapseWriteTail = this.collapseWriteTail.then(run, run);
    return this.collapseWriteTail;
  }

  private async openSidePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_SIDE_VIEW_TYPE);
    const leaf = existing[0] ?? this.app.workspace.getLeftLeaf(false);
    if (!leaf) return;
    if (existing.length > 0) await this.app.workspace.revealLeaf(leaf);
    else await leaf.setViewState({ type: MMS_SIDE_VIEW_TYPE, active: true });
  }

  /** 唤起右侧详情面板：已打开时聚焦即可 */
  async openDetailPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(MMS_DETAIL_VIEW_TYPE);
    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: MMS_DETAIL_VIEW_TYPE, active: true });
  }

  /**
   * 判定当前该导出哪个 .mms 文件。三级探测，全部不依赖 view 实例：
   *
   * 1. 最近活跃 leaf 上的 FileView.file —— 覆盖多标签切换（切回已加载的 tab
   *    不会重触发 onLoadFile，selection 可能是旧值，leaf.file 才是实时的）
   * 2. workspace.getActiveFile() —— 活跃文件本身是 .mms 的情况
   * 3. selection 总线的 filePath —— 与右栏详情面板同源，兜底
   *
   * 不用 `getLeavesOfType(MMS_VIEW_TYPE)[0]`：数组首项未必是活跃项，
   * 且 workspace 恢复布局时后台 leaf 的 view 可能尚未构造完，
   * `instanceof MmsView` 会误判为「不是脑图视图」
   */
  private resolveExportTarget(): string | null {
    // 鸭子类型读 file：FileView.file 是公开属性，避免类引用判定
    const leafView = this.app.workspace.getMostRecentLeaf()?.view as { file?: { path?: string; extension?: string } | null } | null;
    const leafFile = leafView?.file;
    if (leafFile?.path && leafFile.extension === 'mms') return leafFile.path;

    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile?.extension === 'mms') return activeFile.path;

    return this.selection?.get().filePath ?? null;
  }

  /**
   * 导出第一步：取 doc 生成 SVG 并返回默认保存路径。
   * 找不到文件 / 索引未同步一律 throw，状态卡用 try/catch 显示行内错误
   */
  private requestExport(): { defaultPath: string; svg: string } {
    const filePath = this.resolveExportTarget();
    if (!filePath) throw new Error('请先在中间栏打开一个 .mms 文件');
    const doc = this.index?.getDoc(filePath);
    if (!doc) throw new Error('索引未同步，请点「手动刷新」');
    const svg = buildExportSvg(doc, {
      lineWidth: this.settings.panoramaLineWidth,
      crossLineWidth: this.settings.crossLineWidth,
      lineStyle: doc.lineStyle,
      nodeGap: this.settings.panoramaNodeGap,
      levelGap: this.settings.panoramaLevelGap,
    });
    // 默认路径 = `<vault 根>/export/<源文件名>.svg`，目录不存在由 confirmSave 创建
    const baseName = filePath.replace(/\.mms$/i, '').split('/').pop() || 'mindmap';
    return {
      defaultPath: `export/${baseName}.svg`,
      svg,
    };
  }

  /**
   * 导出第二步：把 SVG 写入用户指定的路径。
   * 流程：normalize → 补 .svg 后缀 → 逐层 createFolder → 覆盖确认 → vault.create / vault.modify
   * 任意步骤失败一律 throw，状态卡显示行内错误并保持展开
   */
  private async confirmSave(rawPath: string, svg: string): Promise<void> {
    let path = rawPath.trim();
    if (!path) throw new Error('路径不能为空');
    path = normalizePath(path);
    while (path.startsWith('/')) path = path.slice(1);
    if (!path || path === '/') throw new Error('路径非法');
    if (path.includes('..')) throw new Error('路径不允许包含 ..');
    if (!path.toLowerCase().endsWith('.svg')) path += '.svg';

    // 逐层 createFolder：Obsidian 没 mkdir -p，按段判存在后建
    // 并发下 createFolder 可能抛「已存在」，被 catch 兜底
    const parts = path.split('/').slice(0, -1);
    let cur = '';
    for (const seg of parts) {
      cur = cur ? `${cur}/${seg}` : seg;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch (err) {
          if (!(err instanceof Error) || !/exist/i.test(err.message)) throw err;
        }
      }
    }

    // 覆盖确认：取消按 throw Error 处理，状态卡显示行内错误保持展开
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      const ok = await this.confirmOverwrite(path);
      if (!ok) throw new Error('已取消：目标文件已存在');
    }

    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, svg);
    } else {
      await this.app.vault.create(path, svg);
    }
    new Notice(`SVG 已保存：${path}`);
  }

  /**
   * 覆盖确认 Modal：返回 Promise<boolean>，点 × 也按取消处理避免挂起。
   * 用 inline 匿名类保持局部性，避免在 src/views 里再加 ConfirmModal.ts
   */
  private confirmOverwrite(path: string): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false;
      const decide = (ok: boolean): void => {
        if (resolved) return;
        resolved = true;
        resolve(ok);
      };
      class OverwriteModal extends Modal {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        constructor(app: any) {
          super(app);
        }
        onOpen(): void {
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl('h3', { text: '文件已存在' });
          contentEl.createEl('p', { text: `目标路径已存在，是否覆盖？\n${path}` });
          const row = contentEl.createDiv({ cls: 'mms-modal-buttons' });
          const cancelBtn = row.createEl('button', { text: '取消' });
          cancelBtn.addEventListener('click', () => {
            decide(false);
            this.close();
          });
          const okBtn = row.createEl('button', { text: '覆盖', cls: 'mod-warning' });
          okBtn.addEventListener('click', () => {
            decide(true);
            this.close();
          });
        }
        onClose(): void {
          decide(false);
        }
      }
      new OverwriteModal(this.app).open();
    });
  }

  /** onload 时（且仅一次）自动挂详情面板，避免用户以为右栏坏了 */
  private ensureDetailLeaf(): void {
    if (this.detailAutoOpened) return;
    this.detailAutoOpened = true;
    void this.openDetailPanel();
  }
}
