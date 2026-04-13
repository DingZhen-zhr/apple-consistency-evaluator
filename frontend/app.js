import { analyzeFiles, buildReportHtml } from "./analyze.js";
import { computeScatterAxes } from "./metrics.js";
import { loadUserPoints, addUserPoint, removeUserPoint } from "./storage.js";
import { createScatterChart } from "./scatter-chart.js";
import { loadPhotoManifest, groupImagesByBrand } from "./brand-dataset.js";

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderResult(result) {
  $("score").textContent = result.overall_score.toFixed(1);

  const dims = $("dims");
  dims.innerHTML = "";
  for (const d of result.dimension_scores || []) {
    const row = el("div", "dim");
    row.appendChild(el("div", "", d.dimension));
    row.appendChild(el("div", "", `${d.score.toFixed(1)}（${d.summary}）`));
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
    dimension_scores: payload.dimension_scores,
    issues: payload.issues,
    meta: payload.meta,
  };

  renderResult(result);

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
      result,
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
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" });
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
  const byBrand = groupImagesByBrand(images);

  const out = [];
  const now = Date.now();
  const maxAgeMs = 30 * 24 * 3600 * 1000;

  // Analyze each screenshot to obtain axes; cache per-image.
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
        continue;
      }
      try {
        const f = await fetchAsFile(`./${rel}`, `${brand}_${(rel.split("/").pop() || "img").replaceAll(" ", "_")}`);
        const payload = await analyzeFiles([f], { seed: 42 });
        const result = {
          principle: payload.principle,
          overall_score: payload.overall_score,
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
      } catch (e) {
        console.warn("photo analyze failed", rel, e);
      }
    }
  }

  saveRefCache(cache);
  __computedExamples = out;
  const brandPoints = computeBrandAverages(out);
  __brandPointById.clear();
  for (const bp of brandPoints) __brandPointById.set(bp.id, bp);
  scatterChart.setBrandPoints(brandPoints);
  renderBrandExamples(""); // default view
}

initBrandDataset().catch((e) => console.warn(e));

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
});

