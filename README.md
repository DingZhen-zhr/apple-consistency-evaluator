# 一致性原则评估工具（个人作业）

本项目实现一个基于 **Apple 一致性（Consistency）原则** 的移动端界面截图评估工具：上传截图后输出 **分数 + 问题清单 + 可视化标注报告**，并支持导出（HTML）。

## 作业选题说明（Apple Consistency）

一致性原则关注：同类元素在不同页面/不同模块中是否保持 **同一套设计 token 与组件样式**（颜色、字号层级、间距网格、圆角/阴影等）。  
本项目尽量避免“只把图片发给 LLM”的黑箱方式，而是用 **可计算的度量** 给出证据（离群点/分布/漂移），再生成可解释建议。

## 运行方式

### 后端（FastAPI）

在 `backend/` 下安装依赖并启动：

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --port 8010
```

打开 `http://127.0.0.1:8010/`（会跳转到 `/ui/`）。

> 说明：如果你机器上 `8000` 端口被占用或无权限，可继续使用 `8010`。

## 输出与产物

- **在线查看**：上传后前端会展示总分、维度分、问题清单；点击“打开 HTML 报告”可查看带标注的报告。
- **落盘产物**：每次分析会生成一个 `run_id`，并把产物保存到 `runs/<run_id>/`（相对 `personal_work/` 根目录）：
  - `report.html`：可下载/可分享的报告
  - `result.json`：结构化结果（便于写作业分析与复现）
  - `input_1.png`：第 1 张输入截图备份

## 设计原则与检测维度（Consistency）

当前版本实现的 **可计算一致性度量**（不依赖 LLM）：  
- **ColorConsistency**：聚类提取调色板，检测“近似色漂移”（极其相近但不同的颜色同时存在）。  
- **SpacingAndGridConsistency**：从截图中启发式提取 UI 块，统计相邻块的间距并检查是否偏离 **8pt 网格**。
- **TypographyConsistency**：黑帽形态学 + 连通域，估计文本高度层级数量（层级过多通常意味着字号 token 未收敛）。  
- **ComponentStyleConsistency**：候选组件块的角落像素差异估计圆角半径分布，检测圆角 token 离群点。  
- **CrossScreenConsistency（多图时）**：跨页面对比主色与圆角风格的漂移（用于体现“跨屏一致性”）。

## 分数解释（简化版）

- 每个维度从 \(100\) 分开始，按问题严重程度扣分（low/medium/high）。
- 总分为维度分的均值（便于在作业中解释“哪类一致性问题影响最大”）。

## 一致性双轴散点图（浏览器本地）

页面中的散点图横轴、纵轴分别对应两类一致性指标（由维度分聚合而成）：

- **横轴**：视觉与组件一致性（`ColorConsistency` + `ComponentStyleConsistency` 的均值）
- **纵轴**：布局与信息层级一致性（`SpacingAndGridConsistency` + `TypographyConsistency` 的均值）

绿色区域表示 **双轴得分均 ≥ 70** 的「Apple 一致区」（与「是否符合苹果一致性原则」的高一致判断相对应；仍为启发式）。  
**蓝色**点为内置参考界面（不可删除，带缩略图）；参考点的坐标会在页面启动后用**同一套分析算法对参考图片实际计算**（并缓存到 localStorage，避免每次都重复算）。  
每次评估会在图中增加 **橙色** 你的上传记录（可点击选中并删除）。数据保存在浏览器 **localStorage**，刷新/再次打开页面仍会保留。

参考素材的署名与许可见 [`ASSETS_ATTRIBUTION.md`](ASSETS_ATTRIBUTION.md)。

## 让老师在线访问（GitHub Pages，纯静态/浏览器本地计算）

本作业的 Web 界面是 **纯静态站点**：分析逻辑在浏览器里完成（不上传图片到任何服务器），因此 **不需要 Render / 不需要后端云部署** 也能完整演示功能。

### A) 用 GitHub Pages 发布（推荐交作业方式）

1. 确保仓库已 push 到 GitHub（见下方“上传到 GitHub”）。
2. 在 GitHub 仓库 **Settings → Pages**：
   - **Build and deployment**：选择 **GitHub Actions**
3. push 到 `main` 分支后会触发工作流：[`.github/workflows/pages.yml`](.github/workflows/pages.yml)

发布后，老师一般通过如下地址访问（示例）：

`https://dingzhen-zhr.github.io/apple-consistency-evaluator/`

### B) 关于“不要任何人都能访问”

GitHub Pages 的站点链接 **本质上是公网可访问的**（知道链接的人就能打开），GitHub **不会**为免费账号提供“只有某个老师能打开、但又不登录”的 Pages 访问控制。

如果你必须做到强访问控制，常见替代方案是：

- 把仓库设为 **Private**，只邀请老师为协作者；老师用 **GitHub Codespaces / 本地运行** 打开页面（不走公网 Pages）
- 或学校提供的私有托管/内网部署

### C)（可选）仍然想保留 FastAPI 后端

仓库里的 `backend/` 仍可本地运行（用于开发/扩展），但它不是 GitHub Pages 方案的必要条件。  
仓库根目录的 [`render.yaml`](render.yaml) 也仅作为“可选云端后端”的模板，不是本作业默认路径。

## 上传到 GitHub（把本目录作为独立仓库）

在 `personal_work/` 目录执行：

```bash
git init
git branch -M main
git add .
git commit -m "Add Apple consistency evaluator (FastAPI + static UI)"
git remote add origin https://github.com/DingZhen-zhr/apple-consistency-evaluator.git
git push -u origin main
```

> 说明：我无法代替你完成 `git push` 的登录授权；你需要在本机完成一次 GitHub 登录（HTTPS PAT 或 SSH key）。
>
> 另外：请先在 GitHub 上创建 **同名空仓库** `apple-consistency-evaluator`（建议 Public）。  
> 如果你想用别的仓库名，把上面 `git remote add origin ...` 的 URL 改成你的仓库即可。

