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
    sourceUrl: "./assets/reference/apple/ios_18_4_1_settings_like.png",
    license: "本地素材",
  },
  {
    id: "ref-apple-ios-17-lock",
    brand: "Apple",
    label: "iOS 17（锁屏）",
    x: 78,
    y: 70,
    imageUrl: "./assets/reference/apple/ios_17_lockscreen.png",
    thumbUrl: "./assets/reference/apple/ios_17_lockscreen.png",
    sourceUrl: "./assets/reference/apple/ios_17_lockscreen.png",
    license: "本地素材",
  },
  {
    id: "ref-apple-ios-17-2-kbd-n",
    brand: "Apple",
    label: "iOS 17.2（键盘：Northern Sami）",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
    thumbUrl: "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
    sourceUrl: "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
    license: "本地素材",
  },
  {
    id: "ref-apple-ios-17-2-kbd-p",
    brand: "Apple",
    label: "iOS 17.2（键盘：Pite Sami）",
    x: 82,
    y: 74,
    imageUrl: "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    thumbUrl: "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    sourceUrl: "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    license: "本地素材",
  },
];

/**
 * 从 reference-data.json 加载批量分析结果
 * @returns {Promise<Array>} 参考点数组
 */
export async function loadReferenceData() {
  // 每个品牌在 frontend/assets/reference/ 下可用的代表性图片
  const BRAND_REF_IMAGES = {
    apple:   [
      "./assets/reference/apple/ios_18_4_1_settings_like.png",
      "./assets/reference/apple/ios_17_lockscreen.png",
      "./assets/reference/apple/ios_17_2_keyboard_northern_sami.png",
      "./assets/reference/apple/ios_17_2_keyboard_pite_sami.png",
    ],
    google:  [
      "./assets/reference/google/android_16_home_emulator.png",
      "./assets/reference/google/aosp_9_home_foss.png",
      "./assets/reference/google/pixel4a_google_lens_qr.png",
    ],
    huawei:  [
      "./assets/reference/huawei/mate40pro_harmonyos2.jpg",
      "./assets/reference/huawei/nova8pro_front.jpg",
      "./assets/reference/huawei/honor8x_home_screen.jpg",
      "./assets/reference/huawei/magic_ui_4_2_launcher3.jpg",
    ],
    honor:   [
      "./assets/reference/honor/honor3.webp",
      "./assets/reference/honor/honor5.webp",
    ],
    oppo:    [
      "./assets/reference/oppo/oppo_a57_lineageos.jpg",
      "./assets/reference/oppo/oppo_bdp93_booting.jpg",
      "./assets/reference/oppo/oppo_bdp93_display_logos.jpg",
    ],
    xiaomi:  [
      "./assets/reference/xiaomi/miui_14_about_phone.png",
      "./assets/reference/xiaomi/miui_v2_home.jpg",
      "./assets/reference/xiaomi/miui_v5_home.jpg",
    ],
    samsung: [
      "./assets/reference/samsung/samsung3.webp",
      "./assets/reference/samsung/samsung2.jpg",
    ],
    vivo:    [
      "./assets/reference/vivo/vivo1.webp",
      "./assets/reference/vivo/vivo5.webp",
    ],
  };

  // 每个品牌已分配了多少张（用于轮换图片）
  const brandIdx = {};

  try {
    const res = await fetch("./reference-data.json", { cache: "no-cache" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    return data.map((d, i) => {
      const imgs = BRAND_REF_IMAGES[d.brand] || [];
      const cnt  = brandIdx[d.brand] ?? 0;
      const imgUrl = imgs.length ? imgs[cnt % imgs.length] : "";
      brandIdx[d.brand] = cnt + 1;

      return {
        id: `ref-${d.brand}-${i}`,
        brand: brandDisplayName(d.brand),
        label: d.filename,
        x: d.clarity_score,
        y: d.consistency_score,
        imageUrl: imgUrl,
        thumbUrl: imgUrl,
        sourceUrl: imgUrl,
        license: imgUrl ? "本地素材" : "",
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