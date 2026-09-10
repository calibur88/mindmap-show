# API 索引

> Mind Map Show (MMS) - Obsidian 思维导图插件。文档版本：v1.4（2026-09-10）

本文档列出插件版本1.7.0用到的Obsidian官方API与插件自身API。仅记录真实用到的，不写"未来可能用到的"。

---

## 1. Obsidian 官方 API

### 1.1 插件生命周期

| API | 用途 | 备注 |
|---|---|---|
| `Plugin.loadData()` / `saveData()` | 加载 / 保存设置 | 异步，需要 await |
| `Plugin.addRibbonIcon(name, tooltip, cb)` | 加左侧 ribbon icon | Obsidian 1.0+ |
| `Plugin.addCommand({id, name, callback})` | 命令面板命令 | callback 同步；异步用 `() => void promise()` |
| `Plugin.addSettingTab(tab)` | 设置面板 | 继承 `PluginSettingTab` |

### 1.2 视图与 leaf

| API | 用途 | 备注 |
|---|---|---|
| `Plugin.registerView(type, factory)` | 注册视图类型 | factory 同步返回 view 实例 |
| `Plugin.registerExtensions(exts, type)` | 接管文件扩展名 | 会替换用户默认视图 |
| `Workspace.getLeavesOfType(type)` | 查询指定类型的所有 leaf | 用于 revealLeaf |
| `Workspace.getLeftLeaf(false)` | 获取 / 创建左栏 leaf | false=不新建 split |
| `Workspace.revealLeaf(leaf)` | 聚焦一个 leaf | 已存在则 reveal |
| `WorkspaceLeaf.setViewState({type, state, active})` | 切换 leaf 的视图类型 | 异步；state 字段语义因 view type 而异 |
| `WorkspaceLeaf.openFile(file, opts)` | 在 leaf 里打开文件 | `opts.eState` 仅 Markdown 视图生效 |

### 1.3 文件系统

| API | 用途 | 备注 |
|---|---|---|
| `Vault.getMarkdownFiles()` / `getFiles()` | 列文件 | 用 `getFiles().filter(f => f.extension === 'mms')` |
| `Vault.read(file)` / `cachedRead(file)` | 读文件 | cachedRead 走缓存更便宜 |
| `Vault.getFileByPath(path)` | 路径查 TFile | 找不到返回 null |
| `Vault.adapter` | 文件系统适配器 | 桌面 = `FileSystemAdapter`，移动 = 远程 |
| `FileSystemAdapter.getFullPath(path)` | 取绝对路径 | **必须 `instanceof FileSystemAdapter` 才能调** |
| `TFile.extension` | 取扩展名（不带点） | |
| `TFile.basename` | 去后缀的文件名 | |

### 1.4 元数据与缓存

| API | 用途 | 备注 |
|---|---|---|
| `MetadataCache.getFileCache(file)` | 文件缓存（含 frontmatter、链接等） | 解析阶段可省 IO |
| `FrontmatterCache` 字段：`<key>: string \| string[] \| ...` | frontmatter 类型不固定 | 运行时用 zod / 手写守卫 |

### 1.5 UI 与通知

| API | 用途 | 备注 |
|---|---|---|
| `Notice(msg)` | 弹出顶栏通知 | 10s 自动消失 |
| `setIcon(el, name)` | 在元素里画 lucide 图标 | 用于 ribbon 命令图标 |
| `Platform.isDesktopApp` / `isMobileApp` | 平台判断 | 仅桌面能开系统程序 |
| `Workspace.on('file-open'\|'active-leaf-change'\|'layout-change')` | 监听事件 | 需在 onload 内注册，注意 off |

### 1.6 设置面板

| API | 用途 | 备注 |
|---|---|---|
| `PluginSettingTab(app, plugin)` | 设置页基类 | 重写 `display()` |
| `Setting(container)` | 一行设置 | addText / addToggle / addSlider / addDropdown |
| `setPlaceholder / setValue / onChange` | 输入控件 | TextComponent 有 `inputEl.type = 'text'` |

