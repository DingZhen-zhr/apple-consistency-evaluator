"""
生成品牌对比分析图表
输入: ../frontend/reference-data.json
输出: ../docs/charts/*.png
"""
import json, os, math
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import Ellipse
from pathlib import Path

# ── 中文字体 ──────────────────────────────────────────────
plt.rcParams["font.family"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

# ── 路径 ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
DATA_FILE = BASE_DIR / "frontend" / "reference-data.json"
OUT_DIR   = BASE_DIR / "docs" / "charts"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── 颜色映射 ──────────────────────────────────────────────
BRAND_COLORS = {
    "apple":   "#1D1D1F",
    "google":  "#4285F4",
    "huawei":  "#CF0A2C",
    "honor":   "#E4002B",
    "xiaomi":  "#FF6900",
    "oppo":    "#1B7A4E",
    "samsung": "#1428A0",
    "vivo":    "#415FFF",
}
BRAND_CN = {
    "apple":   "Apple",
    "google":  "Google",
    "huawei":  "华为",
    "honor":   "荣耀",
    "xiaomi":  "小米",
    "oppo":    "OPPO",
    "samsung": "三星",
    "vivo":    "vivo",
}

# ── 读数据 ─────────────────────────────────────────────────
with open(DATA_FILE, "r", encoding="utf-8") as f:
    raw = json.load(f)

# 只保留数据中实际存在的品牌，按 BRAND_COLORS 顺序
brands = [b for b in BRAND_COLORS if any(d["brand"] == b for d in raw)]

def by_brand(key):
    return {b: [d[key] for d in raw if d["brand"] == b] for b in brands}

# ── 1. 品牌对比柱状图 ──────────────────────────────────────
def chart_brand_comparison():
    fig, ax = plt.subplots(figsize=(10, 5.5))

    keys  = ["clarity_score", "consistency_score", "color_score", "spacing_score", "typo_score"]
    labels = ["清晰度", "一致性", "色彩", "间距", "排版"]
    x = np.arange(len(brands))
    n = len(keys)
    w = 0.13
    offsets = np.linspace(-(n-1)/2*w, (n-1)/2*w, n)

    for i, (key, lbl) in enumerate(zip(keys, labels)):
        means = [np.mean(by_brand(key)[b]) for b in brands]
        bars = ax.bar(x + offsets[i], means, w, label=lbl)

    ax.set_xticks(x)
    ax.set_xticklabels([BRAND_CN[b] for b in brands], fontsize=12)
    ax.set_ylabel("平均得分", fontsize=12)
    ax.set_title("各品牌多维度得分对比", fontsize=14, fontweight="bold")
    ax.set_ylim(0, 100)
    ax.legend(loc="upper right", fontsize=9)
    ax.grid(axis="y", alpha=0.3)
    ax.spines[["top","right"]].set_visible(False)

    plt.tight_layout()
    out = OUT_DIR / "chart_01_brand_comparison.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out.name}")

# ── 2. 分布箱线图 ─────────────────────────────────────────
def chart_score_distribution():
    fig, axes = plt.subplots(1, 2, figsize=(12, 5.5))

    for ax, key, title in [
        (axes[0], "clarity_score",     "清晰度得分分布"),
        (axes[1], "consistency_score", "一致性得分分布"),
    ]:
        data   = [by_brand(key)[b] for b in brands]
        colors = [BRAND_COLORS[b] for b in brands]
        bp = ax.boxplot(data, patch_artist=True, widths=0.5,
                        medianprops={"color":"white","linewidth":2})
        for patch, color in zip(bp["boxes"], colors):
            patch.set_facecolor(color)
            patch.set_alpha(0.75)
        ax.set_xticks(range(1, len(brands)+1))
        ax.set_xticklabels([BRAND_CN[b] for b in brands], fontsize=11)
        ax.set_ylabel("得分", fontsize=11)
        ax.set_title(title, fontsize=13, fontweight="bold")
        ax.set_ylim(0, 100)
        ax.grid(axis="y", alpha=0.3)
        ax.spines[["top","right"]].set_visible(False)

    plt.suptitle("品牌得分分布（箱线图）", fontsize=14, y=1.01, fontweight="bold")
    plt.tight_layout()
    out = OUT_DIR / "chart_02_score_distribution.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out.name}")

