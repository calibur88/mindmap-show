# .mms 语言规范

> Mind Map Show (MMS) 的源文件格式。文档版本：v1.0（2026-09-09）· 语法版本：`.mms` v1

`.mms` 是文本文件，扩展名 `.mms`，MIME `text/plain`。语法借鉴 Markdown + 少量自定义符号。所有功能基于这套规范实现，插件只是规范的渲染器。

---

## 1. 文件结构

```
---
mms_name: 显示名
mms_tags: [标签1, 标签2]
mms_layout: LR | TB | RL
mms_desc: 文件级备注（多行）
---

# 正文开始
... 节点与正文 ...
```

| 部分 | 是否必须 | 作用 |
|---|---|---|
| Frontmatter | 否 | 4 个固定键，否则忽略 |
| 正文 | 否 | 节点用 `#` 标题 / `--` 子节点；正文 / 注释 / 嵌入 / 跨边 |

文件可空：空文件 → 节点树空 + `no-root` 警告。

---

## 2. Frontmatter

YAML 风格，必须在文件**开头**且三连横线包裹。

### 2.1 字段清单

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `mms_name` | string | 文件名去后缀 | 文件浏览器与右栏显示名 |
| `mms_tags` | string[] | [] | 用于左栏标签云过滤 |
| `mms_layout` | 'LR' \| 'TB' \| 'RL' | 'LR' | 布局方向 |
| `mms_desc` | string | '' | 文件级备注，右栏"备注"行展示 |

非法值：
- 缺 `: ` → 字段忽略
- `mms_layout: XX` → 回退 LR，记 `warning`
- `mms_tags` 元素含逗号 → 拆分为多标签
- `mms_tags` 类型错（不是数组 / 字符串） → 整字段忽略

### 2.2 行号

parser 在 frontmatter 处理阶段记录 `bodyStartLine`，节点 lineNo = frontmatter 行数 + 当前正文行号。这样源码跳转定位到行号永远准确。

---

## 3. 节点

### 3.1 标题节点

以 `#` 开头，1 到 N 个（不限 H6）。N 决定 depth。

```
# 根        depth 0
## 子1      depth 1
### 子子1    depth 2
...       ...
########## 深度10  depth 9（无上限）
```

**跳级**：从 `#` depth 1 直接跳到 `#` depth 3 → 自动补 1 个空节点（`type: auto` + `isAutoFix: true` + 占位 text ''），记 `level-skip` info。

**缺根**：首个标题不是 `#`（如首个就是 `##`） → 把首个标题降级为根，记 `no-root` warning。

### 3.2 子节点 `--`

紧跟最近标题，作为该标题的子级：

```
## 父节点
-- 子 1       depth 父 + 1
-- 子 2
-- 子 3
```

多个 `--` 是兄弟，与父标题同级。

### 3.3 节点 id

```
id = parentId === null ? text : parentId + '>' + normalizedText
```

`normalizedText`：去除前后空白、合并连续空白、去掉零宽字符。

### 3.4 同名合并

**仅同父下合并**（用户决策，与原"全局同名合并"的方案设计不一致）：

```
# R
## A
-- x
-- x         <- 同父同名合并，记 duplicate-merge info
## B
-- x         <- 跨父同名，独立节点
```

合并后：`node.parentIds = ['R>A', 'R>A']`（同父多次累积）、`childIds` 唯一、`isAutoFix: false`。文本节点属性 (text / depth / lineNo) 取首次出现的。

---

## 4. 正文 content

紧跟标题（`#` 或 `--`）的非空行，属于该节点的 `content`。

支持多行，直到遇到以下任一前缀：

- 下一个 `#` 标题
- 下一个 `--`
- 一条 `<=>`
- 一条 `![[...]]`
- `**`（注释行；见 §5）

```
# 标题
正文行 1
正文行 2
## 下一个
```

正文只用于右栏「节点详情」卡展示，画布上**默认不渲染**（避免视觉拥挤）。

---

## 5. 注释 annotation

以 `**` 开头的行属于 `node.annotation`。

| 语法 | 字段 |
|---|---|
| `** 文字`（中间至少一空格） | `node.annotation` |
| `**文本`（紧贴，无空格） | `node.content` |

支持多行，遇到下一个 `#` / `--` / `<=>` / `![[` 终止。

```
# 渠道策略
以信息流为主。
** 啥信息为主啊，怎么辅以啊   <- annotation
-- 信息流投放
预算占比 60%。
** 投放时段需避开晚高峰      <- annotation
```

