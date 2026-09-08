/**
 * @module host/obsidian/vault
 * @description 文件系统适配器：扫描 .mms 文件、读取内容
 */

import { App } from 'obsidian';
import type { IVaultHost } from '../types';

export class ObsidianVaultHost implements IVaultHost {
  constructor(private app: App) {}

  async listMmsFiles(): Promise<string[]> {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension === 'mms')
      .map((file) => file.path)
      .sort();
  }

  async readFile(filePath: string): Promise<string> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file) throw new Error(`文件不存在: ${filePath}`);
    return this.app.vault.cachedRead(file);
  }
}
