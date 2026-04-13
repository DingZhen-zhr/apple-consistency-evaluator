// Browser-only, deterministic-ish heuristics for UI screenshot "consistency" checks.
// No network calls. No server required.

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function hashString(s) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function rgbToHex(r, g, b) {
  const rr = clamp(r | 0, 0, 255).toString(16).padStart(2, "0");
  const gg = clamp(g | 0, 0, 255).toString(16).padStart(2, "0");
  const bb = clamp(b | 0, 0, 255).toString(16).padStart(2, "0");
  return `#${rr}${gg}${bb}`.toUpperCase();
}

function rgbToLab01(r, g, b) {
  // sRGB -> linear
  const sr = r / 255;
  const sg = g / 255;
  const sb = b / 255;
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const R = lin(sr);
  const G = lin(sg);
  const B = lin(sb);

  // linear sRGB -> XYZ (D65)
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375;
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041;

  // XYZ -> Lab (D65)
  const refX = 0.95047;
  const refY = 1.0;
  const refZ = 1.08883;
  let xr = X / refX;
  let yr = Y / refY;
  let zr = Z / refZ;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(xr);
  const fy = f(yr);
  const fz = f(zr);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const labB = 200 * (fy - fz);
  // Normalize roughly to 0..1 for stable thresholds in browser
  return { L: L / 100, a: (a + 128) / 255, b: (labB + 128) / 255 };
}

function deltaE76Lab01(lab1, lab2) {
  const dL = (lab1.L - lab2.L) * 100;
  const da = (lab1.a - lab2.a) * 255;
  const db = (lab1.b - lab2.b) * 255;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleImagePixels(imageData, maxSamples, seed) {
  const { data, width, height } = imageData;
  const total = width * height;
  const want = clamp(maxSamples | 0, 1000, 60000);
  const out = new Uint8Array(want * 3);
  if (total <= want) {
    let o = 0;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      out[o++] = data[i];
      out[o++] = data[i + 1];
      out[o++] = data[i + 2];
    }
    return { bytes: out, count: total, width, height };
  }
  // Prefer stratified sampling over pure random sampling:
  // - more stable between runs
  // - less likely to miss small but important regions (icons/text)
  const rnd = mulberry32(seed);
  const padX = Math.max(0, Math.round(width * 0.03));
  const padY = Math.max(0, Math.round(height * 0.03));
  const w2 = Math.max(1, width - padX * 2);
  const h2 = Math.max(1, height - padY * 2);
  const grid = Math.max(1, Math.floor(Math.sqrt(want)));
  let k = 0;
  for (let gy = 0; gy < grid && k < want; gy++) {
    for (let gx = 0; gx < grid && k < want; gx++) {
      const jx = (rnd() - 0.5) * 0.8;
      const jy = (rnd() - 0.5) * 0.8;
      const x = padX + Math.min(w2 - 1, Math.max(0, Math.floor(((gx + 0.5 + jx) / grid) * w2)));
      const y = padY + Math.min(h2 - 1, Math.max(0, Math.floor(((gy + 0.5 + jy) / grid) * h2)));
      const i = (y * width + x) * 4;
      out[k * 3 + 0] = data[i];
      out[k * 3 + 1] = data[i + 1];
      out[k * 3 + 2] = data[i + 2];
      k++;
    }
  }
  // If want is not a perfect square, fill the remainder with random picks.
  for (; k < want; k++) {
    const p = (rnd() * total) | 0;
    const i = p * 4;
    out[k * 3 + 0] = data[i];
    out[k * 3 + 1] = data[i + 1];
    out[k * 3 + 2] = data[i + 2];
  }
  return { bytes: out, count: want, width, height };
}

