// src/engine/blur.ts
// Laplacian 분산으로 블러 감지 — Worker에서 호출

/**
 * Laplacian 커널: [0,1,0 / 1,-4,1 / 0,1,0]
 * 분산값이 클수록 선명 (기준: ≥50 통과)
 */
export function computeLaplacianVariance(
  gray: Float32Array,
  width: number,
  height: number
): number {
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        gray[idx - width] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx + width] -
        4 * gray[idx];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = sum / count;
  return sumSq / count - mean * mean; // 분산
}

/** 분산값 → 0~100 점수로 정규화 */
export function sharpnessScore(variance: number): number {
  // 50 미만 = 블러, 200 이상 = 매우 선명
  return Math.min(100, Math.round((variance / 200) * 100));
}

// TODO: 추후 FFT 기반 주파수 분석으로 교체 가능 (더 정확)
