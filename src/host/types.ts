/**
 * @module host/types
 * @description MMS 宿主接口与域类型的唯一出口。纯类型文件，禁止放置任何运行时值
 */

// ---------------------------------------------------------------- Frontmatter

/** 布局方向：LR 左→右 / TB 上→下 / RL 右→左 */
export type MmsLayout = 'LR' | 'TB' | 'RL';

/** `.mms` 文件头部允许出现的四个固定键 */
export interface MmsFrontmatter {
  mms_name?: string;
  mms_tags?: string[];
  mms_layout?: MmsLayout;
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

/** 一条跨边引用（出边） */
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
  /** 引用了本节点的来源，跨文件部分由反链索引补全 */
  incomingRefs: IBacklink[];
  embeds: IEmbed[];
  sourceFilePath: string;
  /** true 表示为补齐层级而自动生成的空节点 */
  isAutoFix: boolean;
}

// ---------------------------------------------------------------------- 警告

export type WarningType =
  | 'missing-parent'
  | 'missing-target'
  | 'duplicate-merge'
  | 'no-root'
  | 'level-skip'
  | 'parse-error';

export interface IWarning {
  type: WarningType;
  severity: 'info' | 'warning' | 'error';
  message: string;
  filePath: string;
  lineNo?: number;
  autoFixed: boolean;
}

// ---------------------------------------------------------------------- 文档

/** 一个 `.mms` 文件的解析结果 */
export interface IParsedDoc {
  filePath: string;
  /** mms_name ?? 文件名去扩展名 */
  displayName: string;
  layout: MmsLayout;
  tags: string[];
  desc: string | null;
  nodes: IMmsNode[];
  nodeMap: Map<string, IMmsNode>;
  rootId: string | null;
  warnings: IWarning[];
}

// ---------------------------------------------------------------------- 反链

/** 一条反链记录 */
export interface IBacklink {
  sourcePath: string;
  sourceLine: number;
  targetNode: string;
}

export interface BacklinkIndex {
  get(key: string): IBacklink[] | undefined;
  getAll(): Map<string, IBacklink[]>;
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

/** 元数据与索引查询能力 */
export interface IMetaHost {
  setBacklinkIndex(index: BacklinkIndex): void;
  getBacklinks(nodeId: string, filePath: string): IBacklink[];
}

/** 打开与跳转能力 */
export interface IOpener {
  /** 在新标签页打开脑图 */
  openMindMap(filePath: string): Promise<void>;
  /** 打开源码并定位到指定行（.mms 以 source 模式的 markdown 视图打开） */
  openSource(filePath: string, lineNo?: number): Promise<void>;
}

/** UI 反馈能力 */
export interface IUiHost {
  setStatus(state: 'synced' | 'error', detail?: string): void;
  /** 注册状态变更监听，由左栏状态卡消费 */
  onStatus(listener: (state: 'synced' | 'error', detail?: string) => void): void;
  /** 最近一次 setStatus 的 detail 文本，用于 footer 与左栏底部状态卡显示 */
  getLastDetail(): string;
}
