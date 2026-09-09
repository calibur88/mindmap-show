---
mms_name: TB 上到下
mms_tags: [示例, 布局方向]
mms_layout: TB
mms_desc: 父节点在上，子节点向下展开（Top → Bottom）
---

# 后端开发

** 整体按"语言 → 数据 → 部署"三段式推进；每段单独抽时间做调研

## 运行时

### Node.js

TypeScript 已经是标配。

** 注意 Node 版本兼容性，建议 LTS

### Go

云原生首选，启动快。

### Python

AI / 数据场景优势明显。

## 数据库

### 关系型

#### PostgreSQL

** 复杂查询首选

#### MySQL

OLTP 场景成熟稳定。

### NoSQL

#### MongoDB

文档型数据库。

#### Redis

** 缓存与队列场景一把抓

## 部署

### Docker

容器化的事实标准。

### Kubernetes

** 学习曲线陡，按需引入

### Serverless

适合事件驱动型业务。
