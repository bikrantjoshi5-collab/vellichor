export interface RestoreScrollParams {
  savedOffsetY: number;
  savedPct: number;
  savedParagraphIdx: number;
  blockYMap: Record<number, number>;
  contentHeight: number;
  viewportHeight: number;
}

/**
 * Computes the exact scroll Y position to restore when reopening a chapter mid-read or mid-TTS.
 * - Uses exact saved pixel offset when layout matches the saved percentage (pixel-exact resume).
 * - Falls back to exact paragraph Y if font size / line spacing changed (paragraph-exact resume).
 * - Falls back to proportional percentage if paragraph layout hasn't been measured yet.
 */
export function computeRestoreScrollY(params: RestoreScrollParams): number {
  const maxScroll = Math.max(0, params.contentHeight - params.viewportHeight);
  if (maxScroll <= 0) return 0;

  const pct = Math.max(0, Math.min(100, params.savedPct || 0));
  const offsetY = Math.max(0, params.savedOffsetY || 0);

  if (offsetY > 0) {
    const impliedPct = (Math.min(offsetY, maxScroll) / maxScroll) * 100;
    if (pct === 0 || Math.abs(impliedPct - pct) <= 6) {
      return Math.round(Math.min(maxScroll, offsetY));
    }
  }

  if (params.savedParagraphIdx > 0 && params.blockYMap[params.savedParagraphIdx] !== undefined) {
    return Math.round(Math.min(maxScroll, Math.max(0, params.blockYMap[params.savedParagraphIdx])));
  }

  if (pct > 0) {
    return Math.round((pct / 100) * maxScroll);
  }

  return 0;
}

export function findNearestParagraphIndex(
  blockYMap: Record<number, number>,
  scrollY: number
): number {
  let closestIdx = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const [idxStr, y] of Object.entries(blockYMap)) {
    const dist = Math.abs(y - scrollY);
    if (dist < bestDist) {
      bestDist = dist;
      closestIdx = Number(idxStr);
    }
  }
  return closestIdx;
}
