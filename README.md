# Mind Map Show（MMS）

Obsidian插件：把`.mms`结构化文本直接渲染为可交互思维导图——左栏管文件、中间画布看图、右栏看节点详情。

- **文本即数据源**：`.mms`是纯文本，用Markdown风格的`#`／`--`／`<=>`写节点，任何编辑器可改、Git可diff；
- **三栏工作区**：左栏挂Obsidian真实sidebar，中间是`.mms`专属FileView画布，右栏展示节点正文、注释、嵌入与反链；
- **双视图渲染**：探索视图（DOM，可缩放拖拽）与全景视图（SVG，静态全量）共用同一套布局算法；
- **跨文件引用**：`<=> 文件名.mms::节点文本`在第二遍扫描回填，支持前向引用，解析成功即画虚线并登记反链；
- **诊断闭环**：跳级、缺根、目标缺失、同名合并等解析告警按`error`→`warning`→`info`排序，常驻左栏调试信息区。

> **文档版本**：v1.0（2026-09-09）· 插件版本：1.0.0
> **版本兼容性**：当前1.0.0为首个正式版，`.mms`语法v1自本版起固定。此前无已发布版本，不存在配置迁移，既有`data.json`设置可沿用。

版本信息：

- 插件版本：1.0.0
- 插件ID：`mindmap-show`
- 最低依赖：Obsidian1.4.0
- 语法版本：`.mms` v1
- 构建环境：Node.js22.x＋npm10.x

## 安装

1. 准备产物三件套：`main.js`、`manifest.json`、`styles.css`；
2. 复制到vault的`<vault>/.obsidian/plugins/mindmap-show/`目录下；
3. Obsidian→设置→第三方插件→关闭安全模式→重新加载→启用Mind Map Show。

## 快速开始

```bash
npm install --registry=https://registry.npmmirror.com   # 装依赖，国内建议加镜像
npm run dev                                             # watch构建，产物直出 test-vault-local/.obsidian/plugins/mindmap-show/
node esbuild.config.mjs once                            # 单次构建，同样直出上述测试vault目录
npm run build                                           # tsc --noEmit + 产出 dist/
npx vitest run                                          # 跑 51 例 core 层单测
npx tsc --noEmit                                        # 严格模式类型检查
```

> `npm run build`只产出`dist/`，想让Obsidian里生效必须再跑一次`node esbuild.config.mjs once`或`npm run dev`。

## 核心功能

1. **文件面板（左栏）**：标签云按标签过滤、文件树按文件夹折叠、调试信息区聚合全工程告警、状态卡放「刷新」与「查看详情」两个按钮；
2. **画布（中间）**：探索／全景一键切换，鼠标拖拽与滚轮缩放、触控单指平移与双指缩放共用同一视口控件，缩放范围0.1~8；
3. **节点详情（右栏）**：展示来源文件、节点正文、节点注释、嵌入资源与反链，未选中节点时给出占位提示；
4. **刷新流水线**：全库扫描→解析→跨文件引用解析→反链索引，一次刷新让三个视图同步；
5. **设置（9项）**：默认视图、调试信息开关、3个线宽、4个间距；改动后400毫秒防抖自动重绘并重新扫描，无需手动刷新；
6. **入口与命令**：ribbon图标`git-fork`唤起文件面板，命令面板提供「打开文件面板」「打开详情面板」「刷新全部.mms」。

## .mms快速上手

最小可运行示例：

```mms
# 根节点
## 子节点A
正文属于紧邻的标题节点
** 注释：星号后至少一个空格
-- 子节点A的子节点
```

关键词速查：

| 写法 | 含义 |
|---|---|
| `mms_name`／`mms_tags`／`mms_layout`／`mms_desc` | frontmatter四个固定键，控制显示名、标签、布局方向、文件备注 |
| `# 标题` | 标题节点，`#`的个数决定层级，无H6上限 |
| `-- 子节点` | 挂到最近标题下的子节点 |
| 普通非空行 | 节点正文`content`，右栏展示，画布不渲染 |
| `** 注释` | 节点注释`annotation`，星号后至少一个空格 |
| `<=> 目标, 目标2	备注` | 跨边引用，目标间用逗号分隔，备注前用Tab或两个以上空格 |
| `![[target]]` | 嵌入图片／脑图／文件／URL，按扩展名与协议分流 |

完整语法见[.mms语言规范](docs/mms-语言规范.md)。

## 工程结构

```
mindmap-show/
├─ src/
│  ├─ main.ts              插件入口：装配适配器、注册视图与命令
│  ├─ host/                唯一类型出口 + Obsidian适配器
│  ├─ core/                解析、布局、索引等纯逻辑（可单测）
│  ├─ controller/          刷新流水线、全局索引、选中态总线
│  ├─ render/              探索（DOM）与全景（SVG）两种画法
│  ├─ ui/                  左栏、右栏、状态卡
│  ├─ views/               FileView、ItemView、设置面板
│  ├─ settings/            设置schema与默认值
│  └─ utils/               DOM工具与键值构造
├─ demo/                   入库示例库（8个.mms，覆盖全部语法）
├─ docs/                   .mms语言规范
├─ styles.css              全部样式集中一处
├─ manifest.json           插件清单（版本1.0.0）
└─ test-vault-local/       本地测试vault（local后缀＝本地专用，不入库）
```

## 文档索引

| 文档 | 说明 |
|---|---|
| [README.md](README.md) | 项目主页：是什么、怎么装、怎么用（本文） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 分层、依赖、数据流与现状（面向开发者） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 开发、版本、文档、提交规范（面向协作者） |
| [CHANGELOG.md](CHANGELOG.md) | 版本演进与兼容性声明（面向升级者） |
| [demo/README.md](demo/README.md) | 示例库验收手册（面向验收者） |
| [API.md](API.md) | Obsidian官方API与插件自身API索引（派生参考文档） |
| [docs/mms-语言规范.md](docs/mms-语言规范.md) | `.mms`语法权威规范（派生参考文档） |

前五项是《AI文档通用模板》定义的五类文档；后两项为派生参考文档，同样遵循统一文档版本头与排版规范。新增文档该归哪一类，查[CONTRIBUTING.md](CONTRIBUTING.md)§1.1。

## License

许可类型：MIT许可证，附加商业使用限制。

特殊限制：未经书面许可，不得将本插件或其衍生品用于商业分发或商业服务。完整条款见[LICENSE](LICENSE)。

版权归属与联系方式：见[LICENSE](LICENSE)（版权方calibur88及联系邮箱）与`manifest.json`的`author`／`authorUrl`字段。
