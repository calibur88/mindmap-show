# 项目整体架构

> 本文是Mind Map Show（MMS）工程的权威架构说明。文档版本：v1.0（2026-09-09）
> 插件版本：1.0.0 · 语法版本：`.mms` v1 · 最低依赖：Obsidian1.4.0 · 语言：TypeScript5.7（严格模式）

## 1. 项目定位

1. **host层**：定义跨层接口并适配Obsidian，是`import 'obsidian'`的唯一合法位置（另含`main.ts`与`views/`）；
2. **core层**：解析`.mms`文本、计算布局、构建跨文件引用与反链索引，纯逻辑、零宿主依赖、可单测；
3. **controller层**：持有全局索引与刷新流水线、选中态总线，跨视图共享一份解析结果；
4. **render层**：把`IParsedDoc`＋`MmsSettings`翻译成DOM或SVG，不含任何业务判断；
5. **ui层**：左栏、右栏、状态卡三个面板控件，只做DOM拼装与事件转发；
6. **views层**：Obsidian的FileView与ItemView，负责生命周期与依赖注入。

核心设计原则：

- **单一类型出口**：全部interface／type集中在`src/host/types.ts`，其他文件禁止散落类型声明；
- **零宿主依赖**：`core/`与`render/`不得出现`import 'obsidian'`，宿主能力一律由接口注入；
- **纯函数渲染**：`render*`函数只依赖入参产出`DocumentFragment`／`SVGElement`，同输入必得同输出；
- **单向依赖**：`main → views → ui → render → controller → core → host/types`，任何层不得反向依赖；
- **设置即偏好**：`MmsSettings`只存展示偏好，不存任何业务数据，解析结果永不落盘。

## 2. 工程结构

```
mindmap-show/
├─ src/                     源码（唯一typescript来源）
│  ├─ main.ts               插件入口：装配适配器、注册视图与命令
│  ├─ host/                 类型出口与Obsidian适配器
│  ├─ core/                 解析、布局、索引（纯逻辑）
│  ├─ controller/           刷新流水线、全局索引、选中态
│  ├─ render/               DOM／SVG两种画法与视口控件
│  ├─ ui/                   左栏、右栏、状态卡
│  ├─ views/                FileView／ItemView／设置面板
│  ├─ settings/             设置schema与默认值
│  └─ utils/                DOM工具与键值构造
├─ demo/                    入库示例库（8个.mms）
├─ docs/                    .mms语言规范
├─ styles.css               全部样式集中一处
├─ manifest.json            插件清单
├─ esbuild.config.mjs       构建脚本（dev／once／production三种模式）
├─ dist/                    发布产物（不入库）
└─ test-vault-local/        本地测试vault（不入库）
```

易混淆目录对照：

| 目录 | 用途 | 是否入库 |
|---|---|---|
| `demo/` | 随仓库提交的示例素材库，供功能验收与语法演示 | 是 |
| `test-vault-local/` | 本地Obsidian测试vault，`local`后缀表示本地专用 | 否 |
| `dist/` | `npm run build`产出的发布包 | 否 |
| `test-vault-local/.obsidian/plugins/mindmap-show/` | `dev`／`once`产物的落地目录，Obsidian直接加载这里 | 否 |

## 3. 代码架构

```
main.ts                      装配：new适配器 → new索引 → registerView → addCommand
 ├─ host/types.ts            唯一类型出口（IMmsNode／IParsedDoc／IWarning／IOpener／IUiHost…）
 ├─ host/obsidian/
 │   ├─ vault.ts             列目录与读文件（IVaultHost）
 │   ├─ meta.ts              反链索引登记（IMetaHost）
 │   ├─ opener.ts            打开脑图／源码／外链（IOpener）
 │   ├─ ui-host.ts           状态广播与提示（IUiHost）
 │   └─ obsidian-internal.d.ts  未进typings的运行时API的类型增强
 ├─ core/
 │   ├─ frontmatter.ts       四个固定键解析与非法值回退
 │   ├─ parser/
 │   │   ├─ index.ts         解析入口：frontmatter → body → 结果装配
 │   │   ├─ body.ts          标题／子节点／正文／注释／跨边分流
 │   │   └─ embed.ts         `![[]]`按扩展名与协议分流
 │   ├─ index-builder.ts     跨文件引用解析与反链索引构建
 │   └─ layout/index.ts      文字测量 → 矩形尺寸 → tidy tree布局
 ├─ controller/
 │   ├─ refresh.ts           MmsIndex：刷新流水线与全局索引
 │   └─ selection.ts         MmsSelection：当前文件＋选中节点总线
 ├─ render/
 │   ├─ dom/index.ts         探索视图（DocumentFragment）
 │   ├─ svg/index.ts         全景视图（SVGElement）
 │   ├─ shared/edges.ts      两种视图共用的连线SVG
 │   └─ canvas-viewport.ts   鼠标／触控视口与缩放
 ├─ ui/
 │   ├─ left-panel.ts        标签云＋文件树＋调试信息＋状态卡
 │   ├─ right-panel.ts       节点详情／注释／嵌入／反链
 │   └─ status-card.ts       底部操作条：刷新＋查看详情
 ├─ views/
 │   ├─ mms-view.ts          FileView，接管`.mms`扩展名
 │   ├─ side-view.ts         ItemView，挂左侧sidebar
 │   ├─ detail-view.ts       ItemView，挂右侧sidebar
 │   └─ settings-tab.ts      设置面板
 ├─ settings/
 │   ├─ schema.ts            MmsSettings形状定义
 │   └─ defaults.ts          默认值
 └─ utils/
     ├─ dom.ts               `el()`元素构造
     └─ make-key.ts          反链键构造
```

