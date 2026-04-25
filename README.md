# Apple Consistency 评估工具 — 设计规则作业说明

> **在线预览**：[https://dingzhen-zhr.github.io/apple-consistency-evaluator/](https://dingzhen-zhr.github.io/apple-consistency-evaluator/)

---

## 一、设计规则选择与研究对象

### 1.1 规则选择：一致性（Consistency）

本作业选择 **《通用设计法则》中的"一致性（Consistency）"** 原则作为评估对象。Apple HIG（Human Interface Guidelines）将一致性分为：

- **视觉一致性**：相同类型的元素应使用一致的颜色令牌、圆角、间距与字型比例；
- **功能一致性**：相似的行为应映射到相同的视觉表示，降低用户的学习成本；
- **外部一致性**：界面风格应与平台规范对齐，使用户能迁移已有的平台经验。

在 Apple 生态中，一致性失败的直接表现包括：色板中存在近似但非完全相同的颜色（色彩漂移）、按钮/卡片圆角半径不统一、间距未对齐到 4pt 网格、字号层级过多或比例混乱。

### 1.2 研究对象：移动端 UI 截图

选择 **iOS/Android 移动端 UI 截图** 作为研究对象，原因如下：

1. 移动端截图的视觉元素密度适中，适合用计算机视觉方法自动提取结构特征；
2. Apple HIG 明确给出了间距（4pt 网格）、圆角（8/12/16px 标准集合）和字型（SF 字型系统）的量化规范，可作为评分基准；
3. 不同品牌在一致性上存在显著差异，有助于验证评估系统的区分度。

---

## 二、可计算维度拆解

本系统将"一致性"操作化为 **双轴坐标系**：

| 轴 | 含义 | 评分范围 |
|---|---|---|
| **X 轴：Clarity 视觉清晰度** | 界面视觉元素的复杂度（越右越简洁） | 0–100 |
| **Y 轴：Consistency 设计一致性** | 颜色/间距/圆角/字型的规范一致程度（越上越统一） | 0–100 |

### 2.1 Clarity（X 轴）— 视觉复杂度分析

基于 **Sha et al. (2025)** 的视觉复杂度公式：

- X1 = 图标计数（Canny 边缘 + 轮廓过滤）
- X2 = 文本块计数（形态学 Blackhat+Tophat + 连通域分析）
- X3 = 图片区域计数（大轮廓检测）
- X4 = RGB 多通道香农熵

clarity_score = (1 - 归一化后的复杂度值) × 100。

### 2.2 Consistency（Y 轴）— 四维一致性加权

Consistency = 0.30 × 色彩 + 0.30 × 间距 + 0.20 × 圆角 + 0.20 × 字型

各子维度定义：

**色彩一致性（ColorConsistency）**：K-means（k=8）Lab 色彩空间聚类，计算 palette_compactness、semantic_gap、near_color_pairs（ΔE≤10 的近似色对数量）。

**间距与网格一致性（SpacingAndGridConsistency）**：提取 UI 块间距，与 4pt 网格（4/8/12/16/24/32px）对齐，计算 grid_alignment_ratio、mean_deviation_px、margin_std_px。

**组件样式一致性（ComponentStyleConsistency）**：最小二乘圆弧拟合估计圆角半径，计算 radius_cv（变异系数）和 apple_modal_match。

**字体排版一致性（TypographyConsistency）**：KDE 峰值检测字号层数，计算 tier_count、scale_harmony、apple_match_ratio。

---

## 三、系统工程架构

```
personal_work/
├── frontend/                   # 纯 HTML+JS 前端（GitHub Pages 部署）
│   ├── index.html              # 主页面
│   ├── app.js                  # 主逻辑（上传、渲染、散点图交互）
│   ├── analyze.js              # 浏览器端降级分析（无后端时可用）
│   ├── scatter-chart.js        # SVG 散点图（95% 置信椭圆、品牌颜色）
│   ├── reference-data.json     # 76 张品牌截图预计算坐标
│   └── styles.css              # 样式
│
└── backend/                    # FastAPI 后端（本地/云端部署）
    ├── app/
    │   ├── main.py             # API 入口（/api/analyze, /api/ai/explain）
    │   ├── models.py           # Pydantic 数据模型
    │   ├── scoring.py          # 评分、子指标生成、总结、改进建议
    │   ├── analyzers/          # 四个一致性分析器
    │   └── ai/                 # DeepSeek 增强分析
    └── batch_analyze.py        # 批量分析生成参考数据
```

**技术栈**：Python 3.11 · FastAPI · OpenCV · NumPy · scikit-learn · Pillow · Pydantic v2 · DeepSeek API · 纯 ES6 JS（无框架）

---

## 四、输出结构与可解释性设计

### 4.1 置信度字段

`confidence` 字段基于检测到的元素数量评估分析稳定性：
- **high**：总检测量 ≥ 80；**medium**：25–79；**low**：< 25，结果仅供参考。

### 4.2 子指标可追溯性

每个维度下的每条子指标（`SubMetric`）包含：
- `raw_value`：未经处理的原始计算值
- `unit`：物理单位（如 px、ΔE、比例）
- `normalized_score`：归一化到 0–100 的得分
- `formula`：使用的计算公式文字描述
- `interpretation`：当前值对应的语义解读

### 4.3 自动生成的总结字段

- `overall_summary`：综合评价文字（当前水平 + 各维度表现）
- `priority_improvements`：最多 3 条优先改进建议（具体到数值与规则）
- `detection_summary`：检测到的图标数、文本块数、色彩聚类数等检测摘要

---

## 五、参考数据与品牌基准

通过批量分析 76 张截图生成参考数据，当前品牌基准：

| 品牌 | 截图数 | 平均 Clarity | 平均 Consistency |
|---|---|---|---|
| Apple | 18 | ~49 | ~65 |
| Google | 14 | ~55 | ~61 |
| 华为 | 12 | ~47 | ~58 |
| 小米 | 13 | ~51 | ~56 |
| OPPO | 10 | ~53 | ~62 |

散点图中每个品牌显示平均坐标点 + 95% 置信椭圆，便于对比不同品牌的设计风格定位。

---

## 六、AI 增强分析模块

集成 **DeepSeek API** 对评估结果进行深度解释：将 CV 分析结果打包为结构化 prompt，要求输出论文级原因分析与可执行建议（具体到数值/规则/阈值，禁止模糊表述）。

---

## 七、如何在本地运行

### 后端（完整 CV 分析模式）

```bash
cd backend
pip install -r requirements.txt
# 创建 .env 文件并填入 DEEPSEEK_API_KEY=sk-xxxx
uvicorn app.main:app --reload --port 8000
```

### 纯前端模式（GitHub Pages）

无需后端，直接访问：**https://dingzhen-zhr.github.io/apple-consistency-evaluator/**

---

## 八、与同类系统的对比分析

| 特性 | 本系统（一致性评估） | 同类系统（层次评估）|
|---|---|---|
| 评估维度 | 双轴：Clarity × Consistency | 三轴：视觉显著性差异 / 分组分离度 / 对齐一致性 |
| 技术路线 | OpenCV CV + DeepSeek 文本解释 | OpenCV CV + 多模态 LLM 视觉判断 |
| 置信度字段 | ✅ 基于检测元素数量 | ✅ 基于检测元素数量 + LLM 调用状态 |
| 子指标可追溯 | ✅ raw_value + formula + interpretation | ✅ raw_value + unit + formula + interpretation |
| 总结生成 | ✅ overall_summary（自动生成） | ✅ hierarchy_summary（自动生成） |
| 优先改进建议 | ✅ priority_improvements（最多3条） | ✅ priority_improvements（最多3条） |
| 品牌基准对比 | ✅ 76张参考图 + 95%椭圆 | ✅ 品牌层次方法论提取 |

---

## 九、参考文献

1. Apple Inc. *Human Interface Guidelines*. https://developer.apple.com/design/human-interface-guidelines/
2. Sha Q et al. "Quantifying Visual Complexity of Smartphone User Interfaces." *MDPI Electronics* 14(5):942, 2025.
3. Miniukovich A, De Angeli A. "Computation of Interface Aesthetics." *CHI 2014*.
4. Nielsen J. *Usability Engineering*. Academic Press, 1994.
5. Tractinsky N, Katz A S, Ikar D. "What is beautiful is usable." *Interacting with Computers* 13(2):127–145, 2000.
6. Gordon K. "Visual Hierarchy in UX." Nielsen Norman Group, 2021.
7. Urano Y et al. "Visual Hierarchy Relates to Impressions of Good Design." *ACM CHI Workshop*, 2021.