function kMeansRgb(bytes, k, iters, seed) {
  const n = (bytes.length / 3) | 0;
  k = clamp(k | 0, 2, 10);
  iters = clamp(iters | 0, 3, 30);
  const rnd = mulberry32(seed);

  // init centers by random picks
  const centers = new Float32Array(k * 3);
  for (let c = 0; c < k; c++) {
    const p = (rnd() * n) | 0;
    centers[c * 3 + 0] = bytes[p * 3 + 0];
    centers[c * 3 + 1] = bytes[p * 3 + 1];
    centers[c * 3 + 2] = bytes[p * 3 + 2];
  }

  const labels = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    // assign
    for (let p = 0; p < n; p++) {
      const r = bytes[p * 3 + 0];
      const g = bytes[p * 3 + 1];
      const b = bytes[p * 3 + 2];
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const cr = centers[c * 3 + 0];
        const cg = centers[c * 3 + 1];
        const cb = centers[c * 3 + 2];
        const dr = r - cr;
        const dg = g - cg;
        const db = b - cb;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[p] = best;
    }

    // update
    const sum = new Float32Array(k * 3);
    const cnt = new Uint32Array(k);
    for (let p = 0; p < n; p++) {
      const c = labels[p];
      sum[c * 3 + 0] += bytes[p * 3 + 0];
      sum[c * 3 + 1] += bytes[p * 3 + 1];
      sum[c * 3 + 2] += bytes[p * 3 + 2];
      cnt[c]++;
    }
    for (let c = 0; c < k; c++) {
      if (cnt[c] === 0) continue;
      centers[c * 3 + 0] = sum[c * 3 + 0] / cnt[c];
      centers[c * 3 + 1] = sum[c * 3 + 1] / cnt[c];
      centers[c * 3 + 2] = sum[c * 3 + 2] / cnt[c];
    }
  }

  // counts
  const counts = new Uint32Array(k);
  for (let p = 0; p < n; p++) counts[labels[p]]++;

  return { centers, counts, labels };
}

function uniqueApproxColors(bytes, maxUniq) {
  // Cheap uniqueness on 5-bit quantization
  const set = new Set();
  const n = (bytes.length / 3) | 0;
  const step = Math.max(1, (n / 20000) | 0);
  for (let p = 0; p < n; p += step) {
    const r = bytes[p * 3 + 0] >> 3;
    const g = bytes[p * 3 + 1] >> 3;
    const b = bytes[p * 3 + 2] >> 3;
    set.add((r << 10) | (g << 5) | b);
    if (set.size > maxUniq) break;
  }
  return set.size;
}

function bboxUnion(bboxes) {
  if (!bboxes.length) return null;
  let x1 = Infinity,
    y1 = Infinity,
    x2 = -Infinity,
    y2 = -Infinity;
  for (const b of bboxes) {
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1 | 0, y: y1 | 0, w: (x2 - x1) | 0, h: (y2 - y1) | 0 };
}

function nearGridGap(gap, base, thr) {
  const nearest = Math.round(gap / base) * base;
  return { nearest, diff: Math.abs(gap - nearest) };
}

function findRectsFromEdges(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    gray[p] = ((r * 54 + g * 183 + b * 19) >> 8) & 255;
  }

  // Sobel magnitude (approx)
  const mag = new Uint8Array(width * height);
  const at = (x, y) => gray[y * width + x];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const gx = -at(x - 1, y - 1) + at(x + 1, y - 1) + -2 * at(x - 1, y) + 2 * at(x + 1, y) + -at(x - 1, y + 1) + at(x + 1, y + 1);
      const gy = -at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1) + at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1);
      const m = Math.min(255, Math.sqrt(gx * gx + gy * gy) | 0);
      mag[y * width + x] = m;
    }
  }

  // threshold + dilate-ish max filter (3x3)
  const bin = new Uint8Array(width * height);
  let thr = 0;
  {
    // Otsu on mag (sample)
    const hist = new Uint32Array(256);
    const step = Math.max(1, ((width * height) / 50000) | 0);
    for (let p = 0; p < width * height; p += step) hist[mag[p]]++;
    let total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];
    let sum = 0,
      sumB = 0,
      wB = 0,
      maxVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      sum += t * hist[t];
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        thr = t;
      }
    }
  }
  for (let p = 0; p < width * height; p++) bin[p] = mag[p] >= Math.max(24, thr) ? 1 : 0;

  const strong = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          m = Math.max(m, bin[(y + dy) * width + (x + dx)]);
        }
      }
      strong[y * width + x] = m;
    }
  }

  // connected components on bin (4-neigh) to get bounding boxes
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const boxes = [];
  let labelId = 0;
  const stack = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!strong[p] || labels[p] !== -1) continue;
      let sp = 0;
      stack[sp++] = p;
      labels[p] = labelId;
      let minX = x,
        minY = y,
        maxX = x,
        maxY = y,
        cnt = 0;
      while (sp > 0) {
        const cur = stack[--sp];
        cnt++;
        const cy = (cur / width) | 0;
        const cx = cur - cy * width;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        const nbs = [cur - 1, cur + 1, cur - width, cur + width];
        for (const nb of nbs) {
          if (nb < 0 || nb >= width * height) continue;
          const ny = (nb / width) | 0;
          const nx = nb - ny * width;
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) continue;
          if (!strong[nb] || labels[nb] !== -1) continue;
          labels[nb] = labelId;
          stack[sp++] = nb;
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const area = bw * bh;
      boxes.push({ x: minX, y: minY, w: bw, h: bh, area, count: cnt });
      labelId++;
    }
  }

  const maxArea = (width * height * 0.35) | 0;
  return boxes
    .filter((b) => b.area >= 900 && b.area <= maxArea)
    .sort((a, b) => b.area - a.area)
    .slice(0, 250);
}

