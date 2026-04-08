// src/engine/exposure.ts
// 히스토그램 기반 노출 분석

/**
 * 히스토그램에서 노출 점수 계산 (0~100)
 * - 정상 노출: 평균 밝기 40~230, 히스토그램이 중앙에 집중
 * - 과노출(화이트아웃): 255 부근 픽셀이 5% 초과
 * - 언더노출(블랙아웃): 0 부근 픽셀이 5% 초과
 */
export function exposureScore(
  histogram: Uint32Array,
  totalPixels: number
): { score: number; brightness: number; isOverexposed: boolean; isUnderexposed: boolean } {
  let brightnessSum = 0;
  let darkPixels = 0;   // 0~30
  let brightPixels = 0; // 225~255

  for (let i = 0; i < 256; i++) {
    brightnessSum += i * histogram[i];
    if (i < 30) darkPixels += histogram[i];
    if (i > 225) brightPixels += histogram[i];
  }

  const brightness = brightnessSum / totalPixels;
  const darkRatio = darkPixels / totalPixels;
  const brightRatio = brightPixels / totalPixels;

  const isOverexposed = brightRatio > 0.05;
  const isUnderexposed = darkRatio > 0.05;

  // 기준 밝기 40~230에서 중앙(135) 기준 편차 계산
  let score = 100;
  if (isOverexposed) score -= Math.round(brightRatio * 200);
  if (isUnderexposed) score -= Math.round(darkRatio * 200);
  if (brightness < 40 || brightness > 230) score = Math.max(0, score - 40);

  return {
    score: Math.max(0, Math.min(100, score)),
    brightness,
    isOverexposed,
    isUnderexposed,
  };
}

/**
 * 히스토그램 대비(contrast) 점수 계산
 * - 표준 편차가 클수록 대비가 좋음 (기준: ≥50)
 */
export function contrastScore(histogram: Uint32Array, totalPixels: number, mean: number): number {
  let variance = 0;
  for (let i = 0; i < 256; i++) {
    variance += histogram[i] * (i - mean) ** 2;
  }
  const stddev = Math.sqrt(variance / totalPixels);
  return Math.min(100, Math.round(stddev / 80 * 100));
}
