/**
 * Load a static manifest for screenshots under `photos/`.
 *
 * Why manifest?
 * - Static hosting (GitHub Pages) cannot list directories at runtime.
 * - A build step generates `photos/manifest.json` so the page can load it.
 */

export async function loadPhotoManifest() {
  try {
    const res = await fetch("./photos/manifest.json", { cache: "no-cache" });
    if (!res.ok) return { images: [] };
    const data = await res.json();
    const images = Array.isArray(data?.images) ? data.images.filter((s) => typeof s === "string") : [];
    return { images };
  } catch {
    return { images: [] };
  }
}

export function guessBrandFromPath(path) {
  const p = String(path || "").toLowerCase();
  const segs = p.split("/").filter(Boolean);

  // Prefer folder name like photos/Apple/xxx.png
  for (const s of segs) {
    if (["apple", "ios", "iphone"].includes(s)) return "Apple";
    if (["huawei", "honor", "emui", "harmonyos", "magicui", "magicos"].includes(s)) return "Huawei";
    if (["xiaomi", "mi", "redmi", "miui"].includes(s)) return "Xiaomi";
    if (["google", "pixel", "android", "aosp"].includes(s)) return "Google";
    if (["oppo", "coloros"].includes(s)) return "OPPO";
    if (["samsung", "oneui", "galaxy"].includes(s)) return "Samsung";
    if (["vivo", "funtouchos", "originos"].includes(s)) return "vivo";
    if (["realme"].includes(s)) return "realme";
    if (["meizu", "flyme"].includes(s)) return "Meizu";
    if (["lenovo", "motorola"].includes(s)) return "Motorola";
    if (["sony"].includes(s)) return "Sony";
    if (["nokia"].includes(s)) return "Nokia";
    if (["asus", "zenui"].includes(s)) return "ASUS";
    if (["oneplus", "oxygenos"].includes(s)) return "OnePlus";
  }

  // Fallback by filename keywords
  if (p.includes("miui") || p.includes("xiaomi") || p.includes("redmi")) return "Xiaomi";
  if (p.includes("huawei") || p.includes("honor") || p.includes("emui") || p.includes("harmony")) return "Huawei";
  if (p.includes("iphone") || p.includes("ios") || p.includes("apple")) return "Apple";
  if (p.includes("pixel") || p.includes("google") || p.includes("aosp") || p.includes("android")) return "Google";
  if (p.includes("oppo") || p.includes("coloros")) return "OPPO";
  if (p.includes("oneui") || p.includes("samsung") || p.includes("galaxy")) return "Samsung";
  if (p.includes("vivo") || p.includes("originos") || p.includes("funtouch")) return "vivo";
  if (p.includes("realme")) return "realme";
  if (p.includes("flyme") || p.includes("meizu")) return "Meizu";

  return "Other";
}

export function groupImagesByBrand(images) {
  const by = new Map();
  for (const rel of images || []) {
    const brand = guessBrandFromPath(rel);
    if (!by.has(brand)) by.set(brand, []);
    by.get(brand).push(rel);
  }
  for (const [k, list] of by.entries()) list.sort((a, b) => a.localeCompare(b));
  return by;
}