---

## 2. 未文档化 / 运行时存在的 API

`.d.ts` 里**不存在**但运行时确实可用，放进 `src/host/obsidian/obsidian-internal.d.ts` 增强类型 + 调用点用 `typeof` 守卫。

### 2.1 `app.viewRegistry`

```ts
declare module 'obsidian' {
  interface App {
    viewRegistry: {
      /** 给定扩展名，返回注册该扩展名的视图类型。找不到返回 undefined */
      getTypeByExtension(ext: string): string | undefined;
      /** 已注册视图的扩展名 -> 视图类型查找表 */
      typeByExtension: Record<string, string>;
      /** 已注册的视图类型 -> 工厂 */
      typeByView: Record<string, ViewCreator>;
    };
  }
}
```

来源：Obsidian 论坛 #72349（核心开发者 ush 答复）。

**使用模式**：判断某扩展名是否有内置视图，非内置就降级到系统程序。

```ts
const hasView = typeof (app as any).viewRegistry !== 'undefined'
  ? !!(app as any).viewRegistry.typeByExtension[ext]
  : false;
```

### 2.2 `app.openWithDefaultApp(path)`

```ts
declare module 'obsidian' {
  interface App {
    openWithDefaultApp(path: string): Promise<void>;
  }
}
```

用系统默认程序打开绝对路径（`FileSystemAdapter` 桌面 + 移动均可用）。

### 2.3 `app.showInFolder(path)`

```ts
declare module 'obsidian' {
  interface App {
    showInFolder(path: string): void;
  }
}
```

等价于 `electron.shell.showItemInFolder`，但官方 API（运行时存在，`.d.ts` 未声明）。

### 2.4 `app.secretStorage`

```ts
declare module 'obsidian' {
  interface App {
    secretStorage: {
      getSecret(key: string): Promise<string | null>;
      setSecret(key: string, value: string): Promise<void>;
    };
  }
}
```

需要存敏感数据时用；本插件未使用。

---

## 3. 插件自身 API

### 3.1 类型层（`src/host/types.ts` 唯一出口）

| 类型 | 用途 |
|---|---|
| `MmsLayout = 'TB' \| 'BT' \| 'LR' \| 'RL'` | 布局方向，一律以父→子的流向为准 |
| `MmsLineStyle = 'line' \| 'curve' \| 'elbow'` | 连线样式：直线 / 三次贝塞尔曲线 / 直角折线 |
| `MmsFrontmatter` | frontmatter 五个固定键：mms_name / mms_tags / mms_layout / mms_line / mms_desc |
| `NodeType = 'heading' \| 'child' \| 'auto'` | 节点来源：标题行 / -- 行 / 自动补齐 |
| `EmbedKind = 'image' \| 'mms' \| 'file' \| 'url'` | 嵌入分流结果 |
| `IEmbed` | 嵌入条目 |
| `ICrossRef` | 跨边引用（`<=>` 出边） |
| `INodeRef` | 节点引用（`::` 点对点定位，不建边） |
| `IMmsNode` | 节点：id / text / type / depth / lineNo / **content** / **annotation** / childIds / parentIds / crossRefs / nodeRefs / incomingRefs / embeds / sourceFilePath / isAutoFix / **extensions**（`!--`指令结果，可选） |
| `IWarning` | 解析警告（`type` 含指令类：`directive-target-missing`／`directive-conflict`／`directive-unknown-key`，均 warning） |
| `IParsedDoc` | 一个 .mms 文件的解析结果（含 `layout`、`lineStyle`、`outgoingRefs`、`extensions`——孤儿指令挂文档级、`directiveBindings`——成功绑定指令的行索引（`{key, lineNo, nodeId|null}`，供 UI 写回文档定位指令行），均可选） |
| `IBacklink` | 入链条目（`<=>` 指向本节点的来源，含本文件；右栏同文件来源显示为「本文件」，sourcePath / sourceLine / sourceNodeId） |
| `IOutlink` | 出链条目（本文件 `<=>` 指向外部节点，文件级聚合；含 sourceLineNo 供跳源码定位） |

