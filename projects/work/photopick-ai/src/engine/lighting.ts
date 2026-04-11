// src/engine/lighting.ts
// ─────────────────────────────────────────────────────────────────────────────
// 조명 분석 — 히스토그램 기반 하이라이트/섀도우/중간톤 비율 평가
//
// 히스토그램(Histogram)이란?
//   이미지의 각 밝기 값(0~255)에 해당하는 픽셀 수를 나타낸 분포입니다.
//   analyze.worker.ts에서 그레이스케일 변환 후 계산합니다.
//
// 조명 품질의 3가지 기준:
//   1. 하이라이트 클리핑 (Highlight Clipping, >245 밝기):
//      너무 밝아 디테일이 날아간 영역. 5% 이상이면 감점.
//      예: 역광으로 인한 날아간 하늘, 플래시 과다 노출
//
//   2. 섀도우 뭉침 (Shadow Blocking, <10 밝기):
//      너무 어두워 디테일을 알 수 없는 영역. 10% 이상이면 감점.
//      예: 야간 사진의 검은 배경, 역광으로 인한 실루엣
//
//   3. 중간톤 비율 (Midtone Ratio, 60~200 밝기):
//      자연스러운 피부색, 풍경 등 대부분의 피사체가 속하는 구간.
//      비율이 높을수록 균형 잡힌 조명으로 보너스 점수.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 조명 점수를 계산합니다 (0~100)
 *
 * 점수 계산:
 *   기본 100점에서 시작
 *   - 하이라이트 클리핑 > 5%: highlightRatio × 300 점 감점
 *     (하이라이트 비율 10% → -30점, 30% → -90점)
 *   - 섀도우 뭉침 > 10%: shadowRatio × 200 점 감점
 *     (섀도우 비율 20% → -40점, 50% → -100점)
 *   + 중간톤 비율 보너스: midtoneRatio × 20 점 추가
 *     (중간톤 비율 50% → +10점, 80% → +16점)
 *
 * 밝기 구간 정의:
 *   0~9:    섀도우 (너무 어두움)
 *   10~59:  어두운 영역
 *   60~200: 중간톤 (이상적인 피사체 구간)
 *   201~244: 밝은 영역
 *   245~255: 하이라이트 클리핑 (너무 밝음)
 *
 * @param histogram    그레이스케일 히스토그램 (256 크기 배열, histogram[i] = 밝기 i인 픽셀 수)
 * @param totalPixels  이미지 전체 픽셀 수 (비율 계산용)
 * @returns            조명 점수 (0~100)
 */
export function lightingScore(histogram: Uint32Array, totalPixels: number): number {
  let highlightPixels = 0; // 하이라이트 클리핑 픽셀 수 (밝기 > 245)
  let shadowPixels    = 0; // 섀도우 뭉침 픽셀 수 (밝기 < 10)
  let midtonePixels   = 0; // 중간톤 픽셀 수 (밝기 60~200)

  // 히스토그램 순회하여 각 구간의 픽셀 수 집계
  for (let i = 0; i < 256; i++) {
    if (i > 245) {
      highlightPixels += histogram[i]; // 날아간 하이라이트
    } else if (i < 10) {
      shadowPixels += histogram[i];    // 뭉친 섀도우
    } else if (i >= 60 && i <= 200) {
      midtonePixels += histogram[i];   // 이상적인 중간톤
    }
  }

  // 각 구간의 전체 픽셀 대비 비율
  const highlightRatio = highlightPixels / totalPixels;
  const shadowRatio    = shadowPixels    / totalPixels;
  const midtoneRatio   = midtonePixels   / totalPixels;

  let score = 100; // 기본 점수

  // 하이라이트 클리핑 감점 (5% 이상부터 적용)
  if (highlightRatio > 0.05) {
    score -= Math.round(highlightRatio * 300);
  }

  // 섀도우 뭉침 감점 (10% 이상부터 적용)
  if (shadowRatio > 0.10) {
    score -= Math.round(shadowRatio * 200);
  }

  // 중간톤 비율 보너스 (최대 +20점)
  score += Math.round(midtoneRatio * 20);

  return Math.max(0, Math.min(100, score)); // 0~100 범위 클램핑
}
