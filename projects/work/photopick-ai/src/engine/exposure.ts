// src/engine/exposure.ts
// ─────────────────────────────────────────────────────────────────────────────
// 히스토그램 기반 노출 분석 — 1차 필터(filter.worker)에서 사용합니다
//
// 노출이란 사진의 전반적인 밝기를 말합니다.
//   - 과노출(화이트아웃): 하늘·배경이 날아가 하얗게 뭉개진 상태
//   - 과소노출(블랙아웃): 어두워서 피사체가 보이지 않는 상태
//
// ★ 1차 필터 통과율 목표: 전체 사진의 약 30%
//   완화된 임계값을 적용해 야외 자연광, 살짝 어두운 실내, 역광 사진 등을
//   최대한 통과시킵니다. 품질 판단은 3차 정밀 분석(analyze.worker)에서 수행합니다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 노출 점수 계산 (0~100) 및 과/소노출 여부 판정
 *
 * 임계값 완화 이력:
 *   isOverexposed:  0.05 → 0.15 → 0.22 → 0.35 (야외·역광 사진 통과)
 *   isUnderexposed: 0.05 → 0.10 → 0.25         (실내·야간 사진 허용)
 *   brightness 범위: 40~230 → 20~245            (극단적인 경우만 탈락)
 *
 * @param histogram   256단계 밝기 분포 배열
 * @param totalPixels 전체 픽셀 수
 */
export function exposureScore(
  histogram: Uint32Array,
  totalPixels: number
): { score: number; brightness: number; isOverexposed: boolean; isUnderexposed: boolean } {

  let brightnessSum = 0;
  let darkPixels   = 0;  // 밝기 0~29: 매우 어두운 픽셀
  let brightPixels = 0;  // 밝기 226~255: 매우 밝은 픽셀

  for (let i = 0; i < 256; i++) {
    brightnessSum += i * histogram[i];
    if (i < 30)  darkPixels   += histogram[i];
    if (i > 225) brightPixels += histogram[i];
  }

  const brightness  = brightnessSum / totalPixels;
  const darkRatio   = darkPixels   / totalPixels;
  const brightRatio = brightPixels / totalPixels;

  // 극단적인 경우만 탈락시킵니다:
  //   35% 이상이 날아간 하이라이트 = 완전 화이트아웃
  //   25% 이상이 완전히 어두운 픽셀 = 완전 블랙아웃
  const isOverexposed  = brightRatio > 0.35;
  const isUnderexposed = darkRatio   > 0.25;

  // 점수 계산: 이상적 상태 100점에서 감점
  let score = 100;
  if (isOverexposed)  score -= Math.round(brightRatio * 200);
  if (isUnderexposed) score -= Math.round(darkRatio   * 200);
  if (brightness < 20 || brightness > 245) score = Math.max(0, score - 40);

  return {
    score: Math.max(0, Math.min(100, score)),
    brightness,
    isOverexposed,
    isUnderexposed,
  };
}

/**
 * 히스토그램 대비(Contrast) 점수 계산 (0~100)
 *
 * 표준편차가 클수록 밝음과 어둠의 차이가 뚜렷 = 대비가 좋은 사진
 * 기준: 표준편차 ≥80 → 100점 (사용처: 현재 미사용, 향후 화질 개선 시 활용)
 */
export function contrastScore(histogram: Uint32Array, totalPixels: number, mean: number): number {
  let variance = 0;
  for (let i = 0; i < 256; i++) {
    variance += histogram[i] * (i - mean) ** 2;
  }
  const stddev = Math.sqrt(variance / totalPixels);
  return Math.min(100, Math.round(stddev / 80 * 100));
}
