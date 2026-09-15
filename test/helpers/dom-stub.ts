/**
 * @module test/helpers/dom-stub
 * @description 最小 DOM 替身，供 ui 层单测使用（`environment: node`，不引 jsdom）。
 *
 * 只实现被测代码真正调用的成员：`empty()` 是 Obsidian 给 `Element` 打的方法，
 * 也一并提供。需要新能力时在这里补，不要改用 jsdom（会引入依赖）
 */

/** 事件对象：只带被测代码读过的字段 */
export interface IStubEvent {
  target: unknown;
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/** class 属性与 classList 是同一份数据（真实 DOM 语义） */
export class StubClassList {
  private items = new Set<string>();

  /** 由 `className` / `class` 属性整体覆盖 */
  reset(value: string): void {
    this.items = new Set(value.split(/\s+/).filter(Boolean));
  }

  add(...names: string[]): void {
    for (const name of names) if (name) this.items.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.items.delete(name);
  }

  contains(name: string): boolean {
    return this.items.has(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const want = force === undefined ? !this.items.has(name) : force;
    if (want) this.items.add(name);
    else this.items.delete(name);
    return want;
  }

  toString(): string {
    return [...this.items].join(' ');
  }
}

/** 内联样式：支持 `style.display = x` 直赋与 `style.setProperty()` 两种写法 */
export class StubStyle {
  /** 测试断言常用 */
  display = '';
  position = '';
  private readonly props = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.props.get(name) ?? '';
  }
}

/** 选择器匹配：只支持 `.cls`、`tag`、`[attr]`、`.cls[attr]` 这几类实际用到的写法 */
function matchesSelector(el: StubElement, selector: string): boolean {
  const tokens = selector.match(/[.#]?[\w-]+|\[[^\]]+\]/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('[')) {
      if (!el.hasAttribute(token.slice(1, -1).split('=')[0].trim())) return false;
    } else if (token.startsWith('.')) {
      if (!el.classList.contains(token.slice(1))) return false;
    } else if (el.tagName !== token.toUpperCase()) {
      return false;
    }
  }
  return true;
}

export class StubElement {
  readonly tagName: string;
  readonly isFragment: boolean;
  readonly childNodes: StubElement[] = [];
  readonly classList = new StubClassList();
  readonly style = new StubStyle();
  parentNode: StubElement | null = null;
  textContent = '';
  value = '';
  disabled = false;
  placeholder = '';

  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Array<(evt: IStubEvent) => void>>();

  constructor(tag: string, isFragment = false) {
    this.tagName = tag.toUpperCase();
    this.isFragment = isFragment;
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(value: string) {
    this.classList.reset(value);
  }

  get firstChild(): StubElement | null {
    return this.childNodes[0] ?? null;
  }

  appendChild(child: StubElement): StubElement {
    if (child.isFragment) {
      for (const grandChild of child.childNodes) {
        grandChild.parentNode = this;
        this.childNodes.push(grandChild);
      }
      child.childNodes.length = 0;
      return child;
    }
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child: StubElement): StubElement {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  /** Obsidian 给 Element 扩展的方法 */
  empty(): void {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === 'class') this.classList.reset(String(value));
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  addEventListener(type: string, listener: (evt: IStubEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (evt: IStubEvent) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }

  closest(selector: string): StubElement | null {
    let current: StubElement | null = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  focus(): void {}
  setSelectionRange(): void {}
  /** 布局层量文字用：返回 null 让它走「宽字符全宽」启发式，结果可复现 */
  getContext(): null {
    return null;
  }

  /** 触发本元素上注册的某类监听（不冒泡：委托场景由调用方传根元素） */
  dispatch(type: string, target?: StubElement): void {
    const event: IStubEvent = {
      target: target ?? this,
      preventDefault: () => {},
      stopPropagation: () => {},
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/** 深度遍历收集满足条件的元素（前序） */
export function findAll(
  root: StubElement,
  predicate: (el: StubElement) => boolean,
): StubElement[] {
  const out: StubElement[] = [];
  const walk = (el: StubElement): void => {
    if (predicate(el)) out.push(el);
    for (const child of el.childNodes) walk(child);
  };
  walk(root);
  return out;
}

/** 直接子节点里满足条件的元素 */
export function childrenOf(
  root: StubElement,
  predicate: (el: StubElement) => boolean,
): StubElement[] {
  return root.childNodes.filter(predicate);
}

/** 文本节点集合（用于断言展示文案） */
export function textsOf(els: StubElement[]): string[] {
  return els.map((el) => el.textContent);
}

/** 安装到全局，供被测模块在不感知替身的情况下调用 */
export function installDomStub(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = {
    createElement: (tag: string) => new StubElement(tag),
    createElementNS: (_ns: string, tag: string) => new StubElement(tag),
    createDocumentFragment: () => new StubElement('#fragment', true),
  };
  g.Element = StubElement;
  g.Node = StubElement;
  g.HTMLElement = StubElement;
  g.SVGElement = StubElement;
  g.getComputedStyle = () => ({ position: 'relative' });
}

/** 造一个容器元素，语义等同 `document.createElement('div')` */
export function makeContainer(): StubElement {
  return new StubElement('div');
}