# ── 3. 雷达图 ─────────────────────────────────────────────
def chart_radar():
    dims  = ["color_score","spacing_score","corner_score","typo_score","clarity_score"]
    dnames = ["色彩一致性","间距一致性","组件风格","排版一致性","视觉清晰度"]
    N = len(dims)
    angles = [n / float(N) * 2 * math.pi for n in range(N)]
    angles += angles[:1]

    fig, ax = plt.subplots(figsize=(7, 7), subplot_kw={"polar": True})
    ax.set_theta_offset(math.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(dnames, fontsize=10)
    ax.set_ylim(0, 100)
    ax.set_yticks([20,40,60,80,100])
    ax.set_yticklabels(["20","40","60","80","100"], fontsize=7, alpha=0.6)
    ax.grid(color="grey", alpha=0.2)

    for b in brands:
        vals = [np.mean(by_brand(d)[b]) for d in dims]
        vals += vals[:1]
        ax.plot(angles, vals, color=BRAND_COLORS[b], linewidth=1.8, label=BRAND_CN[b])
        ax.fill(angles, vals, color=BRAND_COLORS[b], alpha=0.08)

    ax.set_title("品牌设计一致性雷达图", fontsize=13, fontweight="bold", pad=15)
    ax.legend(loc="upper right", bbox_to_anchor=(1.3, 1.1), fontsize=9)

    plt.tight_layout()
    out = OUT_DIR / "chart_03_dimension_radar.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out.name}")

# ── 4. 散点图（清晰度 × 一致性，95% 置信椭圆）─────────────
def confidence_ellipse(ax, x, y, color, n_std=2.0, **kwargs):
    if len(x) < 3:
        return
    cov = np.cov(x, y)
    vals, vecs = np.linalg.eigh(cov)
    order = vals.argsort()[::-1]
    vals, vecs = vals[order], vecs[:, order]
    theta = np.degrees(np.arctan2(*vecs[:, 0][::-1]))
    w, h = 2 * n_std * np.sqrt(vals)
    ell = Ellipse(xy=(np.mean(x), np.mean(y)), width=w, height=h,
                  angle=theta, edgecolor=color, facecolor=color,
                  alpha=0.10, linewidth=1.5, **kwargs)
    ax.add_patch(ell)

def chart_scatter():
    fig, ax = plt.subplots(figsize=(9, 7))
    handles = []
    for b in brands:
        xs = np.array(by_brand("clarity_score")[b])
        ys = np.array(by_brand("consistency_score")[b])
        c  = BRAND_COLORS[b]
        ax.scatter(xs, ys, color=c, s=55, alpha=0.75, zorder=3)
        confidence_ellipse(ax, xs, ys, color=c)
        handles.append(mpatches.Patch(color=c, label=BRAND_CN[b]))

    ax.set_xlabel("视觉清晰度得分", fontsize=12)
    ax.set_ylabel("设计一致性得分", fontsize=12)
    ax.set_title("清晰度 × 一致性散点图（95% 置信椭圆）", fontsize=13, fontweight="bold")
    ax.set_xlim(0, 100); ax.set_ylim(0, 100)
    ax.axhline(50, color="grey", linewidth=0.7, linestyle="--", alpha=0.5)
    ax.axvline(50, color="grey", linewidth=0.7, linestyle="--", alpha=0.5)
    ax.legend(handles=handles, fontsize=10, loc="upper left")
    ax.grid(alpha=0.2)
    ax.spines[["top","right"]].set_visible(False)

    plt.tight_layout()
    out = OUT_DIR / "chart_04_scatter_all.png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"  ✓ {out.name}")

# ── 主流程 ─────────────────────────────────────────────────
if __name__ == "__main__":
    print("生成图表中...")
    chart_brand_comparison()
    chart_score_distribution()
    chart_radar()
    chart_scatter()
    print(f"\n全部完成 → {OUT_DIR}")
