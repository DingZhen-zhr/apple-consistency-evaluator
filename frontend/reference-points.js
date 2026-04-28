/**
 * 参考界面点
 *
 * 优先从 batch_analyze.py 生成的 reference-data.json 加载（含实际算法计算的坐标），
 * 若加载失败则回退到内置静态数据。
 */

// 内置静态参考点（作为 reference-data.json 加载失败时的最小兜底）
export const REFERENCE_POINTS = [
  {
    id: "ref-apple-1",
    brand: "Apple",
    label: "apple1.webp",
    x: 88,
    y: 86,
    imageUrl: "./assets/reference/apple/apple1.webp",
    thumbUrl: "./assets/reference/apple/apple1.webp",
    sourceUrl: "./assets/reference/apple/apple1.webp",
    license: "本地素材",
  },
  {
    id: "ref-apple-2",
    brand: "Apple",
    label: "apple2.webp",
    x: 78,
    y: 70,
    imageUrl: "./assets/reference/apple/apple2.webp",
    thumbUrl: "./assets/reference/apple/apple2.webp",
    sourceUrl: "./assets/reference/apple/apple2.webp",
    license: "本地素材",
  },
  {
    id: "ref-apple-3",
    brand: "Apple",
    label: "apple3.jpg",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/apple3.jpg",
    thumbUrl: "./assets/reference/apple/apple3.jpg",
    sourceUrl: "./assets/reference/apple/apple3.jpg",
    license: "本地素材",
  },
  {
    id: "ref-apple-4",
    brand: "Apple",
    label: "apple4.jpg",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/apple4.jpg",
    thumbUrl: "./assets/reference/apple/apple4.jpg",
    sourceUrl: "./assets/reference/apple/apple4.jpg",
    license: "本地素材",
  },
];

/**
 * 从 reference-data.json 加载批量分析结果
 * @returns {Promise<Array>} 参考点数组
 */
export async function loadReferenceData() {
  try {
    const res = await fetch("./reference-data.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data.map((d, i) => {
      // 直接使用该条目对应的真实截图文件（brand/filename 一一对应）
      const imgUrl = `./assets/reference/${d.brand}/${d.filename}`;

      return {
        id: `ref-${d.brand}-${i}`,
        brand: brandDisplayName(d.brand),
        label: d.filename,
        x: d.clarity_score,
        y: d.consistency_score,
        imageUrl: imgUrl,
        thumbUrl: imgUrl,
        sourceUrl: imgUrl,
        license: "本地素材",
        features: {
          color_score: d.color_score,
          spacing_score: d.spacing_score,
          corner_score: d.corner_score,
          typo_score: d.typo_score,
          clarity_score: d.clarity_score,
          consistency_score: d.consistency_score,
        },
      };
    });
  } catch (e) {
    console.warn("Failed to load reference-data.json:", e);
    return null;
  }
}

function brandDisplayName(brand) {
  const map = {
    apple: "Apple",
    google: "Google",
    huawei: "Huawei",
    honor: "Honor",
    oppo: "OPPO",
    samsung: "Samsung",
    vivo: "Vivo",
    xiaomi: "Xiaomi",
  };
  return map[brand?.toLowerCase()] || brand || "Unknown";
}