### 3.2 宿主接口（注入，不直接 import obsidian）

| 接口 | 实现位置 | 能力 |
|---|---|---|
| `IVaultHost` | host/obsidian/vault.ts | listMmsFiles / readFile |
| `IOpener` | host/obsidian/opener.ts | openMindMap / openSource（同文件复用标签页，openSource 显式 setCursor 定位行号） |
| `IUiHost` | host/obsidian/ui-host.ts | setStatus / onStatus / offStatus / getLastState / getLastDetail |

### 3.3 渲染层导出

| 函数 | 用途 | 返回 |
|---|---|---|
| `renderExplore(doc, opts)` | 探索视图（`opts.onNodeClick` 选中、`opts.onToggleCollapse` 折叠徽标写回；事件委托：画布单一 click listener ＋ `closest('[data-node-id]')` 反查，`locked` 节点拦截不选中） | `DocumentFragment` |
| `renderPanorama(doc, opts)` | 全景视图（渲染内容静态全量；`opts.onNodeClick` 选中、`opts.onToggleCollapse` 折叠徽标写回、`locked` 拦截——SVG 图元是一等 DOM，事件委托同探索视图） | `SVGSVGElement` |
| `buildExportSvg(doc, options)` | SVG导出（`render/svg-export.ts`）：复用全景渲染器生成矢量全量图，内联`<style>`＋`xmlns`声明，返回含XML声明的标准SVG字符串，可直接写入`.svg`文件 | `string` |
| `layoutTree(rootId, nodeMap, opts)` | 布局算法，`opts.direction` 支持 TB/BT/LR/RL | `ILayoutResult {nodes, edges, width, height}` |
| `buildEdgePath(from, to, geo)` | 单条连线路径，`geo` 为 `{direction, lineStyle, gap}` | `string`（`M...L...` 直线或折线、`M...C...` 曲线） |
| `buildEdgesSvg(layout, options)` | 连线层 SVG | `SVGSVGElement` |

`buildEdgesSvg` 的 `options` 为 `IBuildEdgesOptions`：

```ts
interface IBuildEdgesOptions {
  direction: MmsLayout;      // TB / BT / LR / RL，决定锚点取哪条边
  lineStyle: MmsLineStyle;   // line 直线 / curve 贝塞尔 / elbow 折线
  gap: number;               // 预设间距 H0，曲线安全推力上限
  width: number;
  height: number;
  treeLineWidth: number;
  crossLineWidth: number;
}
```

曲线模式的推力规则实现在 `src/render/shared/edges.ts:buildEdgePath`：

| 规则 | 公式 |
|---|---|
| 安全推力 | `h = max(5, min(H₀, \|Δspread\| × 0.45))` |
| 正对直连补偿 | `Δspread = 0` → `h = max(h, 25)` |
| 极限陡坡增压 | `\|Δflow\| > 3\|Δspread\|` 且 `Δspread ≠ 0` → `h = max(h, \|Δflow\| × 0.18)` |

其中垂直布局（`TB`/`BT`）取 `Δspread = x₃ - x₀`、`Δflow = y₃ - y₀`；水平布局（`LR`/`RL`）取 `Δspread = y₃ - y₀`、`Δflow = x₃ - x₀`。

`elbow` 不需要推力：垂直布局走「竖 → 横 → 竖」，拐点纵坐标为 `(y₀ + y₃) / 2`；水平布局走「横 → 竖 → 横」，拐点横坐标为 `(x₀ + x₃) / 2`。

### 3.4 控件类

