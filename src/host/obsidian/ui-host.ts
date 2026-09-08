/**
 * @module host/obsidian/ui-host
 * @description UI 反馈适配器：状态变更广播
 */

import type { IUiHost } from '../types';

export type StatusListener = (state: 'synced' | 'error', detail?: string) => void;

/** 生产环境 UI 反馈实现。状态变更广播给左栏状态卡 */
export class ObsidianUiHost implements IUiHost {
  private listeners: StatusListener[] = [];
  private lastDetail = '手动刷新数据';

  /**
   * 广播状态变更，同时缓存最新 detail 给 footer 取用
   */
  setStatus(state: 'synced' | 'error', detail?: string): void {
    if (detail !== undefined) this.lastDetail = detail;
    for (const listener of this.listeners) listener(state, detail);
  }

  /**
   * 注册状态监听
   */
  onStatus(listener: StatusListener): void {
    this.listeners.push(listener);
  }

  /**
   * @returns 最近一次 setStatus 的 detail
   */
  getLastDetail(): string {
    return this.lastDetail;
  }
}
