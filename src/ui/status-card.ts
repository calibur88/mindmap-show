/**
 * @module ui/status-card
 * @description 左栏底部状态卡：手动刷新 / 打开详情 / 导出图片三个操作按钮，
 * 点击「导出图片」后在下方展开内嵌保存栏（输入框 + 确认 + 取消 + 行内错误提示）。
 * 设计动机：移动端 Electron 不支持 `a[download]` + Blob URL 触发的系统保存对话框，
 * 改走 vault.create / vault.modify 直接写入 vault，桌面端与移动端统一体验
 */

import type { IUiHost, UiStatus } from '../host/types';
import { el } from '../utils/dom';

const HINT_ERROR = '刷新失败，查看控制台';

/**
 * 状态卡对外暴露的两步回调，main 注入具体实现，UI 不感知 vault。
 *
 * 拆成两步的原因：点导出按钮时只能立刻拿到 doc；确认保存时才有最终路径，
 * 中间允许用户改路径；写盘失败需保留 SVG 让用户改路径重试而不是从头生成
 *
 * 错误一律走 throw / reject：
 * - requestExport throw → 找不到文件 / 索引未同步 / buildExportSvg 异常
 * - confirmSave reject → 路径非法 / 覆盖被拒 / 写盘异常
 * 状态卡用 try/catch 显示行内错误，不弹 Notice；成功由 main 自己 new Notice
 */
export interface ExportFlow {
  /** 返回默认保存路径与已渲染好的 SVG 字符串；错误 throw */
  requestExport(): { defaultPath: string; svg: string };
  /** 写盘成功 resolve（main 内部已 new Notice），失败 reject */
  confirmSave(path: string, svg: string): Promise<void>;
}

/** 状态机：默认按钮 / 保存中（按钮禁用防重复点） / 错误态（保持展开 + 错误提示） */
type CardState = 'idle' | 'saving' | 'error';

export class StatusCard {
  private root: HTMLElement;
  private actions: HTMLElement;
  private label: HTMLElement;

  /** 保存栏：输入框 + 确认 + 取消 + 行内错误行；默认 display: none */
  private saveBar: HTMLElement;
  private saveInput: HTMLInputElement;
  private saveConfirmBtn: HTMLButtonElement;
  private saveCancelBtn: HTMLButtonElement;
  private saveError: HTMLElement;

  /** 当前保存栏内待写入的 svg；用户改路径时不会丢；cancel 后清空 */
  private pendingSvg: string | null = null;
  /** 状态机 */
  private state: CardState = 'idle';
  /**
   * 覆盖确认 Modal 期间为 true，挡住 Enter 键和按钮 click 触发的 confirmSave，
   * 否则用户在 Modal 里看路径的等待期会触发第二次落盘
   */
  private confirming = false;

  private readonly boundStatus = (state: UiStatus, detail?: string): void => {
    this.setState(state, detail);
  };

