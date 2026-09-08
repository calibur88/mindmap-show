# API 索引

> Mind Map Show (MMS) - Obsidian 思维导图插件。文档版本：v1.0（2026-09-09）

本文档列出插件版本1.0.0用到的Obsidian官方API与插件自身API。仅记录真实用到的，不写"未来可能用到的"。

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
| `MmsLayout = 'LR' \| 'TB' \| 'RL'` | 布局方向 |
| `MmsFrontmatter` | frontmatter 四个固定键：mms_name / mms_tags / mms_layout / mms_desc |
| `NodeType = 'heading' \| 'child' \| 'auto'` | 节点来源：标题行 / -- 行 / 自动补齐 |
| `EmbedKind = 'image' \| 'mms' \| 'file' \| 'url'` | 嵌入分流结果 |
| `IEmbed` | 嵌入条目 |
| `ICrossRef` | 跨边引用（出边） |
| `IMmsNode` | 节点：id / text / type / depth / lineNo / **content** / **annotation** / childIds / parentIds / crossRefs / incomingRefs / embeds / sourceFilePath / isAutoFix |
| `IWarning` | 解析警告 |
| `IParsedDoc` | 一个 .mms 文件的解析结果 |
| `IBacklink` | 反链条目 |
| `BacklinkIndex` | Map 接口包装 |

### 3.2 宿主接口（注入，不直接 import obsidian）

| 接口 | 实现位置 | 能力 |
|---|---|---|
| `IVaultHost` | host/obsidian/vault.ts | listMmsFiles / readFile / getMtime / exists |
| `IMetaHost` | host/obsidian/meta.ts | getFrontmatter / extractMmsTags / extractMmsDesc / setBacklinkIndex / getBacklinks |
| `IOpener` | host/obsidian/opener.ts | openMindMap / openSource / openPath / openUrl / revealInSystem |
| `IUiHost` | host/obsidian/ui-host.ts | notify / setStatus / onStatus / getLastDetail |

### 3.3 渲染层导出

| 函数 | 用途 | 返回 |
|---|---|---|
| `renderExplore(doc, opts)` | 探索视图 | `DocumentFragment` |
| `renderPanorama(doc, opts)` | 全景视图 | `SVGSVGElement` |
| `layoutTree(rootId, nodeMap, opts)` | 布局算法 | `ILayoutResult {nodes, edges, width, height}` |
| `buildEdgesSvg(layout, dir, w, h, lineWidth, crossLineWidth)` | 连线 SVG | `SVGSVGElement` |

### 3.4 控件类

| 类 | 用途 |
|---|---|
| `LeftPanel(container, opener, uiHost, onRefresh, onSelectTag, openDetailPanel)` | 左 sidebar 全部 UI |
| `RightPanel(container, opener)` | 右栏节点详情 |
| `StatusCard(container, uiHost, onRefresh, openDetailPanel)` | 左栏底部状态卡（刷新 / 查看详情 两个按钮，仅异常态显示文案） |
| `CanvasViewport` | 画布视口（鼠标 / 触控 + 缩放） |

### 3.5 控制器

```ts
class MmsIndex {
  constructor(vaultHost, metaHost, uiHost);
  refresh(): Promise<void>;                        // 全量扫描：解析 → 跨文件引用 → 反链索引
  onUpdate(listener: () => void): void;
  offUpdate(listener: () => void): void;
  getDoc(filePath: string): IParsedDoc | undefined;
  getFileSummaries(): IFileSummary[];              // 左栏文件树用
  getAllWarnings(): IWarning[];                    // 聚合全工程警告，按 severity/文件/行号排序
  getTagStats(): { name: string; count: number }[];
  getBacklinks(nodeId, filePath): IBacklink[];
}
```

并发守卫：连续 `refresh()` 复用同一个 Promise，避免双扫。

### 3.6 插件主体（`src/main.ts`）

```ts
class MmsPlugin extends Plugin {
  settings: MmsSettings;
  updateSettings(patch: Partial<MmsSettings>): Promise<void>;  // 合并 → 落盘 → 防抖广播
  onSettingsChange(fn: () => void): () => void;                 // 订阅设置变更，返回注销函数
  openDetailPanel(): Promise<void>;                             // 唤起 / 复用右侧详情面板
}
```

设置变更走 400ms 防抖：先广播给各视图按新值重绘，再触发 `index.refresh()` 整库重扫。
视图在 `onOpen` 订阅、`onClose` 注销，避免 leaf 反复开闭累积回调。

---

## 4. 测试 API（core 层）

```ts
import { parseMms } from 'src/core/parser';
import { splitFrontmatter } from 'src/core/frontmatter';
import { buildBacklinkIndex, resolveCrossFileRefs } from 'src/core/index-builder';
import { layoutTree, measureTextWidth } from 'src/core/layout';
import { makeNodeId, makeBacklinkKey, normalizeText } from 'src/utils/make-key';
```

这些函数都是纯函数，无副作用，可直接 import 测试。

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
| 状态卡 | `.mms-status-card` `.mms-status-label` `.mms-status-refresh` `.state-synced/error` |
| 视口 | `.mms-canvas-body.is-panning`（拖拽期间防文字选中） |

---

## 7. 进一步阅读

- [ARCHITECTURE.md](ARCHITECTURE.md) — 架构与数据流
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发与提交规范