function spacingIssuesFromRects(rects, width, height, base = 8, thr = 3) {
  const gaps = [];
  const ySorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let i = 0; i < ySorted.length; i++) {
    const a = ySorted[i];
    const ay = a.y + a.h / 2;
    for (let j = i + 1; j < ySorted.length; j++) {
      const b = ySorted[j];
      if (b.y - a.y > 140) break; // early exit down the list
      const by = b.y + b.h / 2;
      if (Math.abs(ay - by) > 48) continue;
      // horizontal gap if b is to the right and vertically overlaps a bit
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (overlapY <= Math.min(a.h, b.h) * 0.15) continue;
      if (b.x >= a.x + a.w) {
        const gap = b.x - (a.x + a.w);
        if (gap > 0 && gap <= 240) gaps.push({ dir: "x", gap, a, b });
      }
    }
  }

  const xSorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
  for (let i = 0; i < xSorted.length; i++) {
    const a = xSorted[i];
    const ax = a.x + a.w / 2;
    for (let j = i + 1; j < xSorted.length; j++) {
      const b = xSorted[j];
      if (b.x - a.x > 220) break;
      const bx = b.x + b.w / 2;
      if (Math.abs(ax - bx) > 56) continue;
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (overlapX <= Math.min(a.w, b.w) * 0.15) continue;
      if (b.y >= a.y + a.h) {
        const gap = b.y - (a.y + a.h);
        if (gap > 0 && gap <= 240) gaps.push({ dir: "y", gap, a, b });
      }
    }
  }
  if (gaps.length < 10) return [];

  const outliers = [];
  for (const g of gaps) {
    const { nearest, diff } = nearGridGap(g.gap, base, thr);
    if (diff >= thr) outliers.push({ ...g, nearest, diff });
  }
  if (!outliers.length) return [];
  outliers.sort((a, b) => b.diff - a.diff);
  const top = outliers.slice(0, 12);
  const bboxes = top.map((o) => bboxUnion([{ x: o.a.x, y: o.a.y, w: o.a.w, h: o.a.h }, { x: o.b.x, y: o.b.y, w: o.b.w, h: o.b.h }]));
  return [
    {
      id: `SpacingAndGridConsistency-${hashString("grid" + top[0].gap + top[0].nearest)}`,
      dimension: "SpacingAndGridConsistency",
      severity: outliers.length >= 20 ? "high" : "medium",
      title: "检测到间距/网格一致性离群点（偏离 8pt 网格）",
      evidence: {
        grid_base_px: base,
        outlier_samples: top.map((o) => ({ dir: o.dir, gap_px: o.gap, nearest_grid_px: o.nearest, diff_px: o.diff })),
        note: "该检测是图像启发式推断（不依赖 UI 结构文件），用于发现明显的间距离群点。",
      },
      suggestion: `将离群间距对齐到 ${base}px 网格（例如把 ${top[0].gap}px 调整为 ${top[0].nearest}px），并尽量让同类模块的水平/垂直间距复用同一组 spacing token（8/16/24/32 等）。`,
      bboxes,
    },
  ];
}

