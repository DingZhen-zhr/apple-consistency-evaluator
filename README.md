# Apple Consistency Evaluator
> 多品牌 UI 设计一致性评测系统 — 工业设计专业课作业

**GitHub Pages 在线体验：** https://dingzhen-zhr.github.io/apple-consistency-evaluator/

---

## 目录

1. [项目背景与目标](#1-项目背景与目标)
2. [评测方法论](#2-评测方法论)
3. [五维度算法详解](#3-五维度算法详解)
4. [评级系统](#4-评级系统)
5. [品牌对比分析](#5-品牌对比分析)
6. [系统架构](#6-系统架构)
7. [本地运行指南](#7-本地运行指南)
8. [与同学方案对比](#8-与同学方案对比)
9. [文件结构](#9-文件结构)

---

## 1 项目背景与目标

现代数字产品的视觉品质越来越依赖"设计一致性"——按钮、间距、配色、字体是否在同一套体系内保持和谐。本项目以 **Apple iOS 设计规范**为锚点，构建了一套可量化的多品牌 UI 一致性评测系统：

- 上传任意 UI 截图，系统在约 **2–5 秒**内输出多维度得分与详细问题报告
- 内置 **76 张品牌参考截图**（Apple / Google / 华为 / 小米 / OPPO），可直接横向比较
- 采用 **计算机视觉（无需训练）** 算法：HOG 梯度熵、形态学分组、Canny 边缘检测等
- 借鉴同学的创新点，新增 **视觉律动感（VisualRhythm）**维度与 **S/A/B/C/D 评级**

---

## 2 评测方法论

### 2.1 双轴架构

| 轴 | 定义 | 权重 |
|---|---|---|
| **视觉清晰度 Clarity** | 边缘锐度 + 色彩对比 + 噪声抑制 | 0.4 |
| **设计一致性 Consistency** | 五维度加权平均（见下表） | 0.6 |

**综合得分** = 0.4 × 清晰度 + 0.6 × 一致性

### 2.2 五维度权重

| 维度 | 中文名 | 权重 | 核心方法 |
|---|---|---|---|
| ColorConsistency | 色彩一致性 | 0.25 | K-Means 聚类，色彩主题离散度 |
| SpacingAndGridConsistency | 间距/栅格一致性 | 0.25 | Hough 直线检测，间距变异系数 |
| ComponentStyleConsistency | 组件风格一致性 | 0.20 | 轮廓圆角率、形状紧凑度 |
| TypographyConsistency | 排版一致性 | 0.15 | MSER 文字区域，字高比变异系数 |
| **VisualRhythm** | **视觉律动感** | **0.15** | **HOG 梯度熵 + 形态学分组致密度** |

---

## 3 五维度算法详解

### 3.1 色彩一致性（ColorConsistency）

将图像降采样后用 K-Means（k=8）聚类像素，计算主色调在 Lab 色彩空间的离散度：

$$\text{score} = 100 \times \left(1 - \frac{\sigma_{\text{Lab}}}{\sigma_{\max}}\right)$$

当聚类中心分布越集中（主色调统一），分数越高。同时检测高对比色对（ΔE > 40）数量。

### 3.2 间距/栅格一致性（SpacingAndGrid）

对水平与垂直边缘分别做 Hough 线检测，提取相邻线段的间距序列：

$$\text{CV} = \frac{\sigma(\Delta d)}{\mu(\Delta d)}, \quad \text{score} = 100 \times (1 - \min(\text{CV}, 1))$$

变异系数 CV 越小说明间距越均匀，得分越高。

### 3.3 组件风格一致性（ComponentStyle）

检测所有封闭轮廓，统计带圆角组件（圆度 > 0.7）的比例，并计算轮廓面积的变异系数：

$$\text{score} = 0.5 \times r_{\text{round}} \times 100 + 0.5 \times (1 - \text{CV}_{\text{area}}) \times 100$$

### 3.4 排版一致性（Typography）

用 MSER 检测文字候选区，提取各区域的高宽比，计算变异系数与字高分层数量：

$$\text{score} = 100 \times \left(1 - \frac{|\text{层级数} - 3|}{3}\right) \times (1 - \text{CV}_{\text{ratio}})$$

理想情况下界面应有 3 个字级（标题/正文/辅助）。

### 3.5 视觉律动感（VisualRhythm）★ 新增

本维度借鉴同学的**视觉各向异性**思路，融合两个子指标：

#### 3.5.1 HOG 梯度方向熵

对灰度图做 Sobel 梯度，取幅值前 35% 的像素，统计 18-bin（0°–180°）方向直方图，计算 Shannon 熵：

$$H = -\sum_{i=1}^{18} p_i \log_2 p_i, \quad H \in [0, \log_2 18 \approx 4.17]$$

各向**异性度**（方向集中程度）：

$$\text{anisotropy} = 100 \times \left(1 - \frac{H}{\log_2 18}\right)$$

优秀的 UI 设计以水平/垂直方向为主（高各向异性），H 较低，分数较高。

#### 3.5.2 形态学分组致密度

对 Canny 边缘图做形态学闭运算（9×9 核，2 次迭代），通过连通域分析得到 n 个视觉组：

$$D_i = \frac{A_i^{\text{pixels}}}{A_i^{\text{bbox}}}, \quad \text{compactness} = \overline{D_i}$$

组间分离度用归一化平均最近质心距计算：

$$\text{separation} = \text{clip}\!\left(\frac{\bar{d}_{\min}}{0.03 \cdot \text{diag}},\ 0,\ 1\right)$$

最终律动感得分：

$$\text{rhythm\_score} = 0.55 \times \text{anisotropy} + 0.30 \times \text{compactness} \times 100 + 0.15 \times \text{separation} \times 100$$

---

## 4 评级系统

参考 Apple 设计奖评审标准，综合得分对应五级评定：

| 等级 | 阈值 | 含义 |
|---|---|---|
| **S** | ≥ 85 | 卓越，对标 Apple HIG 最高标准 |
| **A** | ≥ 70 | 优秀，设计规范完整 |
| **B** | ≥ 55 | 良好，存在少量不一致 |
| **C** | ≥ 40 | 一般，需改进 |
| **D** | < 40 | 较差，基础规范未遵循 |

---

## 5 品牌对比分析

基于内置的 76 张参考截图（每品牌约 15 张）自动计算以下图表：

### 5.1 多维度得分对比

![品牌多维度对比](docs/charts/chart_01_brand_comparison.png)

### 5.2 得分分布箱线图

![得分分布](docs/charts/chart_02_score_distribution.png)

> 箱线图展示了各品牌得分的中位数、四分位距与极值，反映品牌内部一致性的稳定程度。

### 5.3 设计维度雷达图

![雷达图](docs/charts/chart_03_dimension_radar.png)

> Apple 在排版和色彩维度得分突出；华为在间距一致性上表现稳定；Google Material Design 在组件风格上有较高得分。

### 5.4 清晰度 × 一致性散点图

![散点图](docs/charts/chart_04_scatter_all.png)

> 散点附带 95% 置信椭圆，反映品牌整体聚集程度。Apple 置信椭圆最小，说明其设计系统最稳定。

---

## 6 系统架构

```
personal_work/
├── backend/               # FastAPI 后端（Python 3.11）
│   ├── app/
│   │   ├── analyzers/     # 五个 CV 分析器
│   │   │   ├── color_consistency.py
│   │   │   ├── spacing_grid.py
│   │   │   ├── typography.py
│   │   │   ├── component_style.py
│   │   │   └── visual_rhythm.py   ★ 新增
│   │   ├── ai/            # DeepSeek API 智能解读
│   │   ├── scoring.py     # 加权评分 + 评级逻辑
│   │   ├── models.py      # Pydantic 数据模型
│   │   └── main.py        # FastAPI 入口
│   └── generate_charts.py # 图表生成脚本
├── frontend/              # 纯 ES6 前端（无框架）
│   ├── app.js             # 主交互逻辑
│   ├── scatter-chart.js   # SVG 散点图
│   └── reference-data.json  # 76 张预计算参考数据
└── docs/
    └── charts/            # 自动生成的 PNG 图表
```

### API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/analyze` | 上传图片，返回完整分析结果（含 grade） |
| `GET`  | `/health`  | 服务健康检查 |

### 返回结构（简化）

```json
{
  "overall_score": 72.4,
  "grade": "A",
  "clarity_score": 68.1,
  "consistency_score": 75.3,
  "confidence": 0.83,
  "dimensions": {
    "ColorConsistency": { "score": 78, "issues": [...], "sub_metrics": [...] },
    "VisualRhythm":     { "score": 65, "features": { "hog_entropy": 2.8, "anisotropy_score": 33 } }
  }
}
```

---

## 7 本地运行指南

### 环境要求

- Python 3.11+，依赖见 `backend/requirements.txt`
- 主要包：`fastapi uvicorn opencv-python scikit-learn Pillow matplotlib`

### 启动步骤

```bash
# 1. 安装依赖
cd backend
pip install -r requirements.txt

# 2. 配置 DeepSeek API（可选，无 key 时跳过 AI 解读）
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

# 3. 启动后端
uvicorn app.main:app --reload --port 8000

# 4. 浏览器打开前端
# 直接用 VS Code Live Server 或静态文件服务打开 frontend/index.html
```

### 生成图表

```bash
cd backend
python generate_charts.py
# 输出到 ../docs/charts/*.png
```

---

## 8 与同学方案对比

| 特性 | 本方案 | 同学 A（Glanceability） | 同学 B（视觉各向异性） |
|---|---|---|---|
| 评测维度数 | **5** | 3（扫视性/视觉层次/信息密度） | 2（各向异性/边缘密度） |
| 评级系统 | **S/A/B/C/D**（借鉴 A） | S/A/B/C/D ✓ | 无 |
| HOG 方向分析 | **✓**（借鉴 B） | ✗ | ✓ |
| 形态学分组 | **✓**（新增） | ✗ | 部分 |
| 多品牌对比 | **✓**（76张参考库） | ✗ | ✗ |
| AI 文字解读 | **✓**（DeepSeek） | ✗ | ✗ |
| 前端可视化 | **✓**（散点图/雷达图） | 基础 | ✗ |
| 无需模型训练 | **✓** | ✓ | ✓ |

**借鉴说明：**
- 从同学 B 的**视觉各向异性**方法中提取了 HOG 梯度熵 + 形态学闭运算分组的思路，融合为本系统的 VisualRhythm 维度
- 从同学 A 的**Glanceability 评分体系**中借鉴了 S/A/B/C/D 五级评定阈值设计（85/70/55/40），并增加了子指标置信度

---

## 9 文件结构

```
frontend/reference-data.json   # 76 张预计算品牌截图数据
frontend/assets/reference/     # 原始品牌截图（apple/google/huawei/xiaomi/oppo）
backend/app/analyzers/         # 5 个独立 CV 分析器模块
backend/app/scoring.py         # 加权评分 + 评级 + 子指标说明
backend/app/models.py          # AnalysisResult / DimensionScore / SubMetric
docs/charts/                   # 自动生成的品牌对比图表（PNG）
```

---

*本项目为工业设计专业"信息与交互"课程个人作业。算法设计参考 Apple Human Interface Guidelines，数据仅供学术研究使用。*