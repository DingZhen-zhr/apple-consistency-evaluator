/**
 * 双轴：用于“品牌区分”的可解释视觉特征（0–100）
 *
 * X：形状/圆角风格（越大越“圆润”）
 *   - 由截图中估计的组件中位圆角半径（px）映射得到
 *
 * Y：色彩复杂度（越大越“多彩/丰富”）
 *   - 由调色板有效颜色数 + 颜色分布熵（0..1）映射得到
 *
 * 目标：相比用维度分均值（容易把所有品牌都挤到高分区），该坐标系更容易把不同品牌“拉开”
 * 同时仍能解释：圆角 token、色彩 token 的设计取向差异。
 */

export function getDimensionScore(result, dimension) {
  const list = result?.dimension_scores || [];
  const found = list.find((d) => d.dimension === dimension);
  return found != null ? Number(found.score) : null;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function norm(v, v0, v1) {
  if (v == null || Number.isNaN(v)) return null;
  return clamp01((v - v0) / (v1 - v0));
}

export function computeAxesFromFeatures(features) {
  const ent = Number(features?.palette_entropy_01);
  const eff = Number(features?.palette_effective_colors);
  const near = Number(features?.near_color_pairs);
  const rad = features?.median_radius_px == null ? null : Number(features?.median_radius_px);

  // Shape: 0..24px maps to 0..100 (beyond clamp)
  const shape01 = norm(rad, 0, 24) ?? 0.35;

  // Color complexity:
  // - effective colors: 1..7 (we cap at 7 from kmeans)
  // - entropy: 0..1
  // - near pairs adds a small bump (indicates drift/near-duplicates)
  const eff01 = norm(eff, 1, 7) ?? 0.35;
  const ent01 = clamp01(Number.isFinite(ent) ? ent : 0.35);
  const near01 = clamp01((Number.isFinite(near) ? near : 0) / 10);
  const color01 = clamp01(0.58 * eff01 + 0.36 * ent01 + 0.06 * near01);

  return {
    x: Math.round(shape01 * 1000) / 10,
    y: Math.round(color01 * 1000) / 10,
    xLabel: "形状/圆角风格（中位圆角半径）",
    yLabel: "色彩复杂度（有效色数 + 熵）",
  };
}

/**
 * 兼容：若 features 不存在，则回退到旧版“维度分均值”坐标。
 *
 * @returns {{ x: number, y: number, xLabel: string, yLabel: string }}
 */
export function computeScatterAxes(result) {
  const f = result?.meta?.per_screen?.[0]?.features;
  if (f) return computeAxesFromFeatures(f);

  const color = getDimensionScore(result, "ColorConsistency");
  const component = getDimensionScore(result, "ComponentStyleConsistency");
  const spacing = getDimensionScore(result, "SpacingAndGridConsistency");
  const typo = getDimensionScore(result, "TypographyConsistency");

  const xParts = [color, component].filter((n) => n != null && !Number.isNaN(n));
  const yParts = [spacing, typo].filter((n) => n != null && !Number.isNaN(n));

  const x = xParts.length ? xParts.reduce((a, b) => a + b, 0) / xParts.length : 50;
  const y = yParts.length ? yParts.reduce((a, b) => a + b, 0) / yParts.length : 50;

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    xLabel: "视觉与组件一致性（回退：维度分均值）",
    yLabel: "布局与信息层级一致性（回退：维度分均值）",
  };
}
