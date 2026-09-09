/**
 * @module host/obsidian/ui-host
 * @description UI 反馈适配器：状态变更广播。左栏状态卡与画布 footer 共用
 */

import type { IUiHost, UiStatus } from '../types';

export type StatusListener = (state: UiStatus, detail?: string) => void;

/** 生产环境 UI 反馈实现。状态变更广播给左栏状态卡与画布 footer */
export class ObsidianUiHost implements IUiHost {
  private listeners: StatusListener[] = [];
  private lastState: UiStatus = 'synced';
  private lastDetail = '手动刷新数据';

  /** 广播状态变更，同时缓存最近状态与 detail，供控件重建时回放 */
  setStatus(state: UiStatus, detail?: string): void {
    this.lastState = state;
    if (detail !== undefined) this.lastDetail = detail;
    for (const listener of [...this.listeners]) listener(state, detail);
  }

  onStatus(listener: StatusListener): void {
    this.listeners.push(listener);
  }

  offStatus(listener: StatusListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  getLastState(): UiStatus {
    return this.lastState;
  }

  getLastDetail(): string {
    return this.lastDetail;
  }
}
