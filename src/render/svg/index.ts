/**
 * @module render/svg
 * @description 全景视图渲染：doc → SVG。纯矢量一次性静态输出，可无限缩放
 */

import type { ILayoutResult, IParsedDoc } from '../../host/types';
import { layoutTree } from '../../core/layout';
import { svgEl } from '../../utils/dom';
import { buildEdgesSvg, type ILineRenderOptions } from '../shared/edges';

export interface PanoramaRenderOptions extends ILineRenderOptions {
  /** 子节点之间间距（像素） */
  nodeGap: number;
  /** 层级之间间距（像素），同时作为曲线模式的安全推力上限 `H0` */
  levelGap: number;
  onNodeClick?: (nodeId: string) => void;
}

const PADDING = 24;

export function renderPanorama(doc: IParsedDoc, options: PanoramaRenderOptions): SVGSVGElement {
  const layout: ILayoutResult = layoutTree(doc.rootId, doc.nodeMap, {
    direction: doc.layout,
    nodeGap: options.nodeGap,
    levelGap: options.levelGap,
  });
  const width = Math.max(layout.width + PADDING * 2, 200);
  const height = Math.max(layout.height + PADDING * 2, 120);

  const svg = svgEl('svg', {
    class: 'mms-svg-canvas',
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });

  if (layout.nodes.size === 0) {
    const text = svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', class: 'mms-svg-empty' });
    text.textContent = '空脑图：文件里没有任何 # 或 -- 节点';
    svg.appendChild(text);
    return svg;
  }

  const edges = buildEdgesSvg(layout, {
    direction: doc.layout,
    lineStyle: options.lineStyle,
    gap: options.levelGap,
    width,
    height,
    treeLineWidth: options.lineWidth,
    crossLineWidth: options.crossLineWidth,
  });
  edges.setAttribute('x', String(PADDING));
  edges.setAttribute('y', String(PADDING));
  svg.appendChild(edges);

  const group = svgEl('g', { transform: `translate(${PADDING} ${PADDING})` });
  for (const [id, box] of layout.nodes) {
    const node = doc.nodeMap.get(id);
    if (!node) continue;

    const g = svgEl('g', {
      class: `mms-svg-node mms-depth-${Math.min(node.depth, 6)}`,
      'data-node-id': node.id,
    });
    g.appendChild(svgEl('rect', { x: box.x, y: box.y, width: box.width, height: box.height, rx: 6 }));

    const cx = box.x + box.width / 2;
    const hasSub = node.content.length > 0;
    // label 与 sub 都把 y 当作文字中心（dominant-baseline: central），避免 baseline 渲染的重叠感
    const labelY = hasSub ? box.y + box.height * 0.4 : box.y + box.height / 2;
    const subY = box.y + box.height * 0.78;

    const label = svgEl('text', {
      x: cx,
      y: labelY,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      class: 'mms-svg-text',
    });
    label.textContent = node.isAutoFix ? '（自动补齐）' : node.text;
    g.appendChild(label);

    if (hasSub) {
      const sub = svgEl('text', {
        x: cx,
        y: subY,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        class: 'mms-svg-sub',
      });
      sub.textContent = node.content[0].slice(0, 32);
      g.appendChild(sub);
    }

    const title = svgEl('title');
    title.textContent = node.text;
    g.appendChild(title);

    if (options.onNodeClick) {
      g.addEventListener('click', () => options.onNodeClick?.(id));
    }
    group.appendChild(g);
  }
  svg.appendChild(group);

  return svg;
}
