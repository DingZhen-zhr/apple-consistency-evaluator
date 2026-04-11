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

## 让老师在线访问（GitHub Pages + 云端 API）

GitHub Pages **只能托管静态文件**（HTML/CSS/JS），无法直接运行 FastAPI。  
因此推荐组合是：

- **前端**：部署到 GitHub Pages（公开 `https://<你的用户名>.github.io/<仓库名>/`）
- **后端**：部署到 Render（公开 `https://xxx.onrender.com`），并在 GitHub 仓库变量里告诉前端去调用它

### A) 部署后端到 Render（推荐）

1. 在 GitHub 新建一个空仓库（建议设为 **Public**），把本目录 push 上去（见下方“上传到 GitHub”）。
2. 打开 Render，创建 **Web Service**，连接你的 GitHub 仓库。
3. Render 里使用仓库根目录的 [`render.yaml`](render.yaml)（或手动设置）：
   - **Root Directory**：`backend`
   - **Build**：`pip install -r requirements.txt`
   - **Start**：`uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. 部署完成后，你会得到一个公网地址，例如：`https://apple-consistency-api.onrender.com`

可选：为了更安全，你可以在 Render 设置环境变量 `CORS_ALLOW_ORIGINS` 为你的 GitHub Pages 精确地址（逗号分隔）。

### B) 部署前端到 GitHub Pages

1. 在 GitHub 仓库 **Settings → Pages**：
   - **Build and deployment**：选择 **GitHub Actions**
2. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 新增变量：
   - `PUBLIC_API_BASE` = 你在 Render 上的后端地址（**不要**末尾 `/`）
3. push 到 `main` 分支后会触发工作流：[`.github/workflows/pages.yml`](.github/workflows/pages.yml)

### C) 本地静态前端如何指向后端（可选）

直接编辑 [`frontend/config.js`](frontend/config.js)，把 `window.__API_BASE__` 改成你的 Render 地址（不要末尾 `/`）。  
GitHub Pages 部署时，GitHub Actions 会自动覆盖生成 `frontend/config.js`（见工作流文件）。

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

