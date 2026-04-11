// src/engine/background.ts
// ─────────────────────────────────────────────────────────────────────────────
// 배경 복잡도 점수 계산 — 색상 분포 기반 간이 구현
//
// 핵심 아이디어:
//   인물 사진에서 좋은 배경은 단순하고 깔끔합니다 (흰 벽, 흐린 하늘, 단색 천).
//   반대로 복잡한 배경(군중, 복잡한 건물, 어수선한 실내)은 인물을 돋보이지 않게 합니다.
//
// 구현 방법:
//   이미지 가장자리 20% 영역의 픽셀 색상을 8단계로 양자화(단순화)하여
//   고유한 색상 종류의 수를 셉니다. 색상이 적을수록 단순한 배경으로 판단합니다.
//
// 한계:
//   이 구현은 실루엣 분리(세그멘테이션) 없이 가장자리 색상만 봅니다.
//   TODO: Phase 4에서 BodyPix 세그멘테이션으로 교체 예정
//   — 세그멘테이션을 쓰면 인물 뒤쪽 배경만 정확히 분리해서 분석할 수 있습니다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 배경 복잡도 점수를 계산합니다 (0~100, 높을수록 단순한 배경)
 *
 * 알고리즘:
 *   1. 이미지 가장자리 20% 영역의 픽셀을 4픽셀 간격으로 샘플링 (성능 최적화)
 *   2. 각 픽셀의 R/G/B 값을 256단계 → 8단계로 양자화 (32씩 나누기)
 *      예: RGB(255, 180, 45) → (7, 5, 1) — 세밀한 색상 차이를 무시하고 대략적 색상 분류
 *   3. 고유한 (r, g, b) 조합 수 = 색상 다양성 지표
 *   4. 색상 종류가 5종 이하 → 100점 (매우 단순), 80종 이상 → 30점 (매우 복잡)
 *
 * @param imageData  분석할 이미지의 픽셀 데이터 (ImageData 객체)
 * @returns          배경 단순도 점수 (0~100)
 */
export function backgroundScore(imageData: ImageData): number {
  const { data, width, height } = imageData;

  // 가장자리 영역 크기: 이미지 짧은 변의 20%
  // 예: 640×480 이미지 → borderSize = 96px (상하좌우 96픽셀이 "가장자리")
  const borderSize = Math.floor(Math.min(width, height) * 0.2);

  // 색상 종류를 세는 Map: "r,g,b" 문자열 → 등장 횟수
  const colorCounts = new Map<string, number>();

  // 가장자리 픽셀만 순회 (성능을 위해 4픽셀마다 샘플링)
  // 내부(배경이 아닌 인물 영역)는 건너뜁니다
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      // 현재 픽셀이 가장자리 영역인지 확인
      const isBorder =
        x < borderSize ||              // 왼쪽 가장자리
        x > width - borderSize ||      // 오른쪽 가장자리
        y < borderSize ||              // 위쪽 가장자리
        y > height - borderSize;       // 아래쪽 가장자리

      if (!isBorder) continue; // 내부 픽셀은 건너뜀

      // ImageData의 픽셀 데이터는 [R, G, B, A, R, G, B, A, ...] 형태의 1D 배열
      // 특정 (x, y) 픽셀의 R값 인덱스 = (y * width + x) * 4
      const idx = (y * width + x) * 4;

      // 256단계 → 8단계 양자화 (0~31 → 0, 32~63 → 1, ..., 224~255 → 7)
      // 세밀한 색상 차이(밝기 차이 등)를 무시하고 대략적인 색조만 남깁니다
      const r = Math.floor(data[idx]     / 32); // 빨강 (0~7)
      const g = Math.floor(data[idx + 1] / 32); // 초록 (0~7)
      const b = Math.floor(data[idx + 2] / 32); // 파랑 (0~7)

      const key = `${r},${g},${b}`; // 색상 식별자 문자열
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
    }
  }

  // 고유 색상 종류 수 = 배경 복잡도 지표
  const uniqueColors = colorCounts.size;

  // 점수 변환: 색상이 적을수록 단순, 많을수록 복잡
  if (uniqueColors <= 5)  return 100; // 5종 이하: 흰 벽, 단색 배경 → 최고점
  if (uniqueColors >= 80) return 30;  // 80종 이상: 매우 복잡한 배경 → 최저점

  // 5~80 사이: 선형 보간으로 100→30점으로 감소
  // 수식: 100 - ((uniqueColors - 5) / 75) × 70
  return Math.round(100 - ((uniqueColors - 5) / 75) * 70);
}
