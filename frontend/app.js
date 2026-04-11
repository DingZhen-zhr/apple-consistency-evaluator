import { analyzeFiles, buildReportHtml } from "./analyze.js";

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

