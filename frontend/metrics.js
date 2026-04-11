/**
 * 与 Apple「一致性」相关的双轴指标（均映射到 0–100，来自本次评估的维度分）
 *
 * 横轴 X：视觉与组件一致性 —— ColorConsistency + ComponentStyleConsistency 的均值
 * 纵轴 Y：布局与信息层级一致性 —— SpacingAndGridConsistency + TypographyConsistency 的均值
 *
 * 「Apple 一致区」：两轴均 ≥ 阈值（默认 70），与「是否符合苹果一致性原则」的判断重叠
 */

const DEFAULT_APPLE_THRESHOLD = 70;

export function getDimensionScore(result, dimension) {
  const list = result?.dimension_scores || [];
  const found = list.find((d) => d.dimension === dimension);
  return found != null ? Number(found.score) : null;
}

/**
 * @returns {{ x: number, y: number, xLabel: string, yLabel: string, inAppleZone: boolean, appleThreshold: number }}
 */
export function computeScatterAxes(result, appleThreshold = DEFAULT_APPLE_THRESHOLD) {
  const color = getDimensionScore(result, "ColorConsistency");
  const component = getDimensionScore(result, "ComponentStyleConsistency");
  const spacing = getDimensionScore(result, "SpacingAndGridConsistency");
  const typo = getDimensionScore(result, "TypographyConsistency");

  const xParts = [color, component].filter((n) => n != null && !Number.isNaN(n));
  const yParts = [spacing, typo].filter((n) => n != null && !Number.isNaN(n));

  const x = xParts.length ? xParts.reduce((a, b) => a + b, 0) / xParts.length : 50;
  const y = yParts.length ? yParts.reduce((a, b) => a + b, 0) / yParts.length : 50;

  const xLabel = "视觉与组件一致性（色彩 / 圆角等 token）";
  const yLabel = "布局与信息层级一致性（间距网格 / 字号层级）";

  const inAppleZone = x >= appleThreshold && y >= appleThreshold;

  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    xLabel,
    yLabel,
    inAppleZone,
    appleThreshold,
  };
}