function typographyIssueFromImage(imageData, seed) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    gray[p] = ((r * 54 + g * 183 + b * 19) >> 8) & 255;
  }

  // blackhat-ish: max(0, blur - orig) using box blur approx
  const blur = boxBlurGray(gray, width, height, 5);
  const bh = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) bh[p] = blur[p] > gray[p] ? clamp(blur[p] - gray[p], 0, 255) : 0;

  // Otsu threshold on bh (sampled)
  const hist = new Uint32Array(256);
  const step = Math.max(1, ((width * height) / 60000) | 0);
  for (let p = 0; p < width * height; p += step) hist[bh[p]]++;
  let thr = 0;
  {
    let total = 0;
    for (let i = 0; i < 256; i++) total += hist[i];
    let sum = 0,
      sumB = 0,
      wB = 0,
      maxVar = -1;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      sum += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > maxVar) {
        maxVar = between;
        thr = t;
      }
    }
  }
  thr = Math.max(8, thr);
  const bin = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) bin[p] = bh[p] >= thr ? 1 : 0;

  // connected components on bin
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const blobs = [];
  const stack = new Int32Array(width * height);
  const maxBlobArea = ((width * height) / 50) | 0; // 2%
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!bin[p] || labels[p] !== -1) continue;
      let sp = 0;
      stack[sp++] = p;
      labels[p] = 1;
      let minX = x,
        minY = y,
        maxX = x,
        maxY = y,
        cnt = 0;
      while (sp > 0) {
        const cur = stack[--sp];
        cnt++;
        const cy = (cur / width) | 0;
        const cx = cur - cy * width;
        minX = Math.min(minX, cx);
        minY = Math.min(minY, cy);
        maxX = Math.max(maxX, cx);
        maxY = Math.max(maxY, cy);
        const nbs = [cur - 1, cur + 1, cur - width, cur + width];
        for (const nb of nbs) {
          if (nb < 0 || nb >= width * height) continue;
          if (!bin[nb] || labels[nb] !== -1) continue;
          labels[nb] = 1;
          stack[sp++] = nb;
        }
      }
      const bw = maxX - minX + 1;
      const bh2 = maxY - minY + 1;
      const area = bw * bh2;
      if (area < 40 || area > maxBlobArea) continue;
      if (bw <= 2 || bh2 <= 2) continue;
      if (bh2 < 8 || bh2 > (height * 0.18) | 0) continue;
      blobs.push({ x: minX, y: minY, w: bw, h: bh2, area });
    }
  }
  if (blobs.length < 25) return [];

  const heights = blobs.map((b) => b.h).sort((a, b) => a - b);
  const mergePx = 2;
  const tiers = [];
  for (const hh of heights) {
    if (!tiers.length || Math.abs(hh - tiers[tiers.length - 1]) > mergePx) tiers.push(hh);
  }
  if (tiers.length <= 6) return [];

  const tiersArr = new Int32Array(tiers);
  const diffs = blobs.map((b) => {
    let best = tiersArr[0];
    let bestD = Infinity;
    for (const t of tiersArr) {
      const d = Math.abs(b.h - t);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return { d: Math.abs(b.h - best), b };
  });
  diffs.sort((a, b) => b.d - a.d);
  const top = diffs.slice(0, 12).map((x) => x.b);
  return [
    {
      id: `TypographyConsistency-${hashString("tiers" + tiers.length + seed)}`,
      dimension: "TypographyConsistency",
      severity: "medium",
      title: "检测到过多的字号层级（截图中疑似存在过多不同的文本高度）",
      evidence: {
        estimated_size_tiers_px: tiers.slice(0, 20),
        tier_count: tiers.length,
        note: "该检测不依赖 OCR，仅用“文本笔画形态 + 连通域高度”估计字号层级；可能把图标/细线误判为文本。",
      },
      suggestion: "把文本层级收敛到更少的 token（例如 Title/Body/Caption 等 3-5 档），并确保同语义文本在不同模块复用同一字号/字重组合。",
      bboxes: top.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    },
  ];
}

function boxBlurGray(src, w, h, r) {
  // separable box blur, r must be odd
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const rad = (r - 1) >> 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const row = y * w;
    for (let x = -rad; x < w + rad; x++) {
      const xx = clamp(x, 0, w - 1);
      sum += src[row + xx];
      if (x >= rad) {
        const xo = x - rad;
        if (xo >= 0 && xo < w) tmp[row + xo] = (sum / r) | 0;
        const xleave = x - (r - 1) - rad;
        if (xleave >= 0) {
          const xl = clamp(xleave, 0, w - 1);
          sum -= src[row + xl];
        }
      }
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -rad; y < h + rad; y++) {
      const yy = clamp(y, 0, h - 1);
      sum += tmp[yy * w + x];
      if (y >= rad) {
        const yo = y - rad;
        if (yo >= 0 && yo < h) out[yo * w + x] = (sum / r) | 0;
        const yleave = y - (r - 1) - rad;
        if (yleave >= 0) {
          const yl = clamp(yleave, 0, h - 1);
          sum -= tmp[yl * w + x];
        }
      }
    }
  }
  return out;
}

