/**
 * 双轴（0–100）：既是“一致性关键指标”，也尽量能拉开品牌差异
 *
 * X：Token 纪律（颜色 token + 圆角 token 的一致性）
 * - 近似色对数量（越多说明 token 可能没收敛 / 存在漂移）
 * - 圆角离群比例（越高说明同类组件圆角 token 不统一）
 *
 * Y：节奏纪律（间距网格 + 排版层级的一致性）
 * - 网格离群比例（越高说明 spacing token 不统一）
 * - 字号层级数量（越多说明 typography token 不收敛）
 *
 * 这两轴都与 Apple 的“一致性原则”直接相关；同时在真实产品里也常能区分不同品牌的设计“纪律性”。
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
  const nearPairs = Number(features?.near_color_pairs);
  const comp = features?.component_style || {};
  const spacing = features?.spacing || {};
  const typo = features?.typography || {};

  const radiusOutlier = Number(comp?.outlier_ratio_01);
  const spacingOutlier = Number(spacing?.outlier_ratio_01);
  const tierCount = Number(typo?.tier_count);

  // Normalize / defaults
  const near01 = clamp01((Number.isFinite(nearPairs) ? nearPairs : 0) / 12); // 12+ is "many"
  const rad01 = clamp01(Number.isFinite(radiusOutlier) ? radiusOutlier : 0);
  const grid01 = clamp01(Number.isFinite(spacingOutlier) ? spacingOutlier : 0);
  const tiers01 = clamp01((Number.isFinite(tierCount) ? tierCount : 0) / 14); // 14+ tiers = very fragmented

  // Discipline = 1 - problem ratio
  const tokenDiscipline01 = clamp01(1 - (0.60 * near01 + 0.40 * rad01));
  const rhythmDiscipline01 = clamp01(1 - (0.65 * grid01 + 0.35 * tiers01));

  return {
    x: Math.round(tokenDiscipline01 * 1000) / 10,
    y: Math.round(rhythmDiscipline01 * 1000) / 10,
    xLabel: "Token 纪律（颜色/圆角一致性）",
    yLabel: "节奏 纪律（间距/排版一致性）",
    explain: {
      near_color_pairs: Number.isFinite(nearPairs) ? nearPairs : null,
      radius_outlier_ratio_01: Number.isFinite(radiusOutlier) ? radiusOutlier : null,
      spacing_outlier_ratio_01: Number.isFinite(spacingOutlier) ? spacingOutlier : null,
      typography_tier_count: Number.isFinite(tierCount) ? tierCount : null,
      formula:
        "X=1-(0.60*nearPairsN + 0.40*radiusOutlier); Y=1-(0.65*gridOutlier + 0.35*tiersN), then map to 0–100",
    },
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
