import { analyzeFiles, buildReportHtml } from "./analyze.js";
import { computeScatterAxes } from "./metrics.js";
import { loadUserPoints, addUserPoint, removeUserPoint, clearUserPoints } from "./storage.js";
import { createScatterChart } from "./scatter-chart.js";
import { loadPhotoManifest, groupImagesByBrand } from "./brand-dataset.js";
import { REFERENCE_POINTS, loadReferenceData } from "./reference-points.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderResult(result) {
  $("score").textContent = result.overall_score.toFixed(1);

  // ── Confidence badge ──
  const confMap = { high: "高置信度", medium: "中置信度", low: "低置信度" };
  const confClass = { high: "confHigh", medium: "confMed", low: "confLow" };
  const conf = result.confidence || "medium";
  const scoreEl = $("score");
  let confBadge = document.getElementById("confBadge");
  if (!confBadge) {
    confBadge = el("span", "confBadge");
    confBadge.id = "confBadge";
    scoreEl.parentNode.insertBefore(confBadge, scoreEl.nextSibling);
  }
  confBadge.textContent = confMap[conf] || conf;
  confBadge.className = "confBadge " + (confClass[conf] || "confMed");

  // ── Detection summary ──
  const ds = result.detection_summary || {};
  let detEl = document.getElementById("detectionSummary");
  if (!detEl) {
    detEl = el("div", "detectionSummary");
    detEl.id = "detectionSummary";
    scoreEl.parentNode.insertBefore(detEl, confBadge.nextSibling);
  }
  if (ds.image_width) {
    detEl.textContent = `检测摘要：${ds.image_width}×${ds.image_height}px · 图标${ds.detected_icons}个 · 文本块${ds.detected_text_elements}块 · 图片区域${ds.detected_image_regions}块 · 色彩聚类${ds.color_clusters}个 · 圆角组件${ds.corner_components}个`;
  }

  // ── Overall summary ──
  let summaryEl = document.getElementById("overallSummary");
  if (!summaryEl) {
    summaryEl = el("div", "overallSummary");
    summaryEl.id = "overallSummary";
    detEl.parentNode.insertBefore(summaryEl, detEl.nextSibling);
  }
  summaryEl.textContent = result.overall_summary || "";

  // ── Priority improvements ──
  let prioEl = document.getElementById("priorityImprovements");
  if (!prioEl) {
    prioEl = el("div", "priorityBlock");
    prioEl.id = "priorityImprovements";
    summaryEl.parentNode.insertBefore(prioEl, summaryEl.nextSibling);
  }
  prioEl.innerHTML = "";
  const improvements = result.priority_improvements || [];
  if (improvements.length > 0) {
    const title = el("div", "priorityTitle", "⬆ 优先改进建议");
    prioEl.appendChild(title);
    improvements.forEach((imp, i) => {
      const item = el("div", "priorityItem", `${i + 1}. ${imp}`);
      prioEl.appendChild(item);
    });
  }

  // ── Dimension scores (enhanced with metrics) ──
  const dims = $("dims");
  dims.innerHTML = "";
  for (const d of result.dimension_scores || []) {
    const row = el("div", "dim");
    const scoreBar = el("div", "dimHeader");
    scoreBar.appendChild(el("div", "dimName", d.dimension));
    const scoreNum = el("div", "dimScore", d.score.toFixed(1));
    scoreNum.style.color = d.score >= 75 ? "#30b050" : d.score >= 55 ? "#e09020" : "#d04040";
    scoreBar.appendChild(scoreNum);
    row.appendChild(scoreBar);

    if (d.judgment) {
      row.appendChild(el("div", "dimJudgment", d.judgment));
    }

    // Evidence list
    if (d.evidence && d.evidence.length > 0) {
      const evDiv = el("div", "dimEvidence");
      d.evidence.forEach(ev => {
        const evItem = el("div", "dimEvidenceItem", "• " + ev);
        evDiv.appendChild(evItem);
      });
      row.appendChild(evDiv);
    }

    // Sub-metrics table (expandable)
    if (d.metrics && d.metrics.length > 0) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `子指标明细（${d.metrics.length} 项）`;
      summary.style.cursor = "pointer";
      summary.style.fontSize = "12px";
      summary.style.color = "#888";
      details.appendChild(summary);
      const table = document.createElement("table");
      table.className = "metricsTable";
      const thead = document.createElement("thead");
      thead.innerHTML = `<tr><th>指标</th><th>原始值</th><th>单位</th><th>归一化分</th><th>解读</th></tr>`;
      table.appendChild(thead);
      const tbody = document.createElement("tbody");
      for (const m of d.metrics) {
        const tr = document.createElement("tr");
        const nsColor = m.normalized_score >= 70 ? "#30b050" : m.normalized_score >= 45 ? "#e09020" : "#d04040";
        tr.innerHTML = `
          <td title="${m.formula}">${m.key}</td>
          <td>${m.raw_value}</td>
          <td>${m.unit}</td>
          <td style="color:${nsColor};font-weight:600">${m.normalized_score.toFixed(1)}</td>
          <td>${m.interpretation}</td>`;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      details.appendChild(table);
      row.appendChild(details);
    }

    dims.appendChild(row);
  }

  const issues = $("issues");
  issues.innerHTML = "";
  if (!result.issues || result.issues.length === 0) {
    issues.appendChild(el("div", "hint", "未检测到明显的一致性问题（或当前截图可计算信号不足）。"));
    return;
  }
  for (const it of result.issues) {
    const card = el("div", "issue");
    const top = el("div", "issueTop");
    top.appendChild(el("div", "issueTitle", it.title));
    top.appendChild(el("div", "badge", `${it.dimension} · ${it.severity}`));
    card.appendChild(top);
    card.appendChild(el("div", "issueSuggest", `建议：${it.suggestion}`));

    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "证据（展开）";
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.marginTop = "8px";
    pre.textContent = JSON.stringify(it.evidence || {}, null, 2);
    details.appendChild(pre);
    card.appendChild(details);

    issues.appendChild(card);
  }

  // Axis explain (for user upload)
  const axes = computeScatterAxes(result);
  const hint = $("hint");
  if (hint && axes?.explain) {
    const e = axes.explain;
    const lines = [
      `双轴解释：X=${axes.x.toFixed(1)}（Clarity 清晰度），Y=${axes.y.toFixed(1)}（Consistency 一致性）`,
      `- Clarity（清晰度）：${e.clarity_score ?? "—"}`,
      `- 颜色一致性：${e.color_score ?? "—"}`,
      `- 间距网格：${e.spacing_score ?? "—"}`,
      `- 圆角风格：${e.corner_score ?? "—"}`,
      `- 排版层级：${e.typo_score ?? "—"}`,
      `公式：${e.formula || ""}`,
    ];
    hint.innerHTML = `${escapeHtml(lines.join("\n"))}`.replaceAll("\n", "<br/>");
  }
}