| 类 | 用途 |
|---|---|
| `LeftPanel(container, opener, uiHost, onRefresh, onSelectTag, openDetailPanel, getCollapsedFolders, persistCollapsedFolders)` | 左 sidebar 全部 UI：标签栏 / 搜索栏 / 文件树（折叠状态经 `getCollapsedFolders`／`persistCollapsedFolders` 读写 `settings.collapsedFolders`，箭头`▸`/`▾`指示，局部更新不重绘整树）/ 调试信息 / 状态卡；`destroy()` 注销状态卡监听并移除 DOM |
| `RightPanel(container, actions)` | 右栏节点详情：来源文件 / 当前节点 / 标签 / 引用链（选中节点的`<=>`跨边＋`::`定位合并展示，断链灰显）/ 入链（`<=>`指向该节点的来源，同文件显示为「本文件」）/ 出链（文件级，同文件引用不进此卡）/ 节点注释 / 嵌入资源，`actions` 提供 `openSource` 与 `openAndSelect` 跳转；`renderEmpty(hint?)` 支持降级提示。三卡条目统一交互：单击高亮（互斥、再点取消、重渲染自动清除），「跳转」按钮两段式——未高亮跳节点（入链跳来源节点）、高亮后跳源码行（出链跳本文件`<=>`行） |
| `StatusCard(container, uiHost, onRefresh, openDetailPanel, flow)` | 左栏底部状态卡（手动刷新／打开详情／导出图片三个按钮；点「导出图片」展开内嵌保存栏——输入框＋确认＋取消＋行内错误，状态机`idle／saving／error`＋`confirming`防抖；`flow`为`ExportFlow`两步回调：`requestExport(): {defaultPath, svg}`错误throw、`confirmSave(path, svg): Promise<void>`失败reject）；`destroy()` 注销 `onStatus` 监听 |
| `CanvasViewport` | 画布视口（鼠标 / 触控 + 缩放）；`centerOnElement(el)` 平移视口使节点居中（缩放不变，搜索定位用） |

左栏文件搜索的行为契约（`LeftPanel` 内部状态 `keyword`，空串表示不过滤）：

| 操作 | 触发条件 | 响应 |
|---|---|---|
| 执行搜索 | 输入框非空 + 点「搜索」或回车 | 在当前标签分组内按文件名（忽略大小写）过滤，临时忽略折叠状态（等效全部展开，不改写`collapsedFolders`持久化偏好） |
| 空输入搜索 | 输入框为空 | 忽略本次操作，不刷新、不报错 |
| 清空（有关键词） | `keyword` 非空 + 点「清空」或原生 × 按钮 | 清空输入框，撤销过滤，回退到当前标签分组的默认视图 |
| 清空（无关键词） | `keyword` 为空 + 点「清空」或原生 × 按钮 | 只清输入框，不触发列表刷新 |
| 切换标签分组 | 点任意标签 chip | 同步清空搜索框与关键词，再进入新分组 |

清空**不等于**恢复全局完整列表，只是撤销关键词过滤，标签分组的选择保持不变。

### 3.5 控制器

```ts
class MmsIndex {
  constructor(vaultHost, uiHost);
  refresh(): Promise<void>;                        // 全量扫描：解析 → 跨文件引用/节点引用 → 出链聚合
  onUpdate(listener: () => void): void;
  offUpdate(listener: () => void): void;
  getDoc(filePath: string): IParsedDoc | undefined;
  getFileSummaries(): IFileSummary[];              // 左栏文件树用
  getAllWarnings(): IWarning[];                    // 聚合全工程警告，按 severity/文件/行号排序
  getTagStats(): { name: string; count: number }[];
}
```

并发守卫：连续 `refresh()` 复用同一个 Promise，避免双扫。

### 3.6 插件主体（`src/main.ts`）

