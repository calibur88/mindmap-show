/**
 * @module utils/dom
 * @description DOM 构造小工具，供 render/ 与 ui/ 共用，避免散落的 createElement 调用
 */

/**
 * 创建元素并设置属性与类名
 *
 * @param tag - 标签名
 * @param options - 类名、文本与属性
 * @returns 创建好的元素
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.cls) node.className = options.cls;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attr) {
    for (const [key, value] of Object.entries(options.attr)) {
      node.setAttribute(key, value);
    }
  }
  return node;
}

/**
 * 创建 SVG 元素，避免 createElement 在 SVG 命名空间下的兼容问题
 *
 * @param tag - SVG 标签名
 * @param attr - 属性表
 * @returns 创建好的 SVG 元素
 */
export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attr: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attr)) {
    node.setAttribute(key, String(value));
  }
  return node;
}
