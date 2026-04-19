/**
 * 双轴（0-100）Apple 一致性评估
 *
 * X 轴：Clarity（清晰度）
 *   基于 Sha et al. 2025 视觉复杂度公式的反转
 *   clarity_score = (1 - complexity_01) * 100
 *
 * Y 轴：Consistency（一致性）
 *   0.30 * color_score + 0.30 * spacing_score + 0.20 * corner_score + 0.20 * typo_score
 */

export function getDimensionScore(result, dimension) {
  const list = result?.dimension_scores || [];
  const found = list.find((d) => d.dimension === dimension);
  return found != null ? Number(found.score) : null;
}

function clamp(x, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * 从后端 features 计算散点图双轴坐标
 */
export function computeAxesFromFeatures(features) {
  // X: Clarity (直接取后端计算值)
  const clarity = Number(features?.clarity_score);
  const x = Number.isFinite(clarity) ? clamp(clarity) : 50;

  // Y: Consistency (直接取后端计算值或从分项加权)
  const consistency = Number(features?.consistency_score);
  let y;
  if (Number.isFinite(consistency)) {
    y = clamp(consistency);
  } else {
    const color = Number(features?.color_score) || 70;
    const spacing = Number(features?.spacing_score) || 70;
    const corner = Number(features?.corner_score) || 70;
    const typo = Number(features?.typo_score) || 70;
    y = clamp(0.30 * color + 0.30 * spacing + 0.20 * corner + 0.20 * typo);
  }

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    xLabel: "Clarity（视觉清晰度）",
    yLabel: "Consistency（设计一致性）",
    explain: {
      clarity_score: Number.isFinite(clarity) ? Math.round(clarity * 10) / 10 : null,
      color_score: features?.color_score ?? null,
      spacing_score: features?.spacing_score ?? null,
      corner_score: features?.corner_score ?? null,
      typo_score: features?.typo_score ?? null,
      formula: "X = clarity_score; Y = 0.30*color + 0.30*spacing + 0.20*corner + 0.20*typo",
    },
  };
}

/**
 * 兼容：若 features 不存在，则回退到维度分均值坐标。
 */
export function computeScatterAxes(result) {
  // 优先使用 meta.axis_scores (后端已计算)
  const axis = result?.meta?.axis_scores;
  if (axis && typeof axis.clarity_score === "number") {
    return {
      x: Math.round(clamp(axis.clarity_score) * 10) / 10,
      y: Math.round(clamp(axis.consistency_score) * 10) / 10,
      xLabel: "Clarity（视觉清晰度）",
      yLabel: "Consistency（设计一致性）",
      explain: {
        clarity_score: axis.clarity_score,
        color_score: axis.color_score,
        spacing_score: axis.spacing_score,
        corner_score: axis.corner_score,
        typo_score: axis.typo_score,
        formula: "X = clarity_score; Y = 0.30*color + 0.30*spacing + 0.20*corner + 0.20*typo",
      },
    };
  }

  // 次优先: 从 per_screen features
  const f = result?.meta?.features || result?.meta?.per_screen?.[0]?.features;
  if (f) return computeAxesFromFeatures(f);

  // 最终回退: 直接使用 result 上的 clarity_score / consistency_score
  if (typeof result?.clarity_score === "number") {
    return {
      x: Math.round(clamp(result.clarity_score) * 10) / 10,
      y: Math.round(clamp(result.consistency_score ?? 50) * 10) / 10,
      xLabel: "Clarity（视觉清晰度）",
      yLabel: "Consistency（设计一致性）",
    };
  }

  // 兜底
  const color = getDimensionScore(result, "ColorConsistency");
  const component = getDimensionScore(result, "ComponentStyleConsistency");
  const spacing = getDimensionScore(result, "SpacingAndGridConsistency");
  const typo = getDimensionScore(result, "TypographyConsistency");

  const all = [color, component, spacing, typo].filter((n) => n != null && Number.isFinite(n));
  const avg = all.length ? all.reduce((a, b) => a + b, 0) / all.length : 50;

  return {
    x: Math.round(avg * 10) / 10,
    y: Math.round(avg * 10) / 10,
    xLabel: "Clarity（回退：维度分均值）",
    yLabel: "Consistency（回退：维度分均值）",
  };
}