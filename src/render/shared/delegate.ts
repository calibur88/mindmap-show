/**
 * @module render/shared/delegate
 * @description 节点点击的事件委托。探索视图（DOM）与全景视图（SVG）共用同一套分流顺序：
 * 折叠徽标优先分流 → 反查节点 → `is-locked` 拦截 → 回调。
 * 画布上只挂一个 click listener，重渲染不需要重新绑定（规范 §10.10）
 */

/** 分流用的选择器与反查策略：两视图的类名、节点 id 的取法不同，由调用方给出 */
export interface IDelegateSelectors {
  /** 折叠徽标选择器，命中即优先分流（徽标位于节点内部，须先于节点分支判断） */
  fold: string;
  /** 节点选择器，`closest` 反查用（须含 `data-node-id`） */
  node: string;
  /** 从命中的折叠徽标元素解析节点 id：DOM 视图读自身的 `data-fold-id`，SVG 视图读所属节点祖先 */
  foldNodeId: (fold: Element) => string | null;
}

/** 委托回调。两个都不传时不挂 listener、不加 `is-clickable` */
export interface IDelegateHandlers {
  /** 节点点击回调，`is-locked` 的节点不触发 */
  onNodeClick?: (nodeId: string) => void;
  /** 折叠徽标点击回调；`currently` 为点击前的有效折叠态 */
  onToggleCollapse?: (nodeId: string, currently: boolean) => void;
}

/** 在画布根上挂事件委托。选择器与回调由各视图注入，分流逻辑只有这一份 */
export function attachNodeDelegation(
  root: Element,
  selectors: IDelegateSelectors,
  handlers: IDelegateHandlers,
): void {
  if (!handlers.onNodeClick && !handlers.onToggleCollapse) return;
  root.classList.add('is-clickable');
  root.addEventListener('click', (evt) => {
    const target = evt.target;
    if (!(target instanceof Element)) return;

    const fold = target.closest(selectors.fold);
    if (fold) {
      if (handlers.onToggleCollapse) {
        const nodeId = selectors.foldNodeId(fold);
        if (nodeId) handlers.onToggleCollapse(nodeId, fold.classList.contains('is-collapsed'));
      }
      return;
    }

    if (!handlers.onNodeClick) return;
    const nodeEl = target.closest(selectors.node);
    const nodeId = nodeEl?.getAttribute('data-node-id');
    if (!nodeEl || !nodeId) return;
    // locked 拦截：不触发选中（title 已提示「已锁定」，CSS 光标 not-allowed）
    if (nodeEl.classList.contains('is-locked')) return;
    handlers.onNodeClick(nodeId);
  });
}
