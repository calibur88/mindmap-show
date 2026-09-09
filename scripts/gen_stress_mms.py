#!/usr/bin/env python3
"""生成大规模随机 .mms 压测文件（纯 Python 标准库，无第三方依赖）。

用于渲染性能压测：在 Obsidian 中打开生成的文件，切换探索/全景视图、
缩放拖拽、点击折叠徽标，观察大量节点下的交互流畅度。

用法示例：
    python scripts/gen_stress_mms.py --nodes 500 --out test-vault-local/压测-500.mms
    python scripts/gen_stress_mms.py --nodes 2000 --max-depth 6 --max-children 4 --seed 7
    python scripts/gen_stress_mms.py --nodes 300 --no-directives   # 纯净树，不撒指令

生成内容：
    - frontmatter（mms_name / mms_layout）
    - 随机树（根 + 标题层级子节点，深度与扇出受参数控制）
    - 每节点随机正文行、注释行
    - 默认小概率撒合法指令（color / line-width / opacity / collapsed / debug / locked），
      均为规范 §10.7 白名单 key，值经校验合法
"""

import argparse
import random
import sys
from pathlib import Path

# 文本池：节点标题 / 正文 / 注释
TITLE_WORDS = [
    "需求梳理", "架构设计", "接口联调", "数据建模", "权限体系", "消息推送",
    "缓存策略", "灰度发布", "监控告警", "日志归档", "任务调度", "索引优化",
    "容灾演练", "成本核算", "安全审计", "埋点分析", "回归测试", "文档沉淀",
    "组件拆分", "状态管理", "路由守卫", "表单校验", "长列表渲染", "断点续传",
]
CONTENT_LINES = [
    "本周完成初版方案评审，遗留两点待确认。",
    "依赖上游接口的灰度放量节奏，预计下周三对齐。",
    "历史包袱集中在旧版权限模型，迁移脚本已就绪。",
    "压测口径：P99 延迟 250ms 以内，错误率万分之一以下。",
    "需要 DBA 配合做一次索引重建，窗口期选在凌晨。",
    "边界场景覆盖了离线编辑与多端同步冲突。",
    "方案 B 的存储成本高 18%，但查询延迟减半。",
    "先内部试用两周，收集反馈后再扩大范围。",
]
ANNOTATIONS = [
    "口径以最新评审纪要为准。",
    "该项与上一节点互斥，二选一。",
    "数字为估算值，上线前复核。",
    "责任人待定，先占位。",
]
# 指令撒点：key -> 值生成器（全部为规范 §10.7 白名单内的合法值）
DIRECTIVE_POOL = [
    ("color", lambda rng: rng.choice(["#E74C3C", "#2C3E50", "#27AE60", "#8E44AD", "#E67E22"])),
    ("line-width", lambda rng: rng.choice(["1.5", "2", "3"])),
    ("opacity", lambda rng: rng.choice(["0.5", "0.75", "0.9"])),
    ("collapsed", lambda rng: "true"),
    ("debug", lambda rng: "true"),
    ("locked", lambda rng: "true"),
]
DIRECTIVE_PROB = 0.06  # 每个节点撒指令的概率


def gen_tree(rng: random.Random, budget: int, max_depth: int, max_children: int) -> list[str]:
    """生成随机树的正文行（不含 frontmatter），返回行列表。budget 为总节点数。"""
    lines: list[str] = []
    remaining = budget - 1  # 根节点占 1 个

    def fill_node(depth: int) -> None:
        """输出一个 depth 级节点（# 个数 = depth）及其整个子树。"""
        nonlocal remaining
        title = f"{rng.choice(TITLE_WORDS)}-{remaining:04d}"
        lines.append(f"{'#' * (depth + 1)} {title}")
        remaining -= 1
        # 指令（默认绑定到上方最近节点，即刚声明的这个标题）
        if rng.random() < DIRECTIVE_PROB:
            key, gen = rng.choice(DIRECTIVE_POOL)
            lines.append(f"!-- {key} > {gen(rng)}")
        # 正文 0~2 行
        for _ in range(rng.randint(0, 2)):
            lines.append(rng.choice(CONTENT_LINES))
        # 注释（小概率）
        if rng.random() < 0.15:
            lines.append(f"** {rng.choice(ANNOTATIONS)}")
        # 子节点
        if depth + 1 < max_depth and remaining > 0:
            for _ in range(rng.randint(1, min(max_children, remaining))):
                if remaining <= 0:
                    break
                fill_node(depth + 1)

    lines.append(f"# 根节点-{budget:04d}")
    while remaining > 0:
        fill_node(1)
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="生成大规模随机 .mms 压测文件（纯标准库）")
    parser.add_argument("--nodes", type=int, default=300, help="总节点数（默认 300）")
    parser.add_argument("--max-depth", type=int, default=5, help="最大标题深度（默认 5）")
    parser.add_argument("--max-children", type=int, default=5, help="每节点最大子节点数（默认 5）")
    parser.add_argument("--layout", choices=["TB", "BT", "LR", "RL"], default="LR", help="布局方向（默认 LR）")
    parser.add_argument("--seed", type=int, default=42, help="随机种子，可复现（默认 42）")
    parser.add_argument("--no-directives", action="store_true", help="不撒指令，生成纯净树")
    parser.add_argument("--out", type=Path, default=Path("stress.mms"), help="输出路径（默认 ./stress.mms）")
    args = parser.parse_args()

    if args.nodes < 2:
        print("错误：--nodes 至少为 2（根节点 + 1 个子节点）", file=sys.stderr)
        return 1
    if args.max_depth < 1 or args.max_children < 1:
        print("错误：--max-depth 与 --max-children 至少为 1", file=sys.stderr)
        return 1

    global DIRECTIVE_PROB
    if args.no_directives:
        DIRECTIVE_PROB = 0.0

    rng = random.Random(args.seed)
    body = gen_tree(rng, args.nodes, args.max_depth, args.max_children)

    frontmatter = [
        "---",
        "mms_name: 压测-" + str(args.nodes),
        f"mms_layout: {args.layout}",
        "---",
        "",
    ]
    text = "\n".join(frontmatter + body) + "\n"

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")

    real_nodes = sum(1 for ln in body if ln.startswith("#"))
    print(f"已生成 {args.out}：{real_nodes} 个节点 / {len(body)} 行 / {len(text.encode('utf-8')) / 1024:.1f} KB")
    print(f"参数：nodes={args.nodes} max-depth={args.max_depth} max-children={args.max_children} "
          f"layout={args.layout} seed={args.seed} directives={'off' if args.no_directives else 'on'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
