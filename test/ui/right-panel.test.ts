/**
 * @module test/ui/right-panel.test
 * @description 右栏信息面板的单测：八张卡恒定渲染、引用链文案前缀、断链灰显、空态。
 * DOM 用 test/helpers/dom-stub 的最小替身，不引 jsdom
 */

import { describe, expect, it } from 'vitest';
import {
  childrenOf,
  findAll,
  installDomStub,
  makeContainer,
  textsOf,
  type StubElement,
} from '../helpers/dom-stub';
import { RightPanel } from '../../src/ui/right-panel';
import type { IRightPanelActions, IRightPanelData } from '../../src/ui/right-panel';
import { parseMms } from '../../src/core/parser/index';

installDomStub();

const CARD_TITLES = [
  '来源文件',
  '当前选中节点',
  '标签',
  '引用链',
  '入链',
  '出链（文件级）',
  '节点注释',
  '嵌入资源',
];

const noopActions: IRightPanelActions = { openSource: () => {}, openAndSelect: () => {} };

function setup(): { panel: RightPanel; container: StubElement } {
  const container = makeContainer();
  const panel = new RightPanel(container as unknown as HTMLElement, noopActions);
  return { panel, container };
}

const cardTitleOf = (card: StubElement): string =>
  findAll(card, (el) => el.classList.contains('mms-info-card-title'))[0]?.textContent ?? '';

const cardsOf = (container: StubElement): StubElement[] =>
  childrenOf(container, (el) => el.classList.contains('mms-info-card'));

/** 卡片内一行的值文本（不带跳转按钮的也适用） */
const valuesOf = (card: StubElement): string[] =>
  textsOf(findAll(card, (el) => el.classList.contains('mms-info-val')));

const emptyBase: IRightPanelData = {
  doc: parseMms('# R', 'p.mms'),
  nodeId: null,
  inlinks: [],
  outlinks: [],
};

describe('八张卡恒定渲染', () => {
  it('未选中节点时依然渲染全部 8 张卡，标题与顺序固定', () => {
    const { panel, container } = setup();
    panel.render(emptyBase);

    const cards = cardsOf(container);
    expect(cards.map(cardTitleOf)).toEqual(CARD_TITLES);
  });

  it('卡片缺内容时用占位文案，而不是不渲染卡片', () => {
    const { panel, container } = setup();
    panel.render(emptyBase);

    const hints = textsOf(findAll(container, (el) => el.classList.contains('mms-empty-hint')));
    expect(hints).toContain('未选中节点');
    expect(hints).toContain('（无）');
    expect(hints).toContain('暂无节点引用此节点');
    expect(hints).toContain('当前文件未引用外部节点');
    expect(cardsOf(container)).toHaveLength(CARD_TITLES.length);
  });
});

describe('引用链文案', () => {
  const doc = parseMms(
    ['# R', '## A', '<=> B', '<=> 缺失节点', ':: B', '## B'].join('\n'),
    'p.mms',
  );

  it('已解析跨边以 → 前缀并带备注，未解析以 ? 前缀', () => {
    const { panel, container } = setup();
    panel.render({ ...emptyBase, doc, nodeId: 'R>A' });

    const refCard = cardsOf(container)[3];
    const values = valuesOf(refCard);

    expect(values).toContain('→ B');
    expect(values).toContain('? 缺失节点');
  });

  it('节点引用以 :: 前缀展示，与跨边合并进同一张卡', () => {
    const { panel, container } = setup();
    panel.render({ ...emptyBase, doc, nodeId: 'R>A' });

    const refCard = cardsOf(container)[3];
    expect(valuesOf(refCard)).toContain(':: B');
  });
});

describe('断链灰显', () => {
  const doc = parseMms(['# R', '## A', '<=> B', '<=> 缺失节点', '## B'].join('\n'), 'p.mms');

  it('断链行加 is-broken 且不产出跳转按钮', () => {
    const { panel, container } = setup();
    panel.render({ ...emptyBase, doc, nodeId: 'R>A' });

    const refRows = findAll(cardsOf(container)[3], (el) =>
      el.classList.contains('mms-info-row'),
    );
    const brokenRow = refRows.find((row) =>
      findAll(row, (el) => el.classList.contains('mms-info-val')).some((el) =>
        el.classList.contains('is-broken'),
      ),
    );

    expect(brokenRow).toBeDefined();
    expect(valuesOf(brokenRow!)).toEqual(['? 缺失节点']);
    expect(findAll(brokenRow!, (el) => el.classList.contains('mms-jump-btn'))).toHaveLength(0);
  });

  it('已解析行有跳转按钮', () => {
    const { panel, container } = setup();
    panel.render({ ...emptyBase, doc, nodeId: 'R>A' });

    const refRows = findAll(cardsOf(container)[3], (el) => el.classList.contains('mms-info-row'));
    const okRow = refRows.find((row) => valuesOf(row).includes('→ B'));

    expect(findAll(okRow!, (el) => el.classList.contains('mms-jump-btn'))).toHaveLength(1);
  });
});

describe('入链与出链', () => {
  it('同文件来源显示为「本文件」，出链断链标注（断链）', () => {
    const { panel, container } = setup();
    const doc = parseMms('# R', 'p.mms');
    panel.render({
      doc,
      nodeId: null,
      inlinks: [
        { sourcePath: 'p.mms', sourceLine: 3, sourceNodeId: 'R>A' },
        { sourcePath: 'other.mms', sourceLine: 5, sourceNodeId: 'X' },
      ],
      outlinks: [
        {
          targetPath: 'other.mms',
          targetLine: 3,
          sourceNodeId: 'R>A',
          sourceText: 'A',
          sourceLineNo: 7,
          targetNodeId: 'X',
          resolved: true,
        },
        {
          targetPath: 'gone.mms',
          targetLine: 0,
          sourceNodeId: 'R>A',
          sourceText: 'A',
          sourceLineNo: 9,
          targetNodeId: null,
          resolved: false,
        },
      ],
    });

    const cards = cardsOf(container);
    expect(valuesOf(cards[4])).toEqual(['本文件 → 第 3 行', 'other.mms → 第 5 行']);
    expect(valuesOf(cards[5])).toEqual(['other.mms → 第 3 行', 'gone.mms（断链）']);
  });
});

describe('renderEmpty', () => {
  it('未传 hint 时用默认文案', () => {
    const { panel, container } = setup();
    panel.render(emptyBase);
    panel.renderEmpty();

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0].className).toBe('mms-empty-hint');
    expect(container.childNodes[0].textContent).toBe('未打开 .mms 文件');
  });

  it('传 hint 时用降级提示，并清掉上一轮内容', () => {
    const { panel, container } = setup();
    panel.render(emptyBase);
    panel.renderEmpty('文件已移动');

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0].textContent).toBe('文件已移动');
  });
});