function medianCornerRadiusFromPatch(imageData, x0, y0, rw, rh) {
  const { data, width } = imageData;
  const cropW = rw,
    cropH = rh;
  if (cropW < 18 || cropH < 18) return null;

  const bgR = [],
    bgG = [],
    bgB = [];
  const pushBorder = (x, y) => {
    const ix = x0 + x;
    const iy = y0 + y;
    if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) return;
    const p = (iy * imageData.width + ix) * 4;
    bgR.push(data[p]);
    bgG.push(data[p + 1]);
    bgB.push(data[p + 2]);
  };
  for (let x = 0; x < cropW; x++) {
    pushBorder(x, 0);
    pushBorder(x, 1);
    pushBorder(x, cropH - 2);
    pushBorder(x, cropH - 1);
  }
  for (let y = 0; y < cropH; y++) {
    pushBorder(0, y);
    pushBorder(1, y);
    pushBorder(cropW - 2, y);
    pushBorder(cropW - 1, y);
  }
  const med = (arr) => {
    const a = arr.sort((x, y) => x - y);
    return a[(a.length / 2) | 0];
  };
  const br = med([...bgR]),
    bg = med([...bgG]),
    bb = med([...bgB]);

  const scan = (coords) => {
    for (let i = 0; i < coords.length; i++) {
      const [x, y] = coords[i];
      const ix = x0 + x;
      const iy = y0 + y;
      const p = (iy * width + ix) * 4;
      const dr = data[p] - br;
      const dg = data[p + 1] - bg;
      const db = data[p + 2] - bb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      if (dist > 18) return i + 1;
    }
    return null;
  };

  const limit = Math.min(cropW, cropH, 48);
  const tl = scan(
    Array.from({ length: limit }, (_, i) => [i, i]),
  );
  const tr = scan(
    Array.from({ length: limit }, (_, i) => [cropW - 1 - i, i]),
  );
  const bl = scan(
    Array.from({ length: limit }, (_, i) => [i, cropH - 1 - i]),
  );
  const brc = scan(
    Array.from({ length: limit }, (_, i) => [cropW - 1 - i, cropH - 1 - i]),
  );
  const vals = [tl, tr, bl, brc].filter((v) => v !== null).map((v) => v | 0);
  if (vals.length < 2) return null;
  vals.sort((a, b) => a - b);
  return vals[(vals.length / 2) | 0];
}

function componentStyleIssueFromRects(imageData, rects) {
  const maxArea = (imageData.width * imageData.height * 0.22) | 0;
  const cand = rects
    .filter((r) => r.area >= 1600 && r.area <= maxArea)
    .filter((r) => {
      const ar = r.w / Math.max(1, r.h);
      return ar >= 0.25 && ar <= 5.0;
    })
    .slice(0, 120);

  const radii = [];
  const samples = [];
  for (const r of cand) {
    const rad = medianCornerRadiusFromPatch(imageData, r.x, r.y, r.w, r.h);
    if (rad === null) continue;
    radii.push(rad);
    samples.push({ bbox: r, radius_px: rad });
  }
  if (radii.length < 10) return [];

  radii.sort((a, b) => a - b);
  const median = radii[(radii.length / 2) | 0];
  const mad = (() => {
    const ds = radii.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
    return ds[(ds.length / 2) | 0];
  })();
  const tol = Math.max(3, 2 + mad);
  const out = samples.filter((s) => Math.abs(s.radius_px - median) >= tol);
  if (!out.length) return [];
  out.sort((a, b) => Math.abs(b.radius_px - median) - Math.abs(a.radius_px - median));
  const top = out.slice(0, 12);
  return [
    {
      id: `ComponentStyleConsistency-${hashString("rad" + median + tol)}`,
      dimension: "ComponentStyleConsistency",
      severity: "medium",
      title: "检测到组件圆角风格不一致（疑似存在圆角半径离群点）",
      evidence: {
        radius_median_px: median,
        radius_mad_px: mad,
        outlier_tolerance_px: tol,
        sample_count: samples.length,
        outlier_examples: top.map((s) => ({ radius_px: s.radius_px })),
        note: "该检测是截图启发式估计：用组件 bbox 内角落像素与背景的差异推测圆角半径。",
      },
      suggestion: `为同一类组件统一圆角 token（例如统一到 ~${median}px），避免同屏出现多个接近但不同的圆角半径（会破坏一致性）。`,
      bboxes: top.map((s) => ({ x: s.bbox.x, y: s.bbox.y, w: s.bbox.w, h: s.bbox.h })),
    },
  ];
}

function dominantColorRgbFromBytes(bytes) {
  const n = (bytes.length / 3) | 0;
  let sampleBytes = bytes;
  if (n > 25000) {
    const rnd = mulberry32(42);
    sampleBytes = new Uint8Array(25000 * 3);
    for (let i = 0; i < 25000; i++) {
      const p = (rnd() * n) | 0;
      sampleBytes[i * 3 + 0] = bytes[p * 3 + 0];
      sampleBytes[i * 3 + 1] = bytes[p * 3 + 1];
      sampleBytes[i * 3 + 2] = bytes[p * 3 + 2];
    }
  }

  const k = Math.min(3, Math.max(1, uniqueKFromBytes(sampleBytes)));
  const km = kMeansRgb(sampleBytes, k, 12, 42);
  return kMeansCentersToRgb(km.centers, km.counts);
}

