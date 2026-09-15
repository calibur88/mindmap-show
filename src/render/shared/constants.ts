/**
 * @module render/shared/constants
 * @description 两个画布视图共用的几何常量
 */

/**
 * 画布四周留白（像素）。
 * 节点层的坐标在此基础上整体偏移，连线层按同值平移，两者必须同源
 */
export const CANVAS_PADDING = 24;

/**
 * 主题强调色。四处用途同源：深度 0 节点的描边／左边框、`<=>` 跨边虚线、
 * 折叠徽标高亮、导出 SVG 的主题外样式表。
 * 取值与 styles.css 里 `--text-accent` 的回退值一致
 */
export const ACCENT_COLOR = '#7f9cf5';
