/**
 * @module render/svg-export
 * @description 画布 → 标准 SVG 文件：基于全景渲染器生成可独立打开的矢量图
 *
 * 输出 SVG 必须脱离 Obsidian 主题也能正常显示。CSS 类（`.mms-svg-node rect`
 * 等）依赖 Obsidian 主题变量，导出时把这些规则写死成内联 `<style>`，并附上
 * xmlns / xml 声明，保证浏览器、inkscape、SVG 编辑器都能直接打开
 */

import type { IParsedDoc } from '../host/types';
import { renderPanorama, type PanoramaRenderOptions } from './svg';

/**
 * 导出用内联样式表。
 * 颜色写死不引用 CSS 变量；尺寸用 px 与 Obsidian 默认主题视觉一致。
 * 选择器与 styles.css 严格保持一致，新增类名时同步更新
 */
const EXPORT_STYLE = `
  .mms-svg-node rect {
    fill: #ffffff;
    stroke: #d4d4cc;
    stroke-width: 1;
  }
  .mms-svg-node.mms-depth-0 rect { stroke: #7f9cf5; }
  .mms-svg-node.mms-depth-1 rect { stroke: #5dcaa5; }
  .mms-svg-node.mms-depth-2 rect { stroke: #ef9f27; }
  .mms-svg-node.mms-depth-3 rect { stroke: #ed93b1; }
  .mms-svg-node.mms-depth-4 rect { stroke: #85b7eb; }
  .mms-svg-node.mms-depth-5 rect,
  .mms-svg-node.mms-depth-6 rect { stroke: #b4b2a9; }
  .mms-svg-node.is-locked rect { stroke-dasharray: 4 3; }

  .mms-svg-text {
    fill: #2f2f2b;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mms-svg-sub {
    fill: #6e6e6a;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mms-svg-empty {
    fill: #6e6e6a;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .mms-svg-fold circle {
    fill: #ffffff;
    stroke: #d4d4cc;
    stroke-width: 1;
  }
  .mms-svg-fold-text {
    fill: #6e6e6a;
    font-size: 10px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .mms-svg-fold.is-collapsed circle { stroke: #7f9cf5; }
  .mms-svg-fold.is-collapsed .mms-svg-fold-text { fill: #7f9cf5; }

  .mms-svg-debug {
    fill: #6e6e6a;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9px;
  }
`;

/** 导出参数：复用全景视图的渲染参数，但不要交互回调 */
export type ExportSvgOptions = Omit<PanoramaRenderOptions, 'onNodeClick' | 'onToggleCollapse'>;

/**
 * 把 doc 渲染成可独立打开的标准 SVG 字符串。
 * 走全景渲染器（导出图本来就是矢量全量图），不接交互回调；
 * 返回字符串含 XML 声明，可直接写入 .svg 文件
 */
export function buildExportSvg(doc: IParsedDoc, options: ExportSvgOptions): string {
  const fragment = renderPanorama(doc, {
    lineWidth: options.lineWidth,
    crossLineWidth: options.crossLineWidth,
    lineStyle: options.lineStyle,
    nodeGap: options.nodeGap,
    levelGap: options.levelGap,
  });

  // 加 xmlns：renderPanorama 创建的 svg 没有 xmlns 属性，序列化时浏览器
  // 会默认 HTML 命名空间，导致独立打开失效（元素不识别）。补到根
  fragment.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  fragment.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // 内联样式：写到 defs 里；样式选择器与 styles.css 同步
  const style = fragment.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = EXPORT_STYLE;
  const defs = fragment.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.appendChild(style);
  fragment.insertBefore(defs, fragment.firstChild);

  const body = new XMLSerializer().serializeToString(fragment);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}
