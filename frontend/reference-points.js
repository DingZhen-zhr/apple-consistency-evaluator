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
  {
    id: "ref-xiaomi-miui14-about",
    brand: "Xiaomi",
    label: "MIUI 14（关于手机）",
    x: 70,
    y: 62,
    imageUrl: "./assets/reference/xiaomi/miui_14_about_phone.png",
    thumbUrl: "./assets/reference/xiaomi/miui_14_about_phone.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:MIUI_14_About_Phone.png",
    license: "CC BY-SA 4.0",
  },
  {
    id: "ref-google-pixel4a-lens",
    brand: "Google",
    label: "Pixel 4A（相机/扫码）",
    x: 74,
    y: 66,
    imageUrl: "./assets/reference/google/pixel4a_google_lens_qr.png",
    thumbUrl: "./assets/reference/google/pixel4a_google_lens_qr.png",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/File:Google_Lens_QR_Code_scanner_in_Google_Camera_-_Google_Pixel_4A_(2022).png",
    license: "CC BY-SA 4.0",
  },
  {
    id: "ref-oppo-a57-lineageos",
    brand: "OPPO",
    label: "A57（LineageOS）",
    x: 60,
    y: 56,
    imageUrl: "./assets/reference/oppo/oppo_a57_lineageos.jpg",
    thumbUrl: "./assets/reference/oppo/oppo_a57_lineageos.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:OPPO_A57_LineageOS.jpg",
    license: "CC BY-SA 4.0",
  },
];