  constructor(
    container: HTMLElement,
    private uiHost: IUiHost,
    onRefresh: () => void,
    openDetailPanel: () => void,
    private flow: ExportFlow,
  ) {
    this.root = el('div', { cls: 'mms-status-card state-synced' });
    // 正常态不留文案，底栏只保留操作按钮；文案仅在刷新失败时出现
    this.label = el('span', { cls: 'mms-status-label' });
    this.root.appendChild(this.label);

    // ---------------------- 三按钮行（始终渲染） ----------------------
    this.actions = el('div', { cls: 'mms-status-actions' });
    const refresh = el('button', {
      cls: 'mms-status-btn',
      text: '手动刷新',
      attr: { type: 'button', title: '重新扫描整个 vault 的 .mms 文件' },
    });
    refresh.addEventListener('click', onRefresh);
    const detail = el('button', {
      cls: 'mms-status-btn',
      text: '打开详情',
      attr: { type: 'button', title: '唤起右侧详情面板' },
    });
    detail.addEventListener('click', openDetailPanel);
    const exportBtn = el('button', {
      cls: 'mms-status-btn',
      text: '导出图片',
      attr: { type: 'button', title: '把当前脑图导出为 SVG 文件' },
    });
    exportBtn.addEventListener('click', () => this.onExportClick());
    this.actions.appendChild(refresh);
    this.actions.appendChild(detail);
    this.actions.appendChild(exportBtn);
    this.root.appendChild(this.actions);

    // ---------------------- 内嵌保存栏（默认隐藏） ----------------------
    // 点「导出图片」后展开，与三按钮行互斥；同一时刻只显示一组
    this.saveBar = el('div', { cls: 'mms-save-bar' });
    const saveRow = el('div', { cls: 'mms-save-row' });
    this.saveInput = el('input', {
      cls: 'mms-save-input',
      attr: {
        type: 'text',
        placeholder: '保存路径（相对 vault 根）',
        spellcheck: 'false',
      },
    });
    // Enter = 确认，Esc = 取消；快捷键挂在 input 上，焦点跟随栏位
    this.saveInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void this.onConfirmClick();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.collapse();
      }
    });
    this.saveConfirmBtn = el('button', {
      cls: 'mms-status-btn',
      text: '确认',
      attr: { type: 'button' },
    });
    this.saveConfirmBtn.addEventListener('click', () => void this.onConfirmClick());
    this.saveCancelBtn = el('button', {
      cls: 'mms-status-btn',
      text: '取消',
      attr: { type: 'button' },
    });
    this.saveCancelBtn.addEventListener('click', () => this.collapse());
    saveRow.appendChild(this.saveInput);
    saveRow.appendChild(this.saveConfirmBtn);
    saveRow.appendChild(this.saveCancelBtn);
    this.saveError = el('div', { cls: 'mms-save-error' });
    this.saveBar.appendChild(saveRow);
    this.saveBar.appendChild(this.saveError);
    this.root.appendChild(this.saveBar);

    // 双保险隐藏保存栏：CSS `.mms-save-bar` 默认 display:none，这里再以内联
    // 样式兜底（覆盖样式文件尚未加载的间隙），避免"打开侧栏就弹出输入框"。
    // 点「导出图片」后 expandSaveBar 显式置 flex，取消后 collapse 置 none
    this.saveBar.style.display = 'none';

    container.appendChild(this.root);

    this.uiHost.onStatus(this.boundStatus);
    // 侧栏重开时先回放最近一次状态，避免上一次的错误态丢失
    this.setState(this.uiHost.getLastState(), this.uiHost.getLastDetail());
  }

  /** error 时把详情写到 title，hover 可看（与导出流程的错误是两条线） */
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

  // ============================ 导出流程 ============================

  /**
   * 用户点「导出图片」按钮。
   * 错误（取数据失败）不展开输入栏，只在按钮行下显示行内红字——因为
   * 此时既没有 svg 也没有默认路径，强行展开会让用户面对空表单
   */
  private onExportClick(): void {
    if (this.state === 'saving') return;
    let payload: { defaultPath: string; svg: string };
    try {
      payload = this.flow.requestExport();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : String(err));
      return;
    }
    this.expandSaveBar(payload.defaultPath, payload.svg);
  }

  /** 展开保存栏：填默认路径 + focus + 预生成 svg 缓存，等用户点确认 */
  private expandSaveBar(defaultPath: string, svg: string): void {
    this.pendingSvg = svg;
    this.saveInput.value = defaultPath;
    this.saveError.textContent = '';
    this.saveBar.classList.remove('has-error');
    this.saveBar.style.display = 'flex';
    this.actions.style.display = 'none';
    this.state = 'idle';
    // 微任务延后 focus：避免与按钮 click 事件的 blur 抢焦点时序
    queueMicrotask(() => {
      this.saveInput.focus();
      // 光标置末尾而非全选：用户多半想保留前缀只改文件名
      const len = this.saveInput.value.length;
      this.saveInput.setSelectionRange(len, len);
    });
  }

  /**
   * 确认按钮 / Enter 键触发。
   * 双保险：saving 与 confirming 期间再次进入直接 return，避免覆盖确认 Modal 期间
   * 重复点确认触发第二次写盘
   */
  private async onConfirmClick(): Promise<void> {
    if (this.state === 'saving' || this.confirming) return;
    const svg = this.pendingSvg;
    if (!svg) return;
    const path = this.saveInput.value.trim();
    if (!path) {
      this.showError('路径不能为空');
      this.state = 'error';
      return;
    }
    this.state = 'saving';
    this.setButtonsDisabled(true);
    this.clearError();
    try {
      this.confirming = true;
      await this.flow.confirmSave(path, svg);
      // 成功才收起；失败由 catch 显示错误并保持展开
      this.collapse();
    } catch (err) {
      this.state = 'error';
      this.showError(err instanceof Error ? err.message : String(err));
      // 让用户立即改路径重试，焦点回到输入框
      this.saveInput.focus();
    } finally {
      this.confirming = false;
      // 失败态保持 error，收起态在 collapse 已置 idle
      if (this.state === 'saving') this.state = 'idle';
      this.setButtonsDisabled(false);
    }
  }

  /** 取消按钮 / Esc 键触发：清空 pending svg，回到三按钮态 */
  private collapse(): void {
    this.pendingSvg = null;
    this.state = 'idle';
    this.confirming = false;
    this.saveBar.classList.remove('has-error');
    this.saveError.textContent = '';
    this.saveInput.value = '';
    this.saveBar.style.display = 'none';
    this.actions.style.display = '';
  }

  private showError(msg: string): void {
    this.saveError.textContent = `⚠ ${msg}`;
    this.saveBar.classList.add('has-error');
  }

  private clearError(): void {
    this.saveError.textContent = '';
    this.saveBar.classList.remove('has-error');
  }

  private setButtonsDisabled(disabled: boolean): void {
    this.saveConfirmBtn.disabled = disabled;
    this.saveCancelBtn.disabled = disabled;
    this.saveInput.disabled = disabled;
  }
}