let __lastDownloadUrls = [];

function revokeLastDownloads() {
  for (const u of __lastDownloadUrls) {
    try {
      URL.revokeObjectURL(u);
    } catch {
      // ignore
    }
  }
  __lastDownloadUrls = [];
}

async function analyze() {
  const input = $("file");
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    alert("请先选择至少 1 张截图。");
    return;
  }

  $("btn").disabled = true;
  $("btnReport").disabled = true;
  $("score").textContent = "…";
  $("dims").innerHTML = "";
  $("issues").innerHTML = "";

  const payload = await analyzeFiles(files, { seed: 42 });
  const result = {
    principle: payload.principle,
    overall_score: payload.overall_score,
    confidence: payload.confidence,
    detection_summary: payload.detection_summary,
    overall_summary: payload.overall_summary,
    priority_improvements: payload.priority_improvements,
    dimension_scores: payload.dimension_scores,
    issues: payload.issues,
    meta: payload.meta,
  };

  renderResult(result);
  __lastResult = result;
  __lastPayload = payload;

  const axes = computeScatterAxes(result);
  let thumbDataUrl = "";
  if (payload.first_bitmap) {
    try {
      thumbDataUrl = await bitmapToThumbDataUrl(payload.first_bitmap);
    } catch (err) {
      console.warn(err);
    }
  }
  const label =
    files.length === 1 ? files[0].name || "截图" : `${files.length} 张：${files[0]?.name || "截图"}…`;
  try {
    addUserPoint({
      id: newUserPointId(),
      type: "user",
      x: axes.x,
      y: axes.y,
      label,
      thumbDataUrl,
      overall_score: result.overall_score,
      createdAt: new Date().toISOString(),
      resultSummary: {
        xLabel: axes.xLabel,
        yLabel: axes.yLabel,
      },
    });
    scatterChart.setUserPoints(loadUserPoints());
    renderUploadsList();
  } catch (err) {
    console.warn(err);
    alert(err?.message || String(err));
  }

  // Setup report viewer
  $("btnReport").disabled = false;
  $("btnReport").onclick = async () => {
    const dlg = $("reportDialog");
    const frame = $("reportFrame");
    if (!payload.first_bitmap) {
      frame.src = "about:blank";
      dlg.showModal();
      return;
    }
    const html = await buildReportHtml({
      result: __lastResult || result,
      filename: payload.first_file?.name || "upload.png",
      imageBitmap: payload.first_bitmap,
    });
    frame.removeAttribute("src");
    frame.srcdoc = html;
    dlg.showModal();
  };

  $("btnJson").disabled = false;
  $("btnJson").onclick = () => {
    revokeLastDownloads();
    const blob = new Blob([JSON.stringify(__lastResult || result, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    __lastDownloadUrls.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = `result_${payload.run_id}.json`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  $("btn").disabled = false;
}

$("btn").addEventListener("click", () => {
  analyze().catch((e) => {
    console.error(e);
    alert(`分析失败：${e.message || e}`);
    $("btn").disabled = false;
  });
});

$("closeDialog").addEventListener("click", () => {
  $("reportDialog").close();
});

function newUserPointId() {
  return crypto.randomUUID?.() || `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** @param {ImageBitmap} bitmap */
async function bitmapToThumbDataUrl(bitmap, maxW = 88) {
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = Math.min(1, maxW / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const c =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(tw, th)
      : Object.assign(document.createElement("canvas"), { width: tw, height: th });
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, tw, th);
  if (typeof c.convertToBlob === "function") {
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.62 });
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  return c.toDataURL("image/jpeg", 0.62);
}

const scatterMount = $("scatterMount");
const btnDeletePoint = $("btnDeletePoint");
const scatterSelectionHint = $("scatterSelectionHint");
const datasetStatus = $("datasetStatus");
const uploadsList = $("uploadsList");
const btnClearUploads = $("btnClearUploads");
const btnAi = $("btnAi");
const aiBlock = $("aiBlock");

let __lastResult = null;
let __lastPayload = null;

const scatterChart = createScatterChart(scatterMount, {
  brandPoints: [],
  onSelectionChange: (sel) => {
    if (sel.kind === "user") {
      btnDeletePoint.disabled = false;
      scatterSelectionHint.textContent = "已选中：我的上传（可删除）";
    } else if (sel.kind === "brand") {
      btnDeletePoint.disabled = true;
      const b = __brandPointById.get(sel.id);
      scatterSelectionHint.textContent = b
        ? `已选中：${b.brand || b.label || "品牌"}（下方展示该品牌的示例）`
        : "已选中：品牌（下方展示示例）";
      renderBrandExamples(b?.brand || "");
    } else {
      btnDeletePoint.disabled = true;
      scatterSelectionHint.textContent = "";
      renderBrandExamples("");
    }
  },
});
scatterChart.setUserPoints(loadUserPoints());
renderUploadsList();

const REF_CACHE_KEY = "apple-consistency-brandcache-v1";
const __brandPointById = new Map();
let __computedExamples = [];

function loadRefCache() {
  try {
    const raw = localStorage.getItem(REF_CACHE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveRefCache(cache) {
  try {
    localStorage.setItem(REF_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

async function fetchAsFile(url, fallbackName) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`无法加载参考图片：${url}（${res.status}）`);
  const blob = await res.blob();
  const name = fallbackName || url.split("/").pop() || "reference.png";
  return new File([blob], name, { type: blob.type || "image/png" });
}

async function initBrandDataset() {
  const cache = loadRefCache();
  const { images } = await loadPhotoManifest();
  const byBrand = images?.length ? groupImagesByBrand(images) : new Map();

  const out = [];
  const now = Date.now();
  const maxAgeMs = 30 * 24 * 3600 * 1000;
  const totalToAnalyze = images?.length || 0;
  let analyzed = 0;

  // Try loading pre-computed reference data from batch_analyze.py
  const refData = await loadReferenceData();
  if (refData && refData.length > 0) {
    for (const r of refData) out.push(r);
    setDatasetStatus({
      phase: "ready",
      total: refData.length,
      brands: new Set(refData.map((r) => r.brand)).size,
      analyzed: refData.length,
      message: `已加载预计算数据：${refData.length} 张截图（来自 reference-data.json）`,
    });
  } else if (!images || images.length === 0) {
    setDatasetStatus({
      phase: "fallback",
      total: 0,
      brands: 0,
      analyzed: 0,
      message: "未检测到 `photos/manifest.json` 中的图片列表，已使用内置示例数据集（用于演示）。",
    });
    for (const ref of REFERENCE_POINTS) out.push({ ...ref });
  } else {
    // Analyze each screenshot to obtain axes; cache per-image.
    if (totalToAnalyze > 0) {
      setDatasetStatus({
        phase: "loading",
        total: totalToAnalyze,
        brands: byBrand.size,
        analyzed,
        message: "已读取截图清单，正在批量分析并计算品牌平均点（首次加载会较慢）。",
      });
    }

    for (const [brand, list] of byBrand.entries()) {
      for (const rel of list) {
        const id = `photo:${rel}`;
        const cached = cache[id];
        const isFresh = cached && typeof cached === "object" && now - (cached.computedAt || 0) < maxAgeMs;
        if (isFresh && typeof cached.x === "number" && typeof cached.y === "number") {
          out.push({
            id,
            brand,
            label: rel.split("/").pop() || rel,
            x: cached.x,
            y: cached.y,
            imageUrl: `./${rel}`,
            thumbUrl: `./${rel}`,
            sourceUrl: "",
            license: "",
          });
          analyzed++;
          if (totalToAnalyze > 0 && analyzed % 4 === 0) {
            setDatasetStatus({ phase: "analyzing", total: totalToAnalyze, brands: byBrand.size, analyzed });
          }
          continue;
        }
        try {
          const f = await fetchAsFile(`./${rel}`, `${brand}_${(rel.split("/").pop() || "img").replaceAll(" ", "_")}`);
          const payload = await analyzeFiles([f], { seed: 42 });
          const result = {
            principle: payload.principle,
            overall_score: payload.overall_score,
            confidence: payload.confidence,
            detection_summary: payload.detection_summary,
            overall_summary: payload.overall_summary,
            priority_improvements: payload.priority_improvements,
            dimension_scores: payload.dimension_scores,
            issues: payload.issues,
            meta: payload.meta,
          };
          const axes = computeScatterAxes(result);
          cache[id] = { x: axes.x, y: axes.y, computedAt: Date.now() };
          out.push({
            id,
            brand,
            label: rel.split("/").pop() || rel,
            x: axes.x,
            y: axes.y,
            imageUrl: `./${rel}`,
            thumbUrl: `./${rel}`,
            sourceUrl: "",
            license: "",
          });
          analyzed++;
          if (totalToAnalyze > 0 && analyzed % 2 === 0) {
            setDatasetStatus({ phase: "analyzing", total: totalToAnalyze, brands: byBrand.size, analyzed });
          }
        } catch (e) {
          console.warn("photo analyze failed", rel, e);
          analyzed++;
        }
      }
    }
  }

  saveRefCache(cache);
  __computedExamples = out;
  const brandPoints = computeBrandAverages(out);
  __brandPointById.clear();
  for (const bp of brandPoints) __brandPointById.set(bp.id, bp);
  // Pass raw 76 points for ellipse computation and background scatter dots
  scatterChart.setRawPoints(out);
  scatterChart.setBrandPoints(brandPoints);
  renderBrandExamples("");

  setDatasetStatus({
    phase: "ready",
    total: out.length,
    brands: brandPoints.length,
    analyzed: out.length,
    message: `已完成：${brandPoints.length} 个品牌，${out.length} 张截图。点击图上的品牌点查看示例。`,
  });
}

initBrandDataset().catch((e) => console.warn(e));

function setDatasetStatus({ phase, total, brands, analyzed, message } = {}) {
  if (!datasetStatus) return;
  const t = Number.isFinite(total) ? total : 0;
  const b = Number.isFinite(brands) ? brands : 0;
  const a = Number.isFinite(analyzed) ? analyzed : 0;
  const right = t > 0 ? `${a}/${t}` : `${a}`;
  const pill = phase ? `<span class="pill">${escapeHtml(String(phase))}</span>` : "";
  const msg = message ? escapeHtml(String(message)) : "";
  datasetStatus.innerHTML = `<span class="muted">数据集：</span>${escapeHtml(String(b))} 品牌，${escapeHtml(String(t))} 张截图（已处理 ${escapeHtml(right)}）${pill}<div class="muted">${msg}</div>`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Make available for renderResult() which may run early.
// (Not exported; just prevents accidental ReferenceError when refactoring.)

function computeBrandAverages(examples) {
  const by = new Map();
  for (const ex of examples) {
    const brand = ex.brand || "Unknown";
    if (!by.has(brand)) by.set(brand, []);
    by.get(brand).push(ex);
  }
  const out = [];
  for (const [brand, list] of by.entries()) {
    const xs = list.map((p) => Number(p.x)).filter((n) => Number.isFinite(n));
    const ys = list.map((p) => Number(p.y)).filter((n) => Number.isFinite(n));
    const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 50;
    const y = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 50;
    // Use first thumb as brand logo fallback (later can be replaced with real logo assets)
    const thumbUrl = list[0]?.thumbUrl || list[0]?.imageUrl || "";
    out.push({
      id: `brand-${brand.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`.slice(0, 64),
      brand,
      label: brand,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      thumbUrl,
      __examples: list,
    });
  }
  return out.sort((a, b) => String(a.brand).localeCompare(String(b.brand)));
}

let __refPoints = [];
let __refDialogBrand = "";
let __refDialogIndex = 0;

const refDialog = $("refDialog");
const refDialogTitle = $("refDialogTitle");
const refDialogImg = $("refDialogImg");
const refDialogSub = $("refDialogSub");
const refDialogLink = $("refDialogLink");
const refDialogCoords = $("refDialogCoords");
const refPrev = $("refPrev");
const refNext = $("refNext");
const refClose = $("refClose");

function openRefDialog(points, brand, index) {
  __refPoints = Array.isArray(points) ? points : [];
  __refDialogBrand = brand || "";
  __refDialogIndex = Math.max(0, Math.min(index | 0, __refPoints.length - 1));
  renderRefDialog();
  refDialog?.showModal?.();
}

function closeRefDialog() {
  refDialog?.close?.();
}

function sameBrandPoints() {
  const b = __refDialogBrand;
  if (!b) return { list: __refPoints, idx: __refDialogIndex };
  const list = __refPoints.filter((p) => p.brand === b);
  const cur = __refPoints[__refDialogIndex];
  const idx = Math.max(0, list.findIndex((p) => p.id === cur?.id));
  return { list, idx };
}

function renderRefDialog() {
  if (!refDialog || !__refPoints.length) return;
  const { list, idx } = sameBrandPoints();
  const p = list[idx];
  if (!p) return;

  if (refDialogTitle) refDialogTitle.textContent = (p.brand ? `${p.brand} · ` : "") + (p.label || "参考界面");
  if (refDialogImg) refDialogImg.src = p.imageUrl || p.thumbUrl || "";
  if (refDialogSub) refDialogSub.textContent = p.license ? `许可：${p.license}` : "";
  if (refDialogLink) {
    refDialogLink.href = p.sourceUrl || "#";
    refDialogLink.textContent = p.sourceUrl ? "打开来源页面" : "来源不可用";
  }
  if (refDialogCoords) {
    refDialogCoords.textContent = `坐标：(${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)})`;
  }

  if (refPrev) refPrev.disabled = idx <= 0;
  if (refNext) refNext.disabled = idx >= list.length - 1;
}

refPrev?.addEventListener?.("click", () => {
  const { list, idx } = sameBrandPoints();
  const nextIdx = Math.max(0, idx - 1);
  const nextId = list[nextIdx]?.id;
  const globalIdx = __refPoints.findIndex((p) => p.id === nextId);
  if (globalIdx >= 0) __refDialogIndex = globalIdx;
  renderRefDialog();
});

refNext?.addEventListener?.("click", () => {
  const { list, idx } = sameBrandPoints();
  const nextIdx = Math.min(list.length - 1, idx + 1);
  const nextId = list[nextIdx]?.id;
  const globalIdx = __refPoints.findIndex((p) => p.id === nextId);
  if (globalIdx >= 0) __refDialogIndex = globalIdx;
  renderRefDialog();
});

refClose?.addEventListener?.("click", closeRefDialog);

function renderBrandExamples(brand) {
  const mount = $("refGallery");
  if (!mount) return;
  const points = __computedExamples || [];
  const shown = brand ? points.filter((p) => p.brand === brand) : points;
  mount.innerHTML = "";
  for (const p of shown) {
    const card = document.createElement("div");
    card.className = "refCard";
    card.tabIndex = 0;
    card.addEventListener("click", () => {
      const idx = shown.findIndex((q) => q.id === p.id);
      openRefDialog(shown, brand || p.brand || "", idx);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = shown.findIndex((q) => q.id === p.id);
        openRefDialog(shown, brand || p.brand || "", idx);
      }
    });

    const img = document.createElement("img");
    img.className = "refThumb";
    img.alt = p.label || "示例";
    img.loading = "lazy";
    img.src = p.thumbUrl || p.imageUrl || "";
    card.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "refMeta";
    const title = document.createElement("div");
    title.className = "refTitle";
    title.textContent = (p.brand ? `${p.brand} · ` : "") + (p.label || "");
    meta.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "refSub";
    sub.textContent = `坐标：(${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)})`;
    meta.appendChild(sub);

    const a = document.createElement("a");
    a.className = "refLink";
    a.href = p.sourceUrl || "#";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = p.license ? `来源与许可：${p.license}` : "来源";
    meta.appendChild(a);

    card.appendChild(meta);
    mount.appendChild(card);
  }
}

btnDeletePoint.addEventListener("click", () => {
  const sel = scatterChart.getSelection();
  if (sel.kind !== "user" || !sel.id) return;
  const next = removeUserPoint(sel.id);
  scatterChart.setUserPoints(next);
  scatterChart.clearSelection("none");
  renderUploadsList();
});

btnClearUploads?.addEventListener?.("click", () => {
  if (!confirm("确定要清空所有“我的上传记录”吗？此操作不可撤销（只影响本机浏览器）。")) return;
  clearUserPoints();
  scatterChart.setUserPoints(loadUserPoints());
  scatterChart.clearSelection("none");
  renderUploadsList();
});

function renderUploadsList() {
  if (!uploadsList) return;
  const points = loadUserPoints().slice().reverse();
  uploadsList.innerHTML = "";
  if (points.length === 0) {
    uploadsList.innerHTML = `<div class="hint">暂无上传记录。</div>`;
    return;
  }
  for (const p of points) {
    const row = document.createElement("div");
    row.className = "uploadRow";

    const img = document.createElement("img");
    img.className = "uploadThumb";
    img.alt = p.label || "上传截图";
    img.loading = "lazy";
    img.src = p.thumbDataUrl || "";
    row.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "uploadMeta";
    const title = document.createElement("div");
    title.className = "uploadTitle";
    title.textContent = p.label || "我的截图";
    meta.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "uploadSub";
    sub.textContent = `坐标：(${Number(p.x).toFixed(1)}, ${Number(p.y).toFixed(1)}) · 总分：${Number(p.overall_score).toFixed(1)}`;
    meta.appendChild(sub);
    row.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "uploadActions";
    const del = document.createElement("button");
    del.className = "btn secondary";
    del.type = "button";
    del.textContent = "删除";
    del.addEventListener("click", () => {
      removeUserPoint(p.id);
      scatterChart.setUserPoints(loadUserPoints());
      scatterChart.clearSelection("none");
      renderUploadsList();
    });
    actions.appendChild(del);
    row.appendChild(actions);

    uploadsList.appendChild(row);
  }
}

btnAi?.addEventListener?.("click", () => {
  runAiExplain().catch((e) => {
    console.error(e);
    alert(`AI 分析失败：${e.message || e}`);
  });
});

/** 从 localStorage 或 config.js 读取 API 地址 */
function getApiBase() {
  const saved = localStorage.getItem("apple-consistency-api-url");
  return (saved || window.__API_BASE__ || "").replace(/\/+$/, "");
}

/** 提示用户输入 API 地址并保存 */
function promptApiBase() {
  const current = getApiBase();
  const entered = window.prompt(
    "请输入后端 API 地址（示例：http://127.0.0.1:8000）\n\n· 本地运行：在 backend/ 目录执行 uvicorn app.main:app\n· Render 等云服务：填入对应的公网 URL",
    current || "http://127.0.0.1:8000"
  );
  if (!entered) return "";
  const url = entered.trim().replace(/\/+$/, "");
  localStorage.setItem("apple-consistency-api-url", url);
  return url;
}

async function runAiExplain() {
  if (!__lastResult || !__lastPayload?.first_bitmap) {
    alert("请先完成一次评估（上传并点击\u201c开始评估\u201d），再运行 AI 增强分析。");
    return;
  }

  let apiBase = getApiBase();
  if (!apiBase) {
    apiBase = promptApiBase();
    if (!apiBase) return;   // 用户取消
  }

  if (aiBlock) aiBlock.innerHTML = `<div class="hint">AI 正在生成详尽原因分析…</div>`;

  const imageDataUrl = await bitmapToThumbDataUrl(__lastPayload.first_bitmap, 560);
  const body = {
    principle: __lastResult.principle,
    goal: "评估是否符合 Apple 一致性原则（Consistency）并给出可执行改进建议",
    result: __lastResult,
    image_data_url: imageDataUrl,
  };

  let res;
  try {
    res = await fetch(`${apiBase}/api/ai/explain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    if (aiBlock) aiBlock.innerHTML = `<div class="hint" style="color:#c00">无法连接到 ${apiBase}，请确认后端已启动或重新设置地址。</div>`;
    const retry = window.confirm(`无法连接到 ${apiBase}。\n\n是否重新设置后端地址？`);
    if (retry) {
      const newBase = promptApiBase();
      if (newBase) runAiExplain();
    }
    return;
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  __lastResult.ai = data;

  if (aiBlock) {
    aiBlock.innerHTML = `<pre>${escapeHtml(data?.markdown || JSON.stringify(data, null, 2))}</pre>`;
  }
}

