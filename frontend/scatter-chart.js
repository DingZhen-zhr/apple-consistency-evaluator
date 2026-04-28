/**
 * @param {HTMLElement} container
 * @param {{
 *   brandPoints?: Array<{ id: string, x: number, y: number, label: string, brand?: string, thumbUrl?: string }>,
 *   onSelectionChange?: (sel: { kind: 'user'|'brand'|'none', id: string|null }) => void
 * }} options
 */
export function createScatterChart(container, options = {}) {
  const onSelectionChange = options.onSelectionChange || (() => { });

  const inner = document.createElement("div");
  inner.className = "scatterInner";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "scatterSvg");
  svg.setAttribute("viewBox", "0 0 440 400");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Apple Consistency 双轴散点图");

  inner.appendChild(svg);
  container.appendChild(inner);

  let brandPoints = Array.isArray(options.brandPoints) ? options.brandPoints : [];
  let rawPoints = [];   // Full reference dataset (76 entries) for ellipses + background dots
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

  // --- Confidence ellipse helpers ---
  function computeBrandEllipses(points) {
    // Prefer raw points (full dataset) for more accurate ellipses
    const source = rawPoints.length >= 3 ? rawPoints : points;
    const byBrand = new Map();
    for (const p of source) {
      const brand = p.brand || "Unknown";
      if (!byBrand.has(brand)) byBrand.set(brand, []);
      byBrand.get(brand).push(p);
    }
    const ellipses = [];
    for (const [brand, list] of byBrand.entries()) {
      if (list.length < 3) continue;
      const xs = list.map((p) => p.x);
      const ys = list.map((p) => p.y);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sx = Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0) / xs.length) || 1;
      const sy = Math.sqrt(ys.reduce((s, v) => s + (v - my) ** 2, 0) / ys.length) || 1;
      // Covariance for rotation
      const cov = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / xs.length;
      const angle = 0.5 * Math.atan2(2 * cov, sx * sx - sy * sy);
      // 95% confidence: chi2(2, 0.95) ~ 5.991 => sqrt(5.991) ~ 2.448
      const scale = 2.448;
      ellipses.push({
        brand,
        cx: dataX(mx),
        cy: dataY(my),
        rx: (sx * scale / 100) * innerW,
        ry: (sy * scale / 100) * innerH,
        angleDeg: -(angle * 180) / Math.PI,
        color: brandColor(brand),
      });
    }
    return ellipses;
  }

  function brandColor(brand) {
    const colors = {
      Apple: "rgba(10,132,255,0.18)",
      Google: "rgba(52,199,89,0.18)",
      Huawei: "rgba(255,69,58,0.18)",
      Honor: "rgba(255,159,10,0.18)",
      OPPO: "rgba(100,210,80,0.18)",
      Samsung: "rgba(48,176,199,0.18)",
      Vivo: "rgba(175,130,255,0.18)",
      Xiaomi: "rgba(255,100,50,0.18)",
    };
    return colors[brand] || "rgba(160,160,180,0.12)";
  }

  function brandStroke(brand) {
    const colors = {
      Apple: "rgba(10,132,255,0.45)",
      Google: "rgba(52,199,89,0.45)",
      Huawei: "rgba(255,69,58,0.45)",
      Honor: "rgba(255,159,10,0.45)",
      OPPO: "rgba(100,210,80,0.45)",
      Samsung: "rgba(48,176,199,0.45)",
      Vivo: "rgba(175,130,255,0.45)",
      Xiaomi: "rgba(255,100,50,0.45)",
    };
    return colors[brand] || "rgba(160,160,180,0.3)";
  }

  let clickBound = false;

  function render() {
    svg.innerHTML = "";

    const defs = document.createElementNS(svg.namespaceURI, "defs");
    defs.innerHTML = [
      '<pattern id="gridPattern" width="40" height="40" patternUnits="userSpaceOnUse">',
      '  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="1"/>',
      "</pattern>",
    ].join("");
    svg.appendChild(defs);

    const bg = document.createElementNS(svg.namespaceURI, "rect");
    bg.setAttribute("x", String(padL));
    bg.setAttribute("y", String(padT));
    bg.setAttribute("width", String(innerW));
    bg.setAttribute("height", String(innerH));
    bg.setAttribute("fill", "url(#gridPattern)");
    bg.setAttribute("rx", "8");
    svg.appendChild(bg);

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
    xl.setAttribute("y", String(H - 6));
    xl.setAttribute("text-anchor", "middle");
    xl.setAttribute("fill", "#a3a3b2");
    xl.setAttribute("font-size", "11");
    xl.textContent = "Clarity（视觉清晰度）→";
    svg.appendChild(xl);

    const yl = document.createElementNS(svg.namespaceURI, "text");
    yl.setAttribute("x", "14");
    yl.setAttribute("y", String(padT + innerH / 2));
    yl.setAttribute("text-anchor", "middle");
    yl.setAttribute("fill", "#a3a3b2");
    yl.setAttribute("font-size", "11");
    yl.setAttribute("transform", `rotate(-90 14 ${padT + innerH / 2})`);
    yl.textContent = "Consistency（设计一致性）→";
    svg.appendChild(yl);

    // Ticks 0,25,50,75,100
    for (const t of [0, 25, 50, 75, 100]) {
      const tx = document.createElementNS(svg.namespaceURI, "text");
      tx.setAttribute("x", String(dataX(t)));
      tx.setAttribute("y", String(H - 28));
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("fill", "rgba(163,163,178,.8)");
      tx.setAttribute("font-size", "10");
      tx.textContent = String(t);
      svg.appendChild(tx);

      // Grid line
      if (t > 0 && t < 100) {
        const gl = document.createElementNS(svg.namespaceURI, "line");
        gl.setAttribute("x1", String(dataX(t)));
        gl.setAttribute("y1", String(padT));
        gl.setAttribute("x2", String(dataX(t)));
        gl.setAttribute("y2", String(padT + innerH));
        gl.setAttribute("stroke", "rgba(255,255,255,.04)");
        svg.appendChild(gl);
      }
    }
    for (const t of [0, 25, 50, 75, 100]) {
      const ty = document.createElementNS(svg.namespaceURI, "text");
      ty.setAttribute("x", String(padL - 8));
      ty.setAttribute("y", String(dataY(t) + 4));
      ty.setAttribute("text-anchor", "end");
      ty.setAttribute("fill", "rgba(163,163,178,.8)");
      ty.setAttribute("font-size", "10");
      ty.textContent = String(t);
      svg.appendChild(ty);

      if (t > 0 && t < 100) {
        const gl = document.createElementNS(svg.namespaceURI, "line");
        gl.setAttribute("x1", String(padL));
        gl.setAttribute("y1", String(dataY(t)));
        gl.setAttribute("x2", String(padL + innerW));
        gl.setAttribute("y2", String(dataY(t)));
        gl.setAttribute("stroke", "rgba(255,255,255,.04)");
        svg.appendChild(gl);
      }
    }

    // Raw background dots (tiny, colored by brand) drawn before ellipses
    for (const rp of rawPoints) {
      const dc = document.createElementNS(svg.namespaceURI, "circle");
      dc.setAttribute("cx", String(dataX(rp.x)));
      dc.setAttribute("cy", String(dataY(rp.y)));
      dc.setAttribute("r", "2.5");
      dc.setAttribute("fill", brandColor(rp.brand || "").replace("0.18", "0.55"));
      dc.setAttribute("pointer-events", "none");
      svg.appendChild(dc);
    }

    // Confidence ellipses (draw before brand centroid points)
    const ellipses = computeBrandEllipses(brandPoints || []);
    for (const e of ellipses) {
      const el = document.createElementNS(svg.namespaceURI, "ellipse");
      el.setAttribute("cx", String(e.cx));
      el.setAttribute("cy", String(e.cy));
      el.setAttribute("rx", String(Math.max(12, Math.min(innerW * 0.45, e.rx))));
      el.setAttribute("ry", String(Math.max(12, Math.min(innerH * 0.45, e.ry))));
      el.setAttribute("fill", e.color);
      el.setAttribute("stroke", brandStroke(e.brand));
      el.setAttribute("stroke-width", "1.2");
      el.setAttribute("stroke-dasharray", "4 3");
      el.setAttribute("transform", `rotate(${e.angleDeg} ${e.cx} ${e.cy})`);
      el.setAttribute("opacity", "0.7");
      svg.appendChild(el);
      // Ellipse label removed — brand identity shown on centroid dot label instead
    }

    // Brand points with collision-avoid
    const bps = (brandPoints || []).map((p) => ({ ...p }));
    const placed = bps.map((p) => ({ p, cx: dataX(p.x), cy: dataY(p.y) }));
    const minD = 30;
    for (let it = 0; it < 90; it++) {
      let moved = 0;
      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          const a = placed[i];
          const b = placed[j];
          const dx = b.cx - a.cx;
          const dy = b.cy - a.cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.0001;
          if (d >= minD) continue;
          const push = (minD - d) * 0.35;
          const ux = dx / d;
          const uy = dy / d;
          a.cx -= ux * push;
          a.cy -= uy * push;
          b.cx += ux * push;
          b.cy += uy * push;
          moved++;
        }
      }
      for (const o of placed) {
        o.cx = Math.max(padL + 10, Math.min(padL + innerW - 10, o.cx));
        o.cy = Math.max(padT + 10, Math.min(padT + innerH - 10, o.cy));
      }
      if (moved === 0) break;
    }

    for (const o of placed) {
      const p = o.p;
      const cx = o.cx;
      const cy = o.cy;
      const g = document.createElementNS(svg.namespaceURI, "g");
      g.setAttribute("data-brand-id", p.id);
      g.style.cursor = "pointer";

      const isSel = selectedKind === "brand" && selectedId === p.id;
      const thumb = p.thumbUrl;
      if (thumb) {
        const clipId = `clip-brand-${p.id}`;
        const cd = document.createElementNS(svg.namespaceURI, "defs");
        cd.innerHTML = `<clipPath id="${clipId}"><circle cx="${cx}" cy="${cy}" r="14"/></clipPath>`;
        g.appendChild(cd);
        const img = document.createElementNS(svg.namespaceURI, "image");
        img.setAttribute("href", thumb);
        img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", thumb);
        img.setAttribute("x", String(cx - 14));
        img.setAttribute("y", String(cy - 14));
        img.setAttribute("width", "28");
        img.setAttribute("height", "28");
        img.setAttribute("clip-path", `url(#${clipId})`);
        img.setAttribute("preserveAspectRatio", "xMidYMid slice");
        g.appendChild(img);
      }
      const ring = document.createElementNS(svg.namespaceURI, "circle");
      ring.setAttribute("cx", String(cx));
      ring.setAttribute("cy", String(cy));
      ring.setAttribute("r", thumb ? "14" : isSel ? "10" : "8");
      ring.setAttribute("fill", thumb ? "none" : "rgba(10,132,255,0.35)");
      ring.setAttribute("stroke", isSel ? "#ffd60a" : "#0a84ff");
      ring.setAttribute("stroke-width", isSel ? "3.2" : "2.0");
      g.appendChild(ring);

      // Always show brand label below the centroid dot with a background pill
      {
        const labelText = p.brand || p.label || "";
        const fs = isSel ? 11 : 10;
        const approxW = labelText.length * fs * 0.63 + 8;
        const lx = cx - approxW / 2;
        const ly = cy + (thumb ? 14 : isSel ? 10 : 8) + 3;  // just below the circle

        const bg = document.createElementNS(svg.namespaceURI, "rect");
        bg.setAttribute("x", String(lx));
        bg.setAttribute("y", String(ly));
        bg.setAttribute("width", String(approxW));
        bg.setAttribute("height", String(fs + 5));
        bg.setAttribute("rx", "3");
        bg.setAttribute("fill", "rgba(16,16,24,0.76)");
        bg.setAttribute("pointer-events", "none");
        g.appendChild(bg);

        const lab = document.createElementNS(svg.namespaceURI, "text");
        lab.setAttribute("x", String(cx));
        lab.setAttribute("y", String(ly + fs + 1));
        lab.setAttribute("text-anchor", "middle");
        lab.setAttribute("fill", isSel ? "#ffd60a" : "rgba(241,241,246,0.92)");
        lab.setAttribute("font-size", String(fs));
        lab.setAttribute("font-weight", isSel ? "700" : "500");
        lab.setAttribute("pointer-events", "none");
        lab.textContent = labelText;
        g.appendChild(lab);
      }

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        selectedId = p.id;
        selectedKind = "brand";
        onSelectionChange({ kind: "brand", id: p.id });
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
        img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", p.thumbDataUrl);
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

      if (isSel) {
        const lab = document.createElementNS(svg.namespaceURI, "text");
        lab.setAttribute("x", String(cx + 18));
        lab.setAttribute("y", String(cy + 4));
        lab.setAttribute("fill", "rgba(241,241,246,0.92)");
        lab.setAttribute("font-size", "12");
        lab.textContent = p.label || "我的截图";
        g.appendChild(lab);
      }

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
          if (t.closest("g[data-user-id]") || t.closest("g[data-brand-id]")) return;
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

  function setBrandPoints(points) {
    brandPoints = Array.isArray(points) ? points : [];
    render();
  }

  function setRawPoints(points) {
    rawPoints = Array.isArray(points) ? points : [];
    render();
  }

  function getSelection() {
    return { kind: selectedKind, id: selectedId };
  }

  render();

  return {
    setUserPoints,
    setBrandPoints,
    setRawPoints,
    getSelection,
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