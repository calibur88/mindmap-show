/**
 * @module host/types
 * @description MMS 宿主接口与域类型的唯一出口。纯类型文件，禁止放置任何运行时值
 */

// ---------------------------------------------------------------- Frontmatter

/**
 * 布局方向，一律以「父节点 → 子节点」的流动方向为准：
 * `TB` 上→下 / `BT` 下→上 / `LR` 左→右 / `RL` 右→左
 */
export type MmsLayout = 'TB' | 'BT' | 'LR' | 'RL';

/** 连线样式：`line` 直线 / `curve` 三次贝塞尔曲线 / `elbow` 直角折线 */
export type MmsLineStyle = 'line' | 'curve' | 'elbow';

/** `.mms` 文件头部允许出现的固定键 */
export interface MmsFrontmatter {
  mms_name?: string;
  mms_tags?: string[];
  mms_layout?: MmsLayout;
  mms_line?: MmsLineStyle;
  mms_desc?: string;
}

// ---------------------------------------------------------------------- 节点

/** heading 来自 `#`，child 来自 `--`，auto 为跳级自动补齐的空节点 */
export type NodeType = 'heading' | 'child' | 'auto';

/** 嵌入资源分流结果 */
export type EmbedKind = 'image' | 'mms' | 'file' | 'url';

/** 一条嵌入引用 */
export interface IEmbed {
  kind: EmbedKind;
  /** `![[]]` 内的原文或裸 URL */
  raw: string;
  /** 解析后的路径或 URL */
  target: string;
  lineNo: number;
}

/** 一条跨边引用（出边，`<=>` 建立的有向边） */
export interface ICrossRef {
  /** 目标节点 id；跨文件且尚未解析时等于目标的原始文本 */
  targetNodeId: string;
  /** 目标文件，缺省为当前文件 */
  targetFilePath: string;
  /** 语法原文，用于报错与右栏展示 */
  rawTarget: string;
  /** 备注文本（目标列表与备注之间两个以上空格或 Tab 分隔） */
  label: string;
  lineNo: number;
  /** 是否已解析到真实存在的节点 */
  resolved: boolean;
}

/** 一条节点引用（`::` 点对点定位，只做跳转，不建边、不画虚线、不产生入链/出链） */
export interface INodeRef {
  /** 目标节点 id；跨文件且尚未解析时等于目标的原始文本 */
  targetNodeId: string;
  /** 目标文件，缺省为当前文件 */
  targetFilePath: string;
  /** 语法原文，用于右栏「引用链」卡展示 */
  rawTarget: string;
  lineNo: number;
  /** 是否已解析到真实存在的节点 */
  resolved: boolean;
}

/** 思维导图节点 */
export interface IMmsNode {
  /** 唯一标识：`父id > 自身文本` */
  id: string;
  text: string;
  type: NodeType;
  depth: number;
  /** 该节点在源文件中的行号（1 起） */
  lineNo: number;
  /**
   * 正文（content）：节点标题下方的普通文本行。
   * 不含 `#` / `--` / `<=>` / `![[` / 裸 URL，**也不含 `** ` 开头的注释行**
   */
  content: string[];
  /**
   * 注释（annotation）：节点标题下方以 `** ` 开头（两个星号后至少一个空格）的文本行。
   * 表示"对正文的批注或补充说明"，右栏以斜体小字展示，画布默认不渲染
   */
  annotation: string[];
  childIds: string[];
  /** 同名合并后可能出现多个父节点 */
  parentIds: string[];
  crossRefs: ICrossRef[];
  /** `::` 节点引用（点对点定位，不建边），跨文件部分由索引构建器补全 */
  nodeRefs: INodeRef[];
  /** 引用了本节点的来源，跨文件部分由反链索引补全 */
  incomingRefs: IBacklink[];
  embeds: IEmbed[];
  sourceFilePath: string;
  /** true 表示为补齐层级而自动生成的空节点 */
  isAutoFix: boolean;
  /**
   * `!--` 指令绑定的扩展键值（默认绑定与 `<--` 目标绑定的落点）。
   * key 已归一化（trim → 连续空白折叠为 `-` → 小写）；渲染期沿祖先链就近继承，行为类除外
   */
  extensions?: Record<string, string>;
}

// ---------------------------------------------------------------------- 警告

export type WarningType =
  | 'missing-parent'
  | 'missing-target'
  | 'duplicate-merge'
  | 'no-root'
  | 'level-skip'
  | 'parse-error'
  | 'directive-target-missing'
  | 'directive-conflict'
  | 'directive-unknown-key';

