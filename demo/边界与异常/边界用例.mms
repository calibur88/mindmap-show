---
mms_name: 边界用例
mms_tags: [示例, 边界与异常]
mms_layout: XX
mms_line: ZZ
mms_desc: mms_layout 为非法值 XX 应回退 LR，mms_line 为非法值 ZZ 应回退 line
---

## 没有根节点的一级节点

首个标题就是 depth 1，被解析器自动降级为根节点，记 no-root 警告。

** 没有 # 标题就拿首个标题兜底

-- 子节点 A

** 第一个子，正常解析

-- 子节点 A

** 同名兄弟节点触发 duplicate-merge 警告

-- 子节点 B

<=> 并不存在的目标    这条应记 missing-target 警告，虚线不渲染

** 虚线指向不存在的目标，会在调试信息里记一条 missing-target

<=> 综合演示/用户增长脑图.mms 首单转化    跨文件引用，前向引用 OK

** 这个引用会画一条虚线连过去，证明跨文件引用解析正确

![[这是一个不存在的图片.png]]

** 嵌入的文件不存在不影响解析；但调试信息会列出来

![[https://example.com/dashboard.png]]

** 嵌入 URL 当作外链处理
