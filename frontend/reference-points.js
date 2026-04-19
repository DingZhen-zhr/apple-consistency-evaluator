/**
 * 参考界面点
 *
 * 优先从 batch_analyze.py 生成的 reference-data.json 加载（含实际算法计算的坐标），
 * 若加载失败则回退到内置静态数据。
 */

// 内置静态参考点（仅含 Wikipedia/Wikimedia 素材的点，作为最小兜底）
export const REFERENCE_POINTS = [
  {
    id: "ref-apple-ios-18-4-1",
    brand: "Apple",
    label: "iOS 18.4.1（截图）",
    x: 88,
    y: 86,
    imageUrl: "./assets/reference/apple/ios_18_4_1_settings_like.png",
    thumbUrl: "./assets/reference/apple/ios_18_4_1_settings_like.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:IOS_18.4.1_screenshot_(2025).png",
    license: "CC BY-SA 4.0",
  },
  {
    id: "ref-apple-ios-17-lock",
    brand: "Apple",
    label: "iOS 17（锁屏）",
    x: 78,
    y: 70,
    imageUrl: "./assets/reference/apple/ios_17_lockscreen.png",
    thumbUrl: "./assets/reference/apple/ios_17_lockscreen.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:IOS_17_Lockscreen.png",
    license: "Public domain",
  },
  {
    id: "ref-apple-ios-17-2-kbd-n",
    brand: "Apple",
    label: "iOS 17.2（键盘：Northern Sami）",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
    thumbUrl: "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:IOS_17.2_screenshot_showing_the_Northern_S%C3%A1mi_virtual_keyboard.png",
    license: "CC0 1.0",
  },
  {
    id: "ref-apple-ios-17-2-kbd-p",
    brand: "Apple",
    label: "iOS 17.2（键盘：Pite Sami）",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    thumbUrl: "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:IOS_17.2_screenshot_showing_the_Pite_Sami_virtual_keyboard.png",
    license: "CC0 1.0",
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

    return data.map((d, i) => ({
      id: `ref-${d.brand}-${i}`,
      brand: brandDisplayName(d.brand),
      label: d.filename,
      x: d.clarity_score,
      y: d.consistency_score,
      imageUrl: "",
      thumbUrl: "",
      sourceUrl: "",
      license: "",
      features: {
        color_score: d.color_score,
        spacing_score: d.spacing_score,
        corner_score: d.corner_score,
        typo_score: d.typo_score,
        clarity_score: d.clarity_score,
        consistency_score: d.consistency_score,
      },
    }));
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