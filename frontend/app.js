const $ = (id) => document.getElementById(id);

function apiBase() {
  // Injected by `frontend/config.js` for GitHub Pages deployments.
  // Example: window.__API_BASE__ = "https://your-service.onrender.com";
  if (window.__API_BASE__) return String(window.__API_BASE__).replace(/\/+$/, "");

  // Local dev: call API on same origin (FastAPI serves both /ui and /api).
  return "";
}

function apiUrl(path) {
  const p = String(path || "");
  if (!p.startsWith("/")) return `${apiBase()}/${p}`;
  return `${apiBase()}${p}`;
}

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

  const form = new FormData();
  for (const f of files) form.append("files", f);

  const res = await fetch(apiUrl("/api/analyze"), { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  const payload = await res.json();
  renderResult(payload.result);

  // Setup report viewer
  $("btnReport").disabled = false;
  $("btnReport").onclick = () => {
    const dlg = $("reportDialog");
    const frame = $("reportFrame");
    const rel = payload?.artifacts?.report_url;
    frame.src = rel ? apiUrl(rel) : "about:blank";
    dlg.showModal();
  };

  $("btnJson").disabled = false;
  $("btnJson").onclick = () => {
    const url = payload?.artifacts?.result_url;
    if (!url) return;
    window.open(apiUrl(url), "_blank", "noopener,noreferrer");
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