```ts
class MmsPlugin extends Plugin {
  settings: MmsSettings;
  updateSettings(patch: Partial<MmsSettings>): void;      // 内存合并 → 防抖落盘与广播
  updateSettingsSilently(patch: Partial<MmsSettings>): void; // 内存合并＋即时落盘，不广播、不触发重扫
  onSettingsChange(fn: () => void): () => void;           // 订阅设置变更，返回注销函数
  openDetailPanel(): Promise<void>;                       // 唤起 / 复用右侧详情面板
}
```

SVG导出（`src/main.ts`，注入`IMmsSideViewDeps.exportFlow`）：

```ts
interface ExportFlow {
  requestExport(): { defaultPath: string; svg: string };   // 取当前 .mms 生成 SVG；错误 throw
  confirmSave(path: string, svg: string): Promise<void>;   // normalize→补 .svg→逐层createFolder→覆盖Modal→vault.create/modify；失败 reject
}
```

`requestExport` 用 `resolveExportTarget()` 三级探测当前文件（最近leaf的`FileView.file`→`getActiveFile()`→`selection`兜底），不依赖视图实例。

设置变更走 400ms 防抖：窗口结束后先 `saveData` 落盘，再广播给各视图按新值重绘，最后触发 `index.refresh()` 整库重扫。
`updateSettingsSilently` 供折叠等纯偏好操作即时落盘用，跳过广播与重扫（左栏自行局部更新）。
vault 事件（`.mms` 的 modify / rename / delete，含文件夹改名）走 500ms 防抖自动重扫；文件夹重命名／删除同步迁移／清理 `settings.collapsedFolders` 中的路径记录。
视图在 `onOpen` 订阅、`onClose` 注销，避免 leaf 反复开闭累积回调。

---

## 4. 测试 API（core 层）

```ts
import { parseMms } from 'src/core/parser';
import { splitFrontmatter } from 'src/core/frontmatter';
import { buildOutgoingRefs, resolveCrossFileNodeRefs, resolveCrossFileRefs } from 'src/core/index-builder';
import { layoutTree, measureTextWidth } from 'src/core/layout';
import { makeNodeId, normalizeText, parseNodeRefTarget, parseRefTarget } from 'src/utils/make-key';
import { parseDirectiveLine, parseDirectiveTarget, resolveDirectives, stripLineComment, normalizeDirectiveKey, KNOWN_DIRECTIVE_KEYS, BEHAVIOR_DIRECTIVE_KEYS } from 'src/core/parser/directive';
import { resolveExtensions, KEY_RENDERERS, domNodeStyle, svgNodeStyle, edgeStyleOf, behaviorEnabled, pruneCollapsed, createDirectiveRuntime } from 'src/render/shared/extensions';
```

这些函数都是纯函数，无副作用，可直接 import 测试。

指令相关导出（`src/core/parser/directive.ts`）：

| 导出 | 用途 |
|---|---|
| `DIRECTIVE_PREFIX`／`LINE_COMMENT_MARK`／`TARGET_SEP` | 语法常量：`!--`／`<**`／`<--` |
| `KNOWN_DIRECTIVE_KEYS` | 标准 key 白名单（10 个，规范 §10.7 唯一权威来源）；清单外 key 在 body 主循环拦截，记`directive-unknown-key`不存储 |
| `BEHAVIOR_DIRECTIVE_KEYS` | 行为类key清单（`collapsed`／`debug`／`locked`），不参与继承 |
| `stripLineComment(text)` | 剥离行内首个`<**`到行尾，作用于标题行／指令行／正文行 |
| `normalizeDirectiveKey(raw)` | key归一化：trim → 连续空格折叠为`-` → 小写 |
| `parseDirectiveLine(line)` | 指令行解析：返回`{key, value, targetRaw}`，非指令行返回`null` |
| `parseDirectiveTarget(raw)` | 目标段解析：`[#+] 文本` → `{hashCount, text}` |
| `resolveDirectives(pending, nodes, nodeMap, declaredLevels, docExtensions, warn, bindings?)` | 第二遍回填：目标寻址（层级＋文本＋最近距离）＋冲突裁决（保留先写者）＋孤儿挂文档级；传入 `bindings` 数组时成功绑定的指令按序写入（行号＋归属节点 id），供 UI 写回文档定位指令行 |

