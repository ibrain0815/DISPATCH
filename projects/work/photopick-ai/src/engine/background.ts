// src/engine/background.ts
// 배경 복잡도 점수 — 색상 분포 기반 간이 구현
// TODO: Phase 4에서 BodyPix 세그멘테이션으로 교체

/**
 * 배경 점수 (0~100) — 간이 구현
 * 이미지 가장자리 20% 영역의 색상 다양성으로 배경 복잡도 추정
 * 단순할수록(낮은 엔트로피) 높은 점수
 */
export function backgroundScore(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const borderSize = Math.floor(Math.min(width, height) * 0.2);

  const colorCounts = new Map<string, number>();

  // 가장자리 픽셀 샘플링 (성능을 위해 4픽셀마다)
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const isBorder =
        x < borderSize || x > width - borderSize ||
        y < borderSize || y > height - borderSize;
      if (!isBorder) continue;

      const idx = (y * width + x) * 4;
      // 8단계로 양자화
      const r = Math.floor(data[idx] / 32);
      const g = Math.floor(data[idx + 1] / 32);
      const b = Math.floor(data[idx + 2] / 32);
      const key = `${r},${g},${b}`;
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    }
  }

  // 색상 종류가 적을수록 단순한 배경
  const uniqueColors = colorCounts.size;
  if (uniqueColors <= 5) return 100;
  if (uniqueColors >= 80) return 30;
  return Math.round(100 - ((uniqueColors - 5) / 75) * 70);
}
