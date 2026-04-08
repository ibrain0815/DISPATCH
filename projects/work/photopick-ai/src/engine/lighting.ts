// src/engine/lighting.ts
// 조명 분석 — 히스토그램 기반 하이라이트/섀도우 비율

/**
 * 조명 점수 (0~100)
 * - 하이라이트 클리핑(>245): 5% 초과 시 감점
 * - 섀도우 뭉침(<10): 10% 초과 시 감점
 * - 중간 톤 비율이 높을수록 좋음
 */
export function lightingScore(histogram: Uint32Array, totalPixels: number): number {
  let highlightPixels = 0;
  let shadowPixels = 0;
  let midtonePixels = 0;

  for (let i = 0; i < 256; i++) {
    if (i > 245) highlightPixels += histogram[i];
    else if (i < 10) shadowPixels += histogram[i];
    else if (i >= 60 && i <= 200) midtonePixels += histogram[i];
  }

  const highlightRatio = highlightPixels / totalPixels;
  const shadowRatio = shadowPixels / totalPixels;
  const midtoneRatio = midtonePixels / totalPixels;

  let score = 100;
  if (highlightRatio > 0.05) score -= Math.round(highlightRatio * 300);
  if (shadowRatio > 0.10) score -= Math.round(shadowRatio * 200);
  score += Math.round(midtoneRatio * 20); // 중간톤 보너스

  return Math.max(0, Math.min(100, score));
}
