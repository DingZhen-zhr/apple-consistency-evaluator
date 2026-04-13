const STORAGE_KEY = "apple-consistency-scatter-v1";

/**
 * @typedef {{ id: string, type: 'user', x: number, y: number, label: string, thumbDataUrl?: string, overall_score: number, createdAt: string, resultSummary?: object }} UserPoint
 */

export function loadUserPoints() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data.points)) return [];
    return data.points.filter((p) => p && p.type === "user" && p.id);
  } catch {
    return [];
  }
}

/** @param {UserPoint[]} points */
export function saveUserPoints(points) {
  const payload = { version: 1, points };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("localStorage save failed", e);
    throw new Error("本地存储空间不足，无法保存散点。请删除旧记录或缩小图片。");
  }
}

const MAX_USER_POINTS = 60;

export function addUserPoint(point) {
  const cur = loadUserPoints();
  cur.push(point);
  while (cur.length > MAX_USER_POINTS) cur.shift();
  saveUserPoints(cur);
  return cur;
}

export function removeUserPoint(id) {
  const cur = loadUserPoints().filter((p) => p.id !== id);
  saveUserPoints(cur);
  return cur;
}

export function clearUserPoints() {
  saveUserPoints([]);
  return [];
}
