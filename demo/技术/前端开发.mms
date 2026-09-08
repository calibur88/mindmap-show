---
mms_tags: [技术, 前端]
mms_layout: LR
---

# 前端开发

React 仍是主力，Vue 在新项目里也开始试点。

** 选型看团队情况而定，不要强行统一

## 框架选型

** 框架没有银弹，按场景选合适的

### React

** Hooks 体系已经成熟，优先用函数组件

#### Hooks

useState / useEffect / useMemo / useCallback。

** useMemo 不要过度依赖，常见性能陷阱

#### Server Components

RSC 还在演进，关注官方文档。

### Vue

Composition API 是主推方向。

### Svelte

适合小工具和性能敏感场景。

## 构建工具

### Vite

启动快，适合现代项目。

### Webpack

生态最广，老项目首选。

### Turbopack

新兴方案，尚不稳定。

## 样式方案

### Tailwind CSS

** 适合组件库密集场景

### CSS Modules

简单可靠。

### styled-components

CSS-in-JS 的代表，适合 React 生态。
