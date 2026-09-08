/**
 * @module controller/selection
 * @description 当前脑图的选中状态总线：MmsView 写入，右侧详情面板读取
 */

export interface ISelectionState {
  filePath: string | null;
  nodeId: string | null;
}

export class MmsSelection {
  private state: ISelectionState = { filePath: null, nodeId: null };
  private listeners: (() => void)[] = [];

  set(filePath: string | null, nodeId: string | null): void {
    if (this.state.filePath === filePath && this.state.nodeId === nodeId) return;
    this.state = { filePath, nodeId };
    for (const listener of this.listeners) listener();
  }

  get(): Readonly<ISelectionState> {
    return this.state;
  }

  onChange(listener: () => void): void {
    this.listeners.push(listener);
  }

  offChange(listener: () => void): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }
}