指令渲染导出（`src/render/shared/extensions.ts`）：

| 导出 | 用途 |
|---|---|
| `KEY_RENDERERS` | 语义→画法映射表：每个白名单 key 的类别（样式/行为）、DOM CSS 属性、SVG 落点（shape/text/group）与值归一化器；`DirectiveKey` 联合类型由白名单推导，编译期保证覆盖完整 |
| `resolveExtensions(node, nodeMap, base?)` | 有效扩展求值：样式类沿祖先链就近补齐（`base` 为文档级兜底），行为类不继承，不复制指令 |
| `domNodeStyle(ext)` | DOM 探索视图：extensions → 节点元素 inline CSS 声明集（值经校验，非法不应用） |
| `svgNodeStyle(ext)` | SVG 全景视图：extensions → rect／text／g 三类落点的属性集 |
| `edgeStyleOf(ext)` | 连线样式覆盖：`line-color`→stroke、`line-width`→stroke-width；无覆盖返回`null` |
| `behaviorEnabled(ext, key)` | 行为类判定：有效值为`'true'`时启用 |
| `pruneCollapsed(rootId, nodeMap, collapsedIds)` | 折叠剪枝：折叠节点子孙不入布局（浅拷贝截断，不改原 map），返回隐藏后代计数 |
| `createDirectiveRuntime(doc, overrides?)` | 渲染期运行时（双画法共用）：`extOf`／`collapsedIds`／`hiddenCounts`／`metaOf(node)`（聚合样式与行为标志，`foldable` 对 auto 补齐节点恒 false）／`edgeStyle(toId)`；`overrides` 为注入的折叠覆盖，优先于指令初始态（视图层不传——折叠徽标点击由 main.ts 直接写回文档 `collapsed` 指令行，持久化即文档） |

---

## 5. 命令 ID 清单

| 命令 | id | 用途 |
|---|---|---|
| `MMS：打开文件面板` | `mms-open-side` | ribbon icon / 命令面板：把左 sidebar 设为 MMS 文件面板 |
| `MMS：打开详情面板` | `mms-open-detail` | 命令面板：把右 sidebar 设为 MMS 详情面板（左栏「查看详情」按钮等价） |
| `MMS：刷新全部 .mms` | `mms-refresh` | 命令面板：手动触发扫描 |

---

## 6. CSS 类名约定

BEM 变体：

| 模块 | 类前缀 |
|---|---|
| 画布 | `.mms-canvas-*`（toolbar / body / footer / name / placeholder） |
| 视图 | `.mms-explore-*` / `.mms-panorama-*` |
| 节点 | `.mms-dom-node` / `.mms-svg-node` |
| 边 | `.mms-edge` `.mms-edge-tree` `.mms-edge-cross` |
| 左栏 | `.mms-left-panel` `.mms-section-tag` `.mms-section-tree` `.mms-section-warn` |
| 右栏 | `.mms-info-card` `.mms-info-actions` `.mms-mini-btn` `.mms-empty-hint` |
| 调试 | `.mms-warning-item` `.severity-info/warning/error` |
| 状态卡 | `.mms-status-card` `.mms-status-label` `.mms-status-btn` `.state-synced/error` `.mms-status-actions` |
| 导出保存栏 | `.mms-save-bar` `.mms-save-row` `.mms-save-input` `.mms-save-error` `.has-error` |
| 视口 | `.mms-canvas-body.is-panning`（拖拽期间防文字选中） |

---

## 7. 进一步阅读

- [ARCHITECTURE.md](ARCHITECTURE.md) — 架构与数据流
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发与提交规范
