// src/engine/blur.ts
// ─────────────────────────────────────────────────────────────────────────────
// Laplacian 분산(Variance of Laplacian)으로 블러(흔들림) 감지
//
// 원리:
//   Laplacian 커널은 이미지의 2차 미분을 계산해 경계선(엣지)을 강조합니다.
//   선명한 사진 = 경계선이 뚜렷 = Laplacian 응답값 크고 다양 = 분산 높음
//   흔들린 사진 = 경계선이 흐릿 = Laplacian 응답값 작고 균일 = 분산 낮음
//
// 커널: [0, 1, 0]
//        [1,-4, 1]   → 중심 픽셀 - 상하좌우 픽셀 평균
//        [0, 1, 0]
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 그레이스케일 이미지의 Laplacian 분산값 계산
 *
 * @param gray   toGrayscale()로 변환된 Float32Array (픽셀당 0~255)
 * @param width  이미지 너비 (px)
 * @param height 이미지 높이 (px)
 * @returns      분산값 — 50 미만이면 블러로 판정 (1차 필터 기준)
 */
export function computeLaplacianVariance(
  gray: Float32Array,
  width: number,
  height: number
): number {
  let sum = 0;     // Laplacian 값들의 합
  let sumSq = 0;   // Laplacian 값들의 제곱합
  let count = 0;

  // 가장자리 1픽셀은 커널 적용 불가 → 1~(n-2) 범위만 처리
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      // 4방향(상하좌우) 이웃 픽셀과의 차이 합산 = Laplacian 응답
      const lap =
        gray[idx - width] +   // 위 픽셀
        gray[idx - 1]     +   // 왼쪽 픽셀
        gray[idx + 1]     +   // 오른쪽 픽셀
        gray[idx + width] -   // 아래 픽셀
        4 * gray[idx];        // 중심 픽셀 (가중치 -4)
      sum   += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = sum / count;
  return sumSq / count - mean * mean; // 분산 = E[X²] - E[X]²
}

/** Laplacian 분산값 → 0~100 점수로 정규화 (현재 analyze.worker에서 자체 함수 사용) */
export function sharpnessScore(variance: number): number {
  // 50 미만 = 블러, 200 이상 = 매우 선명 (1차 필터에서만 사용)
  return Math.min(100, Math.round((variance / 200) * 100));
}
