/**
 * 参考界面点（不可删除）
 *
 * 说明：
 * - 这里的 (x,y) 是 “兜底坐标”，页面启动后会尝试对 `imageUrl` 做同样的评估并得到“有依据的坐标”
 * - `thumbUrl` 用于散点图里显示缩略图（和用户上传点一致的样式）
 * - 素材均来自可再分发的自由许可页面；具体署名与许可见 README/ASSETS_ATTRIBUTION.md
 */
export const REFERENCE_POINTS = [
  {
    id: "ref-apple-ios-18-4-1",
    brand: "Apple",
    label: "iOS 18.4.1（截图）",
    // fallback（启动后会用同算法重新计算）
    x: 88,
    y: 86,
    imageUrl: "./assets/reference/apple/ios_18_4_1_settings_like.png",
    thumbUrl: "./assets/reference/apple/ios_18_4_1_settings_like.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:IOS_18.4.1_screenshot_(2025).png",
    license: "CC BY-SA 4.0",
  },
  {
    id: "ref-huawei-honor8x-home",
    brand: "Huawei",
    label: "Honor 8X（主屏）",
    x: 62,
    y: 58,
    imageUrl: "./assets/reference/huawei/honor8x_home_screen.jpg",
    thumbUrl: "./assets/reference/huawei/honor8x_home_screen.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Honor_8x_Home_Screen.jpg",
    license: "CC BY-SA 4.0",
  },
];
