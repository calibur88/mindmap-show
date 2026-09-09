/**
 * @module host/obsidian/opener
 * @description 打开能力适配器：脑图 / 源码。同文件已打开时复用标签页，避免无限堆叠
 */

import { App, FileView, MarkdownView, Notice, WorkspaceLeaf } from 'obsidian';
import type { IOpener } from '../types';

export class ObsidianOpener implements IOpener {
  /**
   * @param mindMapViewType .mms 脑图视图的 getViewType() 值。
   * 由 main.ts 注入，host 层不反向依赖 views 层
   */
  constructor(private app: App, private mindMapViewType: string) {}

  async openMindMap(filePath: string): Promise<void> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      new Notice(`文件不存在: ${filePath}`);
      return;
    }
    const existing = this.findLeaf(filePath, this.mindMapViewType);
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      return;
    }
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  /**
   * 强制以 markdown 视图的 source 模式打开，绕开 .mms 视图的扩展名接管，
   * 让用户在原生编辑器里直接改 .mms 文件。已打开同文件源码时复用该标签页
   */
  async openSource(filePath: string, lineNo?: number): Promise<void> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      new Notice(`文件不存在: ${filePath}`);
      return;
    }
    const existing = this.findLeaf(filePath, 'markdown');
    if (existing) {
      void this.app.workspace.revealLeaf(existing);
      if (lineNo !== undefined) this.revealLine(existing, lineNo);
      return;
    }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({
      type: 'markdown',
      state: { file: filePath, mode: 'source' },
    });
    if (lineNo !== undefined) this.revealLine(leaf, lineNo);
  }

  /** 找到以指定视图类型打开着该文件的标签页；没有则返回 null */
  private findLeaf(filePath: string, viewType: string): WorkspaceLeaf | null {
    for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
      const view = leaf.view;
      if (view instanceof FileView && view.file?.path === filePath) return leaf;
    }
    return null;
  }

  /**
   * 把 markdown 编辑器定位到 1 起的行号。
   * 不走 setViewState 的 eState：编辑器未就绪时它不保证滚动，这里显式 setCursor 兜底
   */
  private revealLine(leaf: WorkspaceLeaf, lineNo: number): void {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const line = Math.max(0, lineNo - 1);
    view.editor.setCursor({ line, ch: 0 });
    view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
  }
}
