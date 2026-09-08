/**
 * @module host/obsidian/opener
 * @description 打开能力适配器：脑图 / 源码
 */

import { App, Notice } from 'obsidian';
import type { IOpener } from '../types';

export class ObsidianOpener implements IOpener {
  constructor(private app: App) {}

  async openMindMap(filePath: string): Promise<void> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      new Notice(`文件不存在: ${filePath}`);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /**
   * 强制以 markdown 视图的 source 模式打开，绕开 .mms 视图的扩展名接管，
   * 让用户在原生编辑器里直接改 .mms 文件
   */
  async openSource(filePath: string, lineNo?: number): Promise<void> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) {
      new Notice(`文件不存在: ${filePath}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({
      type: 'markdown',
      state: { file: filePath, mode: 'source' },
      // 兼容低版本：eState 是新 API，老版本用 { line }
      eState: lineNo ? { line: lineNo } : {},
    } as Parameters<typeof leaf.setViewState>[0]);
  }
}