annotation 在右栏「节点注释」卡显示（斜体小字 + 蓝条 + 灰底）。**画布默认不展示**——避免视觉拥挤。如需画布显示，可未来加 tooltip 触发。

---

## 6. 跨边引用 `<=>`

`<=>` 在某节点下写一条跨边，指向（可同文件 / 跨文件）其他节点。

```
<=> 目标1, 目标2    备注文字
```

- `目标` 单个 = 直接写节点文本（按文本匹配）
- `目标` 跨文件 = `文件名.mms::节点文本`
- 多个目标 = `,` 分隔
- `目标, 目标2` 后接 `备注`：分隔用 **Tab 或两个以上空格**（普通空格会被识别为名称的一部分）
- 备注缺省 = 空

### 6.1 解析时机

第一遍扫描收集 pending refs，第二遍在全部文档解析完后回填 `resolved`，因此支持**前向引用**。

### 6.2 状态

| 状态 | 含义 |
|---|---|
| `resolved=true` | 找到目标节点，画虚线 |
| `resolved=false` | 找不到，记 `missing-target` warning，虚线不绘 |

### 6.3 多目标

`<=> B, C    备注` 拆为两条 crossRef 到 B、C；两条共享 label。

---

## 7. 嵌入 `![[]]`

`![[target]]` 当行出现任意位置都计入 `node.embeds`。

按扩展名或协议分流：

| target | kind | 说明 |
|---|---|---|
| `*.png/jpg/jpeg/gif/svg/webp/bmp/avif` | `image` | 图片 |
| `*.mms` | `mms` | 脑图链接 |
| 其他 `*.ext` | `file` | 通用文件 |
| `https?://...` | `url` | URL |

同一行可多个 `![[]]`，顺序按出现。

裸 URL 行（以 `http://` 或 `https://` 开头）也算 url 嵌入。

---

## 8. 警告体系

`IWarning.type`：

| type | severity | 触发 |
|---|---|---|
| `parse-error` | warning | 解析时无法读取某行 |
| `no-root` | warning | 文件缺 # 根 |
| `level-skip` | info | 跳级（自动补空节点）|
| `missing-parent` | warning | `--` 之前没标题（已建自动根）|
| `missing-target` | warning/info | `<=>` 目标不存在 |
| `duplicate-merge` | info | 同名节点已合并 |
| `bad-frontmatter` | warning | YAML 非法 |

写调试信息卡可见，按 severity 排序。

---

## 9. 完整示例

```
---
mms_name: 用户增长脑图
mms_tags: [任务, 增长]
mms_layout: LR
mms_desc: 增长策略总览，含跨文件引用
---

# 用户增长脑图

当前采用双引擎驱动：社交裂变 + 付费转化。

** 整体策略待与产品再对齐

## 渠道策略

以信息流为主，辅以线下地推。

** 啥信息流？怎么辅以？

-- 信息流投放

预算占比 60%，重点在抖音 / 微信。

** 投放时段需避开晚高峰

-- 社交裂变

老带新奖励：邀请一人得 10 元。

## 转化策略

-- 首单转化

-- 复购

<=> 首单转化, 复购    联动转化链路

## 数据看板

![[dashboard.png]]
![[详细分析.mms]]
![[https://example.com/external.png]]
https://example.com/dashboard
```

---

## 10. 兼容性与未来

### 10.1 当前

- 复杂节点（混合 frontmatter/标题/嵌入）已实测
- 跨文件引用支持任意深度
- 空文件、缺根、跳级、错 layout 值都安全降级

### 10.2 不支持的语法

以下为**预留位置**，将来扩展：

- `:::` 代码块
- 表格 / 列表（无意义，脑图不用）
- 注释 `<!-- xxx -->`

### 10.3 引入新语法建议

1. 在 `core/parser/body.ts` 加正则常量 + 分流
2. 在 `core/parser/parser.test.ts` 加覆盖测试
3. 在 `IParsedDoc` / `IMmsNode` 加字段
4. 同步更新本文档与 ARCHITECTURE.md
5. 在 demo/ 加示例

---

## 11. 反向不兼容改动

理论上可做的破坏性改动（暂未做，列出供参考）：

- 节点 id 加 hash 防重名 → 同名合并语义可能变
- 引入新的内置注释键（如 `mms_color`）
- frontmatter 加 `mms_version` 字段并强制 require

任何破坏性改动需走 major 版本号（SemVer 2.0）。