function uniqueKFromBytes(bytes) {
  const u = uniqueApproxColors(bytes, 4000);
  return clamp(u, 1, 256);
}

function kMeansCentersToRgb(centers, counts) {
  let best = 0;
  for (let c = 1; c < counts.length; c++) {
    if (counts[c] > counts[best]) best = c;
  }
  const r = centers[best * 3 + 0] | 0;
  const g = centers[best * 3 + 1] | 0;
  const b = centers[best * 3 + 2] | 0;
  return { r, g, b };
}

function medianRadiusFromImage(imageData, rects) {
  const maxArea = (imageData.width * imageData.height * 0.22) | 0;
  const cand = rects
    .filter((r) => r.area >= 1600 && r.area <= maxArea)
    .filter((r) => {
      const ar = r.w / Math.max(1, r.h);
      return ar >= 0.25 && ar <= 5.0;
    })
    .slice(0, 120);
  const radii = [];
  for (const r of cand) {
    const rad = medianCornerRadiusFromPatch(imageData, r.x, r.y, r.w, r.h);
    if (rad !== null) radii.push(rad);
  }
  if (radii.length < 5) return null;
  radii.sort((a, b) => a - b);
  return radii[(radii.length / 2) | 0];
}

export async function analyzeFiles(files, { seed = 42 } = {}) {
  const decoded = [];
  for (const f of files) {
    const bmp = await decodeBitmap(f);
    decoded.push({ name: f.name || "upload.png", bmp, file: f });
  }

  const perScreen = [];
  const issuesAll = [];

  for (let idx = 0; idx < decoded.length; idx++) {
    const { name, bmp } = decoded[idx];
    const ctx = bmp.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);

    const screenIssues = [];

    // Color
    const sample = sampleImagePixels(imageData, 30000, seed);
    const uniqK = clamp(Math.min(7, Math.max(1, uniqueApproxColors(sample.bytes, 5000))), 1, 7);
    const km = kMeansRgb(sample.bytes, uniqK, 15, seed);
    const palette = [];
    const total = sample.count;
    for (let c = 0; c < uniqK; c++) {
      const p = km.counts[c] / total;
      const r = km.centers[c * 3 + 0] | 0;
      const g = km.centers[c * 3 + 1] | 0;
      const b = km.centers[c * 3 + 2] | 0;
      palette.push({ rgb: [r, g, b], hex: rgbToHex(r, g, b), p });
    }
    const labs = palette.map((x) => rgbToLab01(x.rgb[0], x.rgb[1], x.rgb[2]));
    const near = [];
    const minProp = 0.02;
    for (let i = 0; i < uniqK; i++) {
      if (palette[i].p < minProp) continue;
      for (let j = i + 1; j < uniqK; j++) {
        if (palette[j].p < minProp) continue;
        const de = deltaE76Lab01(labs[i], labs[j]);
        if (de <= 8) near.push({ a: { idx: i, hex: palette[i].hex, p: palette[i].p }, b: { idx: j, hex: palette[j].hex, p: palette[j].p }, deltaE: Math.round(de * 100) / 100 });
      }
    }
    if (near.length) {
      screenIssues.push({
        id: `ColorConsistency-${hashString(name + "near")}`,
        dimension: "ColorConsistency",
        severity: "medium",
        title: "检测到近似色漂移（调色板中存在非常接近的颜色）",
        evidence: { palette, near_pairs: near.sort((a, b) => a.deltaE - b.deltaE), min_cluster_proportion: minProp, note: "近似色漂移常导致同类控件在不同位置看起来“不完全一致”。" },
        suggestion: "将这些近似色合并为更少的设计 token（例如统一成 1 个文本灰/分割线灰），并在同类控件上强制复用同一个颜色值。",
        bboxes: [{ x: 0, y: 0, w: bmp.width, h: bmp.height }],
      });
    }

    // rects shared
    const rects = findRectsFromEdges(imageData);
    screenIssues.push(...spacingIssuesFromRects(rects, bmp.width, bmp.height, 8, 3));
    screenIssues.push(...typographyIssueFromImage(imageData, seed + idx));
    screenIssues.push(...componentStyleIssueFromRects(imageData, rects));

    issuesAll.push(...screenIssues);
    perScreen.push({ file: name, width: bmp.width, height: bmp.height, issue_count: screenIssues.length });
  }

  // cross screen
  if (decoded.length >= 2) {
    const doms = decoded.map(({ bmp }) => {
      const ctx = bmp.getContext("2d", { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const sample = sampleImagePixels(imageData, 25000, seed);
      return dominantColorRgbFromBytes(sample.bytes);
    });
    const labs = doms.map((c) => rgbToLab01(c.r, c.g, c.b));
    let maxDe = 0;
    let pair = [0, 1];
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const de = deltaE76Lab01(labs[i], labs[j]);
        if (de > maxDe) {
          maxDe = de;
          pair = [i, j];
        }
      }
    }
    if (maxDe >= 12) {
      issuesAll.push({
        id: `CrossScreenConsistency-${hashString("dom" + maxDe.toFixed(2))}`,
        dimension: "CrossScreenConsistency",
        severity: maxDe >= 20 ? "high" : "medium",
        title: "跨页面主色存在明显漂移（同一产品的整体视觉不够统一）",
        evidence: {
          dominant_colors: decoded.map(({ name }, i) => ({
            file: name,
            rgb: [doms[i].r, doms[i].g, doms[i].b],
            hex: rgbToHex(doms[i].r, doms[i].g, doms[i].b),
          })),
          max_deltaE: Math.round(maxDe * 100) / 100,
          max_pair: [decoded[pair[0]].name, decoded[pair[1]].name],
        },
        suggestion: "统一全局色彩 token（品牌主色/背景/文本/分割线），并确保不同页面复用同一套 token，而不是“看起来差不多”的近似值。",
        bboxes: [],
      });
    }

    const medRs = decoded.map(({ bmp }) => {
      const ctx = bmp.getContext("2d", { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, bmp.width, bmp.height);
      const rects = findRectsFromEdges(imageData);
      return medianRadiusFromImage(imageData, rects);
    });
    const valid = medRs.map((r, i) => ({ i, r })).filter((x) => x.r !== null);
    if (valid.length >= 2) {
      const rs = valid.map((x) => x.r);
      const rRange = Math.max(...rs) - Math.min(...rs);
      if (rRange >= 5) {
        issuesAll.push({
          id: `CrossScreenConsistency-${hashString("radRange" + rRange)}`,
          dimension: "CrossScreenConsistency",
          severity: "medium",
          title: "跨页面组件圆角风格不一致（圆角 token 可能未统一）",
          evidence: {
            estimated_median_radius_px: valid.map((x) => ({ file: decoded[x.i].name, median_radius_px: x.r })),
            range_px: rRange,
            note: "该检测是截图启发式估计：并不保证识别到的全部都是同一类组件。",
          },
          suggestion: "为按钮/卡片等核心组件统一圆角半径（例如统一为 8/12/16px），并保证所有页面复用同一套组件库样式。",
          bboxes: [],
        });
      }
    }
  }

  const dims = ["ColorConsistency", "SpacingAndGridConsistency", "TypographyConsistency", "ComponentStyleConsistency"];
  if (decoded.length > 1) dims.push("CrossScreenConsistency");

  const dimScores = scoreDimensions(issuesAll, dims);
  const overall = dimScores.length ? Math.round((dimScores.reduce((s, d) => s + d.score, 0) / dimScores.length) * 10) / 10 : 100;

  const runId = hashString(decoded.map((d) => d.name).join("|") + String(seed)).slice(0, 12);

  return {
    principle: "Apple Consistency",
    overall_score: overall,
    dimension_scores: dimScores,
    issues: issuesAll,
    meta: {
      analyzed_files: decoded.map((d) => d.name),
      per_screen: perScreen,
      elapsed_ms: null,
      mode: "browser_only",
    },
    run_id: runId,
    decoded,
    first_bitmap: decoded[0]?.bmp || null,
    first_file: decoded[0]?.file || null,
  };
}

