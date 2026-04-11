import { analyzeFiles, buildReportHtml } from "./analyze.js";
import { computeScatterAxes } from "./metrics.js";
import { loadUserPoints, addUserPoint, removeUserPoint } from "./storage.js";
import { createScatterChart } from "./scatter-chart.js";

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

btnDeletePoint.addEventListener("click", () => {
  const sel = scatterChart.getSelection();
  if (sel.kind !== "user" || !sel.id) return;
  const next = removeUserPoint(sel.id);
  scatterChart.setUserPoints(next);
  scatterChart.clearSelection("none");
});

