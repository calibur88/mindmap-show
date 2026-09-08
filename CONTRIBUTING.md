# 开发与更新规范

> 本文是项目的开发、版本、文档与git提交的统一规范，与[README.md](README.md)（总说明）、[ARCHITECTURE.md](ARCHITECTURE.md)（架构）配合阅读。文档版本：v1.0（2026-09-09）

## 1. 文档地图

| 文档 | 职责 |
|---|---|
| [README.md](README.md) | 60秒看懂：是什么、怎么装、怎么用 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、依赖、数据流、现状 |
| 本文 | 开发流程、版本规则、文档同步、代码与注释规范、提交规范 |
| [CHANGELOG.md](CHANGELOG.md) | 版本演进与兼容性声明 |
| [API.md](API.md) | Obsidian官方API与插件自身API |
| [docs/mms-语言规范.md](docs/mms-语言规范.md) | `.mms`语法权威规范 |
| [demo/README.md](demo/README.md) | 示例库验收手册 |

### 1.1 新文档归属哪一类

先回答三个问题，再对照下表：

1. **谁在读**：使用者／开发者／协作者／升级者／验收者？
2. **读完要做什么**：装上使用／理解实现／参与开发／评估升级／逐项验收？
3. **内容是否绑定具体版本号**：是→只追加CHANGELOG条目，不新建文件。

| 判定信号（文档回答的问题） | 归属类别 | 文件名 | 头部必备要素 |
|---|---|---|---|
| 这是什么、怎么装、怎么用 | 项目主页类 | `README.md` | 一句话定位＋特性列表＋版本兼容性＋版本信息 |
| 分层、依赖、数据流是什么 | 架构类 | `ARCHITECTURE.md` | 权威声明＋文档版本＋分层依赖图 |
| 流程、规范、红线是什么 | 开发规范类 | `CONTRIBUTING.md` | 定位声明＋文档版本＋文档地图 |
| 某版本改了什么、是否兼容 | 变更史类 | `CHANGELOG.md` | 文档版本＋倒序版本条目＋两类固定分类 |
| 怎么在真实环境逐项验收 | 示例库说明类 | 示例目录根`README.md` | 归属声明＋文档版本＋示例清单＋可复制示例 |

判定链：

```
新文档 → 内容绑定具体版本号？
  ├─ 是 → CHANGELOG.md（不新建文件，只追加条目）
  └─ 否 → 读者是谁？
        ├─ 使用者 → README.md
        ├─ 开发者 → ARCHITECTURE.md
        ├─ 协作者 → CONTRIBUTING.md
        └─ 验收者 → 示例库 README.md（新增示例目录时在其根目录新建）
```

判定规则：

- 五类各只有一个文件，不新建第六类；内容放不下就加章节，不另起文件；
- `API.md`与`docs/mms-语言规范.md`属于**派生参考文档**（不属于五类）：同样要带统一文档版本头，并在README的文档索引里登记；
- 新建文档先在§5的同步清单中登记，再写正文；
- 新建文档的最小头部：

```markdown
# 文档标题
> 本文归属《XX》文档类型。文档版本：v0.1（YYYY-MM-DD）
```

### 1.2 跨文档引用规范

引用格式（三选一，按对象选）：

| 引用对象 | 写法 | 示例 |
|---|---|---|
| 另一份文档 | Markdown相对链接 | `[ARCHITECTURE.md](ARCHITECTURE.md)` |
| 另一份文档的章节 | 相对链接＋`§编号`，**不写锚点** | `[CONTRIBUTING.md](CONTRIBUTING.md)§6` |
| 源码文件 | 反引号相对路径 | `src/core/parser/body.ts` |
| 源码中的符号 | `路径:符号` | `src/core/parser/body.ts:ANNOTATION_RE` |
| 外部站点 | 完整https链接 | `https://semver.org/lang/zh-CN/` |

路径写法：

- 一律**相对当前文档**的路径，同级直接写文件名，子目录写`docs/mms-语言规范.md`（不加前导`./`），上级写`../docs/mms-语言规范.md`；
- 禁止仓库根绝对路径（`/docs/...`）：在GitHub上会被解析到站点根而非仓库根；
- 命令行与产物路径例外，按仓库根书写并注明，如`test-vault-local/.obsidian/plugins/mindmap-show/`。

版本号引用：

| 场景 | 规则 |
|---|---|
| 文档头部 | 只写**本文档**的`文档版本：vX.Y（日期）`，不写插件版本 |
| 正文需提插件版本 | 写具体值并注明以`manifest.json`与[CHANGELOG.md](CHANGELOG.md)为准 |
| 跨文档提版本 | 一律指向[CHANGELOG.md](CHANGELOG.md)，不在多处写死 |
| 提语法版本 | 写`.mms` vN，权威定义在[docs/mms-语言规范.md](docs/mms-语言规范.md) |