function scoreDimensions(issues, expectedDimensions) {
  const by = new Map();
  for (const it of issues) {
    if (!by.has(it.dimension)) by.set(it.dimension, []);
    by.get(it.dimension).push(it);
  }
  const out = [];
  for (const dim of expectedDimensions) {
    const list = by.get(dim) || [];
    let penalty = 0;
    for (const it of list) penalty += it.severity === "high" ? 18 : it.severity === "medium" ? 10 : 4;
    const score = Math.max(0, Math.round((100 - penalty) * 10) / 10);
    out.push({ dimension: dim, score, summary: `${list.length} 个问题` });
  }
  return out;
}

async function decodeBitmap(file) {
  const url = URL.createObjectURL(file);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`无法读取图片文件（${res.status}）。`);
    }
    const blob = await res.blob();
    // createImageBitmap 需要 Blob / ImageBitmapSource，不能传入 Response，否则会抛错导致无法分析
    const bmp = await createImageBitmap(blob);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(bmp.width, bmp.height)
        : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bmp.close?.();
      throw new Error("当前环境无法创建画布上下文，请换用 Chrome / Edge / Safari 最新版本。");
    }
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function buildReportHtml({ result, filename, imageBitmap }) {
  const c =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
      : Object.assign(document.createElement("canvas"), { width: imageBitmap.width, height: imageBitmap.height });
  const cx = c.getContext("2d");
  cx.drawImage(imageBitmap, 0, 0);
  let b64 = "";
  if (typeof c.convertToBlob === "function") {
    const blob = await c.convertToBlob({ type: "image/png" });
    const buf = await blob.arrayBuffer();
    const u8 = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    }
    b64 = btoa(bin);
  } else if (typeof c.toBlob === "function") {
    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
    if (!blob) {
      b64 = c.toDataURL("image/png").split(",")[1] || "";
    } else {
      const buf = await blob.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < u8.length; i += chunk) {
        bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
      }
      b64 = btoa(bin);
    }
  } else {
    b64 = c.toDataURL("image/png").split(",")[1] || "";
  }
  const allBoxes = (result.issues || []).flatMap((it) => (it.bboxes || []).map((b) => b));

  const esc = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const issuesHtml = (result.issues || [])
    .map((it) => {
      const ev = esc(JSON.stringify(it.evidence || {}, null, 2));
      return `
          <div class="issue">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
              <div style="font-weight:700">${esc(it.title)}</div>
              <div class="badge">${esc(it.dimension)} · ${esc(it.severity)}</div>
            </div>
            <div style="margin-top:6px;font-size:13px;color:#444"><b>建议：</b>${esc(it.suggestion)}</div>
            <details style="margin-top:8px">
              <summary style="cursor:pointer;color:#444">证据（展开）</summary>
              <pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;border-radius:10px;padding:10px;font-size:12px">${ev}</pre>
            </details>
          </div>`;
    })
    .join("\n");

  const dimsHtml = (result.dimension_scores || [])
    .map(
      (d) => `
        <div class="dim">
          <div>${esc(d.dimension)}</div>
          <div><b>${esc(String(d.score))}</b> <span style="color:#666;font-size:12px">${esc(d.summary)}</span></div>
        </div>`,
    )
    .join("\n");

  const rectsSvg = allBoxes
    .map((b) => `<rect class="box" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"></rect>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Apple一致性原则评估报告</title>
  <style>
    body{font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;margin:24px;line-height:1.45;color:#111}
    .grid{display:grid;grid-template-columns:1fr;gap:16px;max-width:1100px}
    .card{border:1px solid #e6e6e6;border-radius:12px;padding:16px}
    .score{font-size:40px;font-weight:700}
    .dim{display:flex;justify-content:space-between;border-top:1px solid #eee;padding:10px 0}
    .issues{display:flex;flex-direction:column;gap:12px}
    .issue{border:1px solid #eee;border-radius:12px;padding:12px}
    .badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;background:#f5f5f5}
    .imgWrap{position:relative;display:inline-block;max-width:100%}
    img{max-width:100%;border-radius:12px;border:1px solid #eee}
    svg{position:absolute;left:0;top:0}
    .box{fill:rgba(255,59,48,0.12);stroke:rgba(255,59,48,0.9);stroke-width:2}
  </style>
</head>
<body>
  <div class="grid">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">
        <div>
          <div style="font-size:14px;color:#666">${esc(result.principle || "Apple Consistency")}</div>
          <div style="font-size:22px;font-weight:700">一致性评估报告</div>
          <div style="font-size:13px;color:#666">文件：${esc(filename)}</div>
        </div>
        <div class="score">${esc(String(result.overall_score))}</div>
      </div>
      <div style="margin-top:10px;color:#666;font-size:13px">
        说明：本报告由浏览器本地计算生成（不上传图片到服务器）。标注为启发式推断，可能存在误判。
      </div>
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">维度得分</div>
      ${dimsHtml}
    </div>

    <div class="card">
      <div style="font-weight:700;margin-bottom:8px">问题与标注</div>
      <div class="imgWrap">
        <img src="data:image/png;base64,${b64}" alt="UI Screenshot" />
        <svg width="${imageBitmap.width}" height="${imageBitmap.height}" viewBox="0 0 ${imageBitmap.width} ${imageBitmap.height}">
          ${rectsSvg}
        </svg>
      </div>
      <div style="margin-top:12px" class="issues">
        ${issuesHtml}
      </div>
    </div>
  </div>
</body>
</html>`;
}
