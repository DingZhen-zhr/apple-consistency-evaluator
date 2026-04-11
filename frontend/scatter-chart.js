import { REFERENCE_POINTS } from "./reference-points.js";

const APPLE_ZONE = { x0: 70, y0: 70, x1: 100, y1: 100 };

/**
 * @param {HTMLElement} container
 * @param {{ appleThreshold?: number, onSelectionChange?: (sel: { kind: 'user'|'reference'|'none', id: string|null }) => void }} options
 */
export function createScatterChart(container, options = {}) {
  const appleThreshold = options.appleThreshold ?? 70;
  const onSelectionChange = options.onSelectionChange || (() => {});

  const inner = document.createElement("div");
  inner.className = "scatterInner";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "scatterSvg");
  svg.setAttribute("viewBox", "0 0 440 400");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "一致性双轴散点图");

  inner.appendChild(svg);
  container.appendChild(inner);

  let userPoints = [];
  let selectedId = null;
  let selectedKind = "none";

  const W = 440;
  const H = 400;
  const padL = 52;
  const padR = 24;
  const padT = 28;
  const padB = 48;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  function dataX(x) {
    return padL + (x / 100) * innerW;
  }
  function dataY(y) {
    return padT + (1 - y / 100) * innerH;
  }

  function hitDistance(px, py, cx, cy) {
    const dx = px - cx;
    const dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  let clickBound = false;

  function render() {
    svg.innerHTML = "";

    const defs = document.createElementNS(svg.namespaceURI, "defs");
    defs.innerHTML = `
      <pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
      </pattern>
    `;
    svg.appendChild(defs);

    const bg = document.createElementNS(svg.namespaceURI, "rect");
    bg.setAttribute("x", String(padL));
    bg.setAttribute("y", String(padT));
    bg.setAttribute("width", String(innerW));
    bg.setAttribute("height", String(innerH));
    bg.setAttribute("fill", "url(#gridPattern)");
    bg.setAttribute("rx", "8");
    svg.appendChild(bg);

    // Apple 一致区（与「是否符合苹果一致性原则」高一致重叠）
    const ax0 = dataX(APPLE_ZONE.x0);
    const ay0 = dataY(APPLE_ZONE.y1);
    const aw = dataX(APPLE_ZONE.x1) - ax0;
    const ah = dataY(APPLE_ZONE.y0) - ay0;
    const zone = document.createElementNS(svg.namespaceURI, "rect");
    zone.setAttribute("x", String(ax0));
    zone.setAttribute("y", String(ay0));
    zone.setAttribute("width", String(aw));
    zone.setAttribute("height", String(ah));
    zone.setAttribute("fill", "rgba(52, 199, 89, 0.12)");
    zone.setAttribute("stroke", "rgba(52, 199, 89, 0.45)");
    zone.setAttribute("stroke-width", "1.5");
    zone.setAttribute("rx", "6");
    svg.appendChild(zone);

    const zoneLabel = document.createElementNS(svg.namespaceURI, "text");
    zoneLabel.setAttribute("x", String(ax0 + 8));
    zoneLabel.setAttribute("y", String(ay0 + 18));
    zoneLabel.setAttribute("fill", "rgba(200,255,210,0.85)");
    zoneLabel.setAttribute("font-size", "11");
    zoneLabel.textContent = "Apple 一致区（双轴均≥" + appleThreshold + "）";
    svg.appendChild(zoneLabel);

    const border = document.createElementNS(svg.namespaceURI, "rect");
    border.setAttribute("x", String(padL));
    border.setAttribute("y", String(padT));
    border.setAttribute("width", String(innerW));
    border.setAttribute("height", String(innerH));
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "rgba(255,255,255,.18)");
    border.setAttribute("rx", "8");
    svg.appendChild(border);

    // Axes labels
    const xl = document.createElementNS(svg.namespaceURI, "text");
    xl.setAttribute("x", String(padL + innerW / 2));
    xl.setAttribute("y", String(H - 12));
    xl.setAttribute("text-anchor", "middle");
    xl.setAttribute("fill", "#a3a3b2");
    xl.setAttribute("font-size", "12");
    xl.textContent = "视觉与组件一致性 →";
    svg.appendChild(xl);

    const yl = document.createElementNS(svg.namespaceURI, "text");
    yl.setAttribute("x", "16");
    yl.setAttribute("y", String(padT + innerH / 2));
    yl.setAttribute("text-anchor", "middle");
    yl.setAttribute("fill", "#a3a3b2");
    yl.setAttribute("font-size", "12");
    yl.setAttribute("transform", `rotate(-90 16 ${padT + innerH / 2})`);
    yl.textContent = "布局与信息层级一致性 →";
    svg.appendChild(yl);

    // Ticks 0,50,100
    for (const t of [0, 50, 100]) {
      const tx = document.createElementNS(svg.namespaceURI, "text");
      tx.setAttribute("x", String(dataX(t)));
      tx.setAttribute("y", String(H - 28));
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("fill", "rgba(163,163,178,.8)");
      tx.setAttribute("font-size", "10");
      tx.textContent = String(t);
      svg.appendChild(tx);
    }
    for (const t of [0, 50, 100]) {
      const ty = document.createElementNS(svg.namespaceURI, "text");
      ty.setAttribute("x", String(padL - 8));
      ty.setAttribute("y", String(dataY(t) + 4));
      ty.setAttribute("text-anchor", "end");
      ty.setAttribute("fill", "rgba(163,163,178,.8)");
      ty.setAttribute("font-size", "10");
      ty.textContent = String(t);
      svg.appendChild(ty);
    }

    // Reference points
    for (const p of REFERENCE_POINTS) {
      const cx = dataX(p.x);
      const cy = dataY(p.y);
      const g = document.createElementNS(svg.namespaceURI, "g");
      g.setAttribute("data-ref-id", p.id);
      g.style.cursor = "pointer";

      const c = document.createElementNS(svg.namespaceURI, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", selectedKind === "reference" && selectedId === p.id ? "9" : "7");
      c.setAttribute("fill", "rgba(10,132,255,0.35)");
      c.setAttribute("stroke", "#0a84ff");
      c.setAttribute("stroke-width", selectedKind === "reference" && selectedId === p.id ? "2.5" : "1.5");
      g.appendChild(c);

      const lab = document.createElementNS(svg.namespaceURI, "text");
      lab.setAttribute("x", String(cx + 10));
      lab.setAttribute("y", String(cy - 8));
      lab.setAttribute("fill", "rgba(241,241,246,0.75)");
      lab.setAttribute("font-size", "10");
      lab.textContent = p.label;
      g.appendChild(lab);

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedId = p.id;
        selectedKind = "reference";
        onSelectionChange({ kind: "reference", id: p.id });
        render();
      });
      svg.appendChild(g);
    }

    // User points (on top)
    for (const p of userPoints) {
      const cx = dataX(p.x);
      const cy = dataY(p.y);
      const g = document.createElementNS(svg.namespaceURI, "g");
      g.setAttribute("data-user-id", p.id);
      g.style.cursor = "pointer";

      const isSel = selectedKind === "user" && selectedId === p.id;

      if (p.thumbDataUrl) {
        const clipId = `clip-${p.id}`;
        const cd = document.createElementNS(svg.namespaceURI, "defs");
        cd.innerHTML = `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="14"/></clipPath>`;
        g.appendChild(cd);
        const img = document.createElementNS(svg.namespaceURI, "image");
        img.setAttribute("href", p.thumbDataUrl);
        img.setAttribute("x", String(cx - 14));
        img.setAttribute("y", String(cy - 14));
        img.setAttribute("width", "28");
        img.setAttribute("height", "28");
        img.setAttribute("clip-path", `url(#${clipId})`);
        img.setAttribute("preserveAspectRatio", "xMidYMid slice");
        g.appendChild(img);
        const ring = document.createElementNS(svg.namespaceURI, "circle");
        ring.setAttribute("cx", String(cx));
        ring.setAttribute("cy", String(cy));
        ring.setAttribute("r", "14");
        ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", isSel ? "#ff9f0a" : "rgba(255,255,255,.35)");
        ring.setAttribute("stroke-width", isSel ? "3" : "1.5");
        g.appendChild(ring);
      } else {
        const c = document.createElementNS(svg.namespaceURI, "circle");
        c.setAttribute("cx", String(cx));
        c.setAttribute("cy", String(cy));
        c.setAttribute("r", "12");
        c.setAttribute("fill", "rgba(255,159,10,0.45)");
        c.setAttribute("stroke", isSel ? "#ff9f0a" : "rgba(255,255,255,.4)");
        c.setAttribute("stroke-width", isSel ? "3" : "1.5");
        g.appendChild(c);
      }

      const lab = document.createElementNS(svg.namespaceURI, "text");
      lab.setAttribute("x", String(cx + 16));
      lab.setAttribute("y", String(cy + 4));
      lab.setAttribute("fill", "rgba(241,241,246,0.9)");
      lab.setAttribute("font-size", "11");
      lab.textContent = p.label || "我的截图";
      g.appendChild(lab);

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedId = p.id;
        selectedKind = "user";
        onSelectionChange({ kind: "user", id: p.id });
        render();
      });
      svg.appendChild(g);
    }

    if (!clickBound) {
      clickBound = true;
      svg.addEventListener("click", (e) => {
        const t = e.target;
        if (t && typeof t.closest === "function") {
          if (t.closest("g[data-user-id]") || t.closest("g[data-ref-id]")) return;
        }
        selectedId = null;
        selectedKind = "none";
        onSelectionChange({ kind: "none", id: null });
        render();
      });
    }
  }

  function setUserPoints(points) {
    userPoints = Array.isArray(points) ? points : [];
    render();
  }

  function getSelection() {
    return { kind: selectedKind, id: selectedId };
  }

  render();

  return {
    setUserPoints,
    getSelection,
    /** @param {'user'|'reference'|'none'} kind */
    clearSelection(kind = "none") {
      selectedId = null;
      selectedKind = kind === "none" ? "none" : selectedKind;
      if (kind === "none") selectedKind = "none";
      render();
      onSelectionChange({ kind: "none", id: null });
    },
    refresh: render,
  };
}