> 禁止用纯文本写文件名（如`见 ARCHITECTURE.md`）而不加链接；禁止用中文标题锚点（GitHub对中文锚点的编码不稳定）。

## 2. 工程结构约定

- `src/host/types.ts`是interface／type的唯一出口，其他文件禁止散落类型声明；
- `src/core/`与`src/render/`禁止`import 'obsidian'`，宿主能力一律通过接口注入；
- `local`后缀目录一律本地专用、不入库（当前为`test-vault-local/`），禁止在其内放需提交的内容；
- `demo/`是入库示例库，任何语法变更都必须同步补一个示例文件；
- `dist/`是构建产物，不入库；
- 全部样式集中在仓库根目录`styles.css`，禁止在typescript里内联样式；
- 单测只覆盖`src/core/`，文件命名`*.test.ts`，与被测模块同目录。

## 3. 版本号规则

### 3.1 插件版本

- 遵循[SemVer2.0](https://semver.org/lang/zh-CN/)：MAJOR为不兼容变更，MINOR为向后兼容的新功能，PATCH为向后兼容的修复；
- 版本号必须三处同步：`manifest.json`的`version`、`package.json`的`version`、[CHANGELOG.md](CHANGELOG.md)最新条目标题；
- `manifest.json`的`id`、`minAppVersion`、`isDesktopOnly`不得随意改动，改动即视为破坏性变更；
- 预发布标签形如`1.1.0-alpha.1`、`1.1.0-rc.1`。

### 3.2 `.mms`语法版本

- 语法版本独立于插件版本演进，当前为v1，权威定义在[docs/mms-语言规范.md](docs/mms-语言规范.md)；
- 只有语法层面的规则新增／修改／废除才动语法版本，插件内部实现变化不影响它；
- 语法破坏性变更必须升语法主版本，并在CHANGELOG的「.mms语法更新」分类下显式标注**不兼容**；
- 语法v1的既有文件在v1内部任何小版本都必须可正常解析。

## 4. 开发流程

```bash
npm install --registry=https://registry.npmmirror.com   # 1.装依赖
npm run dev                                             # 2.watch构建，产物直出测试vault
npx tsc --noEmit                                        # 3.类型检查
npx vitest run                                          # 4.跑单测
node esbuild.config.mjs once                            # 5.同步产物到测试vault
git status                                              # 6.确认改动范围
```

1. 开发：`npm run dev`进入watch，改动即时落到测试vault插件目录；
2. 自测：类型检查与单测必须同时全绿；
3. 验收：在Obsidian里重载插件，按[demo/README.md](demo/README.md)逐项走查；
4. 文档：按§5清单同步全部受影响文档；
5. 提交：按§10与§11执行，未经许可不得执行git写操作。

> TypeScript不能直接用`node`运行，必须经`tsc --noEmit`检查＋esbuild打包两步；`npm run build`只产出`dist/`，不会更新测试vault，验收前必须额外跑`node esbuild.config.mjs once`。

## 5. 文档更新规范（变更时必须同步的清单）

| 文件 | 需更新的内容 |
|---|---|
| `README.md` | 特性列表、核心功能、快速上手示例、版本信息 |
| `ARCHITECTURE.md` | 分层表格、模块树、数据流、测试套件例数、现状 |
| `CHANGELOG.md` | 版本条目（**仅维护者明确要求时才追加**） |
| `API.md` | 新增／变更的插件自身API、命令ID、CSS类名 |
| `docs/mms-语言规范.md` | `.mms`语法任何新增／修改／废除 |
| `demo/README.md` | 示例文件增删、预期命中结果 |
| `manifest.json`／`package.json` | 版本号三处同步 |
| `styles.css` | 新增样式类说明（类名遵循`mms-`前缀） |
| 新建文档 | 先按§1.1判定归属类别，再套最小头部模板，并在本表与README文档索引登记 |
| 全部文档 | 禁止作者／AI／维护者署名；版权声明只保留在`LICENSE`与`manifest.json`的`author`字段 |

> **禁止只改源码不改文档。** 任何一个可观察行为的变化，都必须能在上表中找到至少一个对应文件。

## 6. CHANGELOG编写规范

> `CHANGELOG.md`只在维护者明确要求时才更新，不随每次提交自动追加。

### 6.1 格式模板

````markdown
## [X.Y.Z] - YYYY-MM-DD（当前）
> （仅大版本）一句话概括 + **破坏性大版本**警示

### 插件更新

**功能名称**：一句话核心价值
- 展开：改了什么、影响范围，每条可验证
- 破坏性变更在条目末尾标 **破坏性**

### .mms语法更新

**变更名称**：简述
- 新增／修改／废除的规则
- 对已有用户的影响：**兼容** ／ **部分不兼容** ／ **不兼容**
- 测试情况：N例（M套件）全部通过
- **版本兼容声明**：本版本与X.Y完全兼容／部分兼容／不兼容

---
## [特殊条目] - YYYY-MM-DD
（不升版本的纯数据／示例／文档变更，格式同上）
````

### 6.2 撰写细则

| 规则 | 说明 |
|---|---|
| 标题层级 | 版本用`##`，分类用`###`，条目用`**名称**：一句话`＋`-`列表 |
| 版本号 | 与`manifest.json`／`package.json`一致，最新条目标注（当前） |
| 日期 | `YYYY-MM-DD` |
| 排列 | 版本倒序，最新在上 |
| 分类 | 固定两类：插件更新、.mms语法更新，不得自创分类 |
| 条目粒度 | 一个功能一条，不宜过粗也不宜过碎 |
| 破坏性 | 条目末尾标**破坏性**，大版本在条目开头用`> **破坏性大版本**`警示 |
| 测试情况 | 每个版本末尾声明用例数与通过情况 |
| 兼容声明 | 每个版本末尾三选一显式声明，不得省略 |
| 禁止编造 | 不得编造或删除历史条目，不确定是否重复的一律保留 |
| 禁止叙事 | 不写过程性叙事（改了几次、如何取舍），只写结果 |

## 7. 代码编写规范

- 类型出口唯一：新增interface／type一律加到`src/host/types.ts`；
- 分层零依赖：`core`不依赖`obsidian`，`render`不含业务逻辑，`ui`不直接读vault；
- 渲染层保持纯函数：同输入必得同输出，不读全局状态；
- 生命周期成对：`onOpen`注册的订阅必须在`onClose`注销，避免leaf反复开闭累积回调；
- 错误语义：解析问题一律产出`IWarning`，不得`throw`中断整库扫描；
- 未文档化的Obsidian运行时API：先核实运行时确实存在，再写入`host/obsidian/obsidian-internal.d.ts`并加`typeof`守卫；
- 设置只存偏好：`MmsSettings`不得承载业务数据，新增字段必须同时给默认值；
- 命名：模块级PascalCase，函数与字段camelCase，常量UPPER_SNAKE，接口`I`前缀，样式类`mms-`前缀；
- 署名：源码与文档禁止作者／AI／维护者署名，版权声明只在`LICENSE`与`manifest.json`出现。

## 8. 注释规范

### 8.1 注释类型与使用场景

| 类型 | 语法 | 场景 |
|---|---|---|
| 文件头 | `/** @module 路径 @description 职责 */` | 每个`.ts`文件必须有 |
| 函数注释 | `/** 一句话职责 */` | 非自解释的导出函数与类 |
| 行内注释 | `// 原因说明` | 解释why，如边界取值、兼容性处理 |
| 类型增强 | 声明合并＋`typeof`守卫 | 未进官方typings的运行时API |

### 8.2 格式规范

```ts
/**
 * @module core/parser/body
 * @description 正文解析：标题节点、子节点、正文、注释与跨边的分流
 */

/**
 * 把一行正文归入当前节点
 * 跳级（depth增加超过1）时自动补空节点，并记 level-skip 告警
 */
function pushBodyLine(line: string): void {
  // ANNOTATION_RE 要求星号后至少一个空格，避免与 Markdown 加粗歧义
  if (ANNOTATION_RE.test(line)) return;
}
```

### 8.3 绝对禁止的注释类型

| 禁止类型 | ❌ 错误示例 |
|---|---|
| 变更日志式 | `// 2026-09-08 改成仅同父合并` |
| 删除原因 | `// 旧的全局合并逻辑，已废弃` |
| 过程叙事 | `// 这一版把左栏拆成独立视图时移过来的` |
| 个人署名 | `// by xxx` |
| 复述代码 | `i++; // i自增` |
| 未来计划 | `// TODO: 以后改成虚拟滚动` |

### 8.4 语言要求

- 注释用中文，代码标识符用英文；
- 代码、路径、键名一律使用ASCII直引号，中英文之间不加空格；
- 专业术语（DOM、SVG、frontmatter、leaf）保留英文原文，不强行翻译。

## 9. 测试规范

- 运行器：vitest，`environment: node`，`include: ['src/**/*.test.ts']`，用例自动发现、无需手动注册；
- 套件组织：一个被测模块一个`.test.ts`，与被测模块同目录；
- 必须新增用例的时机：改`.mms`语法解析、改布局算法、改跨文件引用或反链索引、`demo/`增删示例；
- 验收类用例直接读`demo/`下的真实素材，避免测试数据与真实素材脱节；
- 提交前`npx vitest run`必须全绿，且`npx tsc --noEmit`零错误。

## 10. git提交规范

### 10.1 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 结构调整，不新增功能也不修复缺陷 |
| `perf` | 性能 |
| `test` | 仅测试 |
| `docs` | 仅文档 |
| `chore` | 构建、依赖、杂项 |
| `style` | 格式，不影响逻辑 |

scope取值：`core`、`render`、`ui`、`views`、`settings`、`controller`、`host`、`docs`。

提交信息语言：中文`subject`，一行不超过72字符；`body`用`-`列表说明改了什么与验证方式。

### 10.2 禁止提交与必须提交

| 类别 | 内容 |
|---|---|
| 禁止提交 | `node_modules/`、`dist/`、`main.js`、`*.js.map`、`test-vault-local/`、`.workbuddy/`、`*.tsbuildinfo`、个人临时文件 |
| 必须提交 | 源码改动、对应文档改动、新增／改动的测试用例、`demo/`示例、`manifest.json`与`package.json`的版本号 |

## 11. 提交流程

> **核心原则：未经明确许可，不得执行任何git写操作**（`add`／`commit`／`push`／`reset`／`checkout --`／`tag`等）。

1. 确认改动：`git status`与`git diff`逐文件核对；
2. 校验：类型检查、单测、构建三步全绿；
3. 文档：按§5清单确认已同步；
4. 提交：取得明确许可后再执行，提交信息按§10.1书写；
5. 推送：取得明确许可后再推送，标签与版本号保持一致。

凭据弹窗或凭据缓存异常时，先查看当前配置再处理：

```bash
git config --get remote.origin.url      # 确认远端地址
git config --get credential.helper      # 确认凭据助手
```

### 11.1 常见问题：远端跟踪引用不刷新

| 项 | 说明 |
|---|---|
| 现象 | `git push`已成功，但`git status -sb`仍显示`[ahead N]`；`git fetch`打印更新日志后`git rev-parse origin/master`仍返回旧值；`git update-ref`报成功但引用不变 |
| 原因 | 受限执行环境（工具沙箱、只读挂载）会拦截对`.git/packed-refs`与`.git/refs/**`的写入，本地远端跟踪引用`refs/remotes/origin/*`无法落盘 |
| 影响 | 仅本地记账失真，远端仓库已是最新；**不得据此重复推送** |
| 判别 | 一律以远端实际状态为准，不用本地`git status`判断推送结果 |

核验与处理：

```bash
git ls-remote origin refs/heads/master   # 1.读远端真实HEAD
git rev-parse master                     # 2.本地HEAD；与第1步一致即推送已成功
git log --oneline origin/master..master  # 3.为空才是真的无未推送提交（引用滞后时会误报）
```

1. 第1步与第2步的commit一致时，确认推送成功，不重推；
2. 在本机终端（非受限环境）执行`git fetch --prune`复位跟踪引用；
3. 仍不刷新时用显式refspec强制覆盖：`git fetch origin "+refs/heads/master:refs/remotes/origin/master"`；
4. 以上都无效时，以`git ls-remote`为唯一判别依据，忽略`git status`的`ahead`提示。

> 标签同理：用`git ls-remote --tags origin`核对远端是否已有`refs/tags/vX.Y.Z`，不要凭本地`git tag -l`判断标签是否已推送。

## 12. 本地测试与恢复

会污染的文件：

- `test-vault-local/.obsidian/plugins/mindmap-show/main.js`、`styles.css`、`manifest.json`：每次构建被覆盖；
- `test-vault-local/.obsidian/plugins/mindmap-show/data.json`：Obsidian在设置变更时写入；
- `dist/`：`npm run build`产出，可随时重建。

恢复干净状态：

```bash
rm -rf test-vault-local/.obsidian/plugins/mindmap-show   # 删除插件目录（含本地设置）
cd 仓库根目录                                             # 回到根目录再构建
node esbuild.config.mjs once                              # 重新生成纯净产物
```

> 上述删除只作用于本地测试vault（`local`后缀，不入库）。执行前确认当前目录确为测试vault内的插件目录，不得对`demo/`、`docs/`或源码目录使用递归删除。