分层依赖（单向，不得反向依赖）：

```
main ──► views ──► ui ──► render ──► controller ──► core ──► host/types
  │                                                            ▲
  └────► host/obsidian ────────────────────────────────────────┘

旁支：settings / utils 被 ui / views / render / controller 引用，自身不依赖任何业务层
```

各层架构约束：

| 层 | 约束 |
|---|---|
| `host/types` | 零依赖；是interface／type的唯一声明位置 |
| `host/obsidian` | 仅依赖`host/types`与`obsidian`；未文档化的运行时API必须加`typeof`守卫 |
| `core` | 禁止`import 'obsidian'`；禁止直接访问DOM；函数保持纯度以便单测 |
| `render` | 禁止业务逻辑与状态；只接收`IParsedDoc`＋渲染选项 |
| `ui` | 只做DOM拼装与事件转发，不直接读vault |
| `views` | 负责生命周期；`onOpen`注册的订阅必须在`onClose`成对注销 |
| `main` | 只做装配，业务逻辑一律下沉 |

命名规则：

- 模块级类型／类用PascalCase，函数与字段用camelCase，常量用UPPER_SNAKE；
- 接口统一`I`前缀（`IParsedDoc`、`IOpener`、`IUiHost`）；
- 视图类型常量形如`MMS_VIEW_TYPE`，与`registerView`／`getLeavesOfType`共用；
- 样式类统一`mms-`前缀，状态类用`is-active`／`state-error`形式。

### 数据流

刷新流水线（`MmsIndex.refresh`）：

```
listMmsFiles → readFile → parseMms → resolveCrossFileRefs → buildBacklinkIndex
   → docs／index落库 → metaHost.setBacklinkIndex → uiHost.setStatus
   → onUpdate广播 → MmsSideView.render ／ MmsView.renderAll ／ MmsDetailView
```

设置变更链路（400毫秒防抖）：

```
设置面板 onChange → MmsPlugin.updateSettings → saveData落盘
   → 防抖窗口结束 → onSettingsChange广播 → 各视图按新值重绘
   → MmsIndex.refresh() 整库重扫 → onUpdate广播 → 三视图最终一致
```

节点选中链路：

```
画布点击节点 → MmsSelection.set(文件路径, 节点id) → 订阅者回调 → 右栏渲染节点详情
```

状态存放说明：

- 解析结果只存内存（`MmsIndex`），不写入任何文件；
- 用户偏好存`<vault>/.obsidian/plugins/mindmap-show/data.json`，由Obsidian的`saveData`／`loadData`管理；
- 当前选中态存内存（`MmsSelection`），随视图关闭失效。

## 4. 构建与测试

```bash
npm install --registry=https://registry.npmmirror.com   # 装依赖
npm run dev                                             # watch构建，直出测试vault插件目录
node esbuild.config.mjs once                            # 单次构建，同上目录
npm run build                                           # tsc --noEmit + 产出dist/
npx tsc --noEmit                                        # 严格模式类型检查
npx vitest run                                          # 51例单测
```

- 构建流程：入口`src/main.ts` → esbuild打包为单文件`main.js` → 连同`manifest.json`与`styles.css`复制到输出目录；输出目录优先级为环境变量`MMS_OUT_DIR`＞`production`时的`dist/`＞其他情况的测试vault插件目录；
- 测试流程：vitest按`src/**/*.test.ts`自动发现用例，`environment: node`保证零DOM依赖，无需手动注册套件；
- 类型检查：`tsconfig.json`开启`strict`／`noImplicitAny`／`noUnusedLocals`／`noUnusedParameters`。

测试套件：

| 套件 | 领域 | 例数 |
|---|---|---|
| `src/core/frontmatter.test.ts` | frontmatter四个固定键与非法值回退 | 8 |
| `src/core/parser/parser.test.ts` | 节点层级、正文、注释、跨边、嵌入 | 22 |
| `src/core/parser/demo.test.ts` | 真实示例冒烟与布局算法 | 15 |
| `src/core/index-builder.test.ts` | 跨文件引用解析与反链索引 | 6 |
| 合计 | — | 51 |

## 5. 文档索引

| 文档 | 说明 |
|---|---|
| [README.md](README.md) | 是什么、怎么装、怎么用 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发、版本、文档、提交规范 |
| [CHANGELOG.md](CHANGELOG.md) | 版本演进与兼容性声明 |
| [API.md](API.md) | Obsidian官方API与插件自身API索引 |
| [docs/mms-语言规范.md](docs/mms-语言规范.md) | `.mms`语法权威规范 |
| [demo/README.md](demo/README.md) | 示例库验收手册 |

## 6. 现状

**已实现**：`.mms`语法v1全量解析（frontmatter／标题节点／`--`子节点／正文／`**`注释／`<=>`跨边／`![[]]`嵌入）；跳级补空节点、缺根降级、同父同名合并；跨文件引用与反链索引；探索视图与全景视图双画法；鼠标与触控视口；左sidebar文件面板（标签云／文件树／调试信息／状态卡）；右侧详情面板（正文／注释／嵌入／反链／打开源码）；9项设置与防抖自动刷新；ribbon图标与3条命令。

**规划**：仓库未设TODO文件，未落地能力见[CHANGELOG.md](CHANGELOG.md)「已知限制」与[docs/mms-语言规范.md](docs/mms-语言规范.md)§10.2。
