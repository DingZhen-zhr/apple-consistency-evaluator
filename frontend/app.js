import { analyzeFiles, buildReportHtml } from "./analyze.js";
import { computeScatterAxes } from "./metrics.js";
import { loadUserPoints, addUserPoint, removeUserPoint } from "./storage.js";
import { createScatterChart } from "./scatter-chart.js";
import { REFERENCE_POINTS } from "./reference-points.js";

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
        inAppleZone: axes.inAppleZone,
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
  referencePoints: [],
  onSelectionChange: (sel) => {
    if (sel.kind === "user") {
      btnDeletePoint.disabled = false;
      scatterSelectionHint.textContent = "已选中：我的上传（可删除）";
    } else if (sel.kind === "reference") {
      btnDeletePoint.disabled = true;
      scatterSelectionHint.textContent = "已选中：苹果参考点（不可删除）";
    } else {
      btnDeletePoint.disabled = true;
      scatterSelectionHint.textContent = "";
    }
  },
});
scatterChart.setUserPoints(loadUserPoints());

const REF_CACHE_KEY = "apple-consistency-refcache-v1";

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

async function initReferencePoints() {
  const cache = loadRefCache();
  const out = [];
  for (const ref of REFERENCE_POINTS) {
    const cached = cache[ref.id];
    const now = Date.now();
    const isFresh = cached && typeof cached === "object" && now - (cached.computedAt || 0) < 30 * 24 * 3600 * 1000;
    if (isFresh && typeof cached.x === "number" && typeof cached.y === "number") {
      out.push({ ...ref, x: cached.x, y: cached.y });
      continue;
    }
    try {
      const f = await fetchAsFile(ref.imageUrl, `${ref.id}.png`);
      const payload = await analyzeFiles([f], { seed: 42 });
      const result = {
        principle: payload.principle,
        overall_score: payload.overall_score,
        dimension_scores: payload.dimension_scores,
        issues: payload.issues,
        meta: payload.meta,
      };
      const axes = computeScatterAxes(result);
      cache[ref.id] = { x: axes.x, y: axes.y, computedAt: Date.now(), overall_score: result.overall_score };
      out.push({ ...ref, x: axes.x, y: axes.y });
    } catch (e) {
      console.warn("reference analyze failed", ref.id, e);
      out.push(ref);
    }
  }
  saveRefCache(cache);
  scatterChart.setReferencePoints(out);
  renderRefGallery(out);
}

initReferencePoints().catch((e) => console.warn(e));

function renderRefGallery(points) {
  const mount = $("refGallery");
  if (!mount) return;
  mount.innerHTML = "";
  for (const p of points) {
    const card = document.createElement("div");
    card.className = "refCard";

    const img = document.createElement("img");
    img.className = "refThumb";
    img.alt = p.label || "参考界面";
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

