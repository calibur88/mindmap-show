/**
 * @module ui/status-card
 * @description 左栏底部状态卡：刷新 / 查看详情两个操作按钮，异常时才显示文案
 */

import type { IUiHost, UiStatus } from '../host/types';
import { el } from '../utils/dom';

const HINT_ERROR = '刷新失败，查看控制台';

export class StatusCard {
  private root: HTMLElement;
  private label: HTMLElement;
  private readonly boundStatus = (state: UiStatus, detail?: string): void => {
    this.setState(state, detail);
  };

  constructor(
    container: HTMLElement,
    private uiHost: IUiHost,
    onRefresh: () => void,
    openDetailPanel: () => void,
  ) {
    this.root = el('div', { cls: 'mms-status-card state-synced' });
    // 正常态不留文案，底栏只保留两个操作按钮；文案仅在刷新失败时出现
    this.label = el('span', { cls: 'mms-status-label' });
    this.root.appendChild(this.label);

    const actions = el('div', { cls: 'mms-status-actions' });
    const refresh = el('button', { cls: 'mms-status-btn', text: '刷新', attr: { type: 'button' } });
    refresh.addEventListener('click', onRefresh);
    const detail = el('button', { cls: 'mms-status-btn', text: '查看详情', attr: { type: 'button' } });
    detail.addEventListener('click', openDetailPanel);
    actions.appendChild(refresh);
    actions.appendChild(detail);
    this.root.appendChild(actions);

    container.appendChild(this.root);

    this.uiHost.onStatus(this.boundStatus);
    // 侧栏重开时先回放最近一次状态，避免上一次的错误态丢失
    this.setState(this.uiHost.getLastState(), this.uiHost.getLastDetail());
  }

  /** error 时把详情写到 title，hover 可看 */
  setState(state: UiStatus, detail?: string): void {
    this.root.className = `mms-status-card state-${state}`;
    if (state === 'error') {
      this.label.textContent = HINT_ERROR;
      if (detail) this.root.setAttribute('title', detail);
    } else {
      this.label.textContent = '';
      this.root.removeAttribute('title');
    }
  }

  /** 注销监听并移除 DOM。侧栏视图 onClose 必须调用，否则监听器随开闭累积泄漏 */
  destroy(): void {
    this.uiHost.offStatus(this.boundStatus);
    this.root.remove();
  }
}