export interface IWarning {
  type: WarningType;
  severity: 'info' | 'warning' | 'error';
  message: string;
  filePath: string;
  lineNo?: number;
  autoFixed: boolean;
}

// ---------------------------------------------------------------------- 文档

/** 一条成功绑定的指令记录：UI 写回文档（如折叠徽标删除 / 改写指令行）的定位依据 */
export interface IDirectiveBinding {
  /** 归一化后的 key */
  key: string;
  /** 指令行号（1 起） */
  lineNo: number;
  /** 绑定到的节点 id；null = 孤儿指令（挂文档级） */
  nodeId: string | null;
}

/** 一个 `.mms` 文件的解析结果 */
export interface IParsedDoc {
  filePath: string;
  /** mms_name ?? 文件名去扩展名 */
  displayName: string;
  layout: MmsLayout;
  /** 连线样式，缺省 `line` */
  lineStyle: MmsLineStyle;
  tags: string[];
  desc: string | null;
  nodes: IMmsNode[];
  nodeMap: Map<string, IMmsNode>;
  rootId: string | null;
  warnings: IWarning[];
  /** 文档级 `!--` 指令（首个节点声明之前的孤儿指令的落点） */
  extensions?: Record<string, string>;
  /** 成功绑定的指令行索引（按文档序），供 UI 写回文档时定位指令行 */
  directiveBindings?: ReadonlyArray<IDirectiveBinding>;
  /** 本文件指向外部文件的 `<=>` 出链，由索引构建器聚合（不含同文件引用） */
  outgoingRefs: IOutlink[];
}

// ---------------------------------------------------------------------- 反链

/** 一条入链记录：其他文件的 `<=>` 指向本节点 */
export interface IBacklink {
  /** 来源文件路径 */
  sourcePath: string;
  /** 来源行号（1 起） */
  sourceLine: number;
  /** 来源节点 id（含 `<=>` 的节点），供右栏「跳节点」直接选中 */
  sourceNodeId: string;
}

/** 一条出链：本文件 `<=>` 指向外部文件的节点，由索引构建器聚合 */
export interface IOutlink {
  /** 目标文件路径（未解析时为语法原文） */
  targetPath: string;
  /** 目标节点在目标文件中的行号（未解析时为 0） */
  targetLine: number;
  /** 出链所在的源节点 id */
  sourceNodeId: string;
  /** 出链所在的源节点文本 */
  sourceText: string;
  /** `<=>` 在本文件中的行号（1 起），供右栏「跳源码」定位 */
  sourceLineNo: number;
  /** 目标节点 id，用于跳转定位；未解析时为 null */
  targetNodeId: string | null;
  /** 是否已解析到真实存在的节点（false 时右栏显示灰色断链） */
  resolved: boolean;
}

// ---------------------------------------------------------------------- 布局

export interface ILayoutOptions {
  direction: MmsLayout;
  /** 同层相邻节点的间距 */
  nodeGap: number;
  /** 层与层之间的间距 */
  levelGap: number;
}

export interface ILayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface ILayoutEdge {
  from: string;
  to: string;
  kind: 'tree' | 'cross';
  label?: string;
}

export interface ILayoutResult {
  nodes: Map<string, ILayoutNode>;
  edges: ILayoutEdge[];
  width: number;
  height: number;
}

// ------------------------------------------------------------------ 宿主接口

/** 文件系统读写能力 */
export interface IVaultHost {
  listMmsFiles(): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
}

/** 打开与跳转能力 */
export interface IOpener {
  /** 打开脑图。已打开同文件的脑图标签页时复用，不重复新建 */
  openMindMap(filePath: string): Promise<void>;
  /** 打开源码并定位到指定行（.mms 以 source 模式的 markdown 视图打开）。
   *  已打开同文件源码时复用该标签页 */
  openSource(filePath: string, lineNo?: number): Promise<void>;
}

/** 刷新状态：synced 正常 / error 上次刷新失败 */
export type UiStatus = 'synced' | 'error';

/** UI 反馈能力 */
export interface IUiHost {
  setStatus(state: UiStatus, detail?: string): void;
  /** 注册状态变更监听，由左栏状态卡与画布 footer 消费 */
  onStatus(listener: (state: UiStatus, detail?: string) => void): void;
  /** 注销监听。状态卡等长生命周期控件在销毁时必须调用，否则监听器泄漏 */
  offStatus(listener: (state: UiStatus, detail?: string) => void): void;
  /** 最近一次 setStatus 的状态，用于控件重建时回放 */
  getLastState(): UiStatus;
  /** 最近一次 setStatus 的 detail 文本，用于 footer 与左栏底部状态卡显示 */
  getLastDetail(): string;
}
