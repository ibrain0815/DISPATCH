// src/workers/analyze.worker.ts
// ─────────────────────────────────────────────────────────────────────────────
// 3차 정밀 분석 Worker — 7가지 지표를 계산해 절대 점수 및 등급을 산출합니다
//
// 기본 5가지 (클로즈업·반신 사진):
//   화질(30%) + 표정(25%) + 구도(20%) + 조명(15%) + 배경(10%)
//
// 전신 사진 추가 2가지 (얼굴 < 이미지 높이 18%):
//   포즈(22%) + 패션(13%) — 전신 전용 가중치로 재계산
//
// 등급 기준 (절대 점수):
//   S(85+): 모든 지표 우수
//   A(70+): 구도·표정·조명 양호
//   B(55+): 1차 필터 통과한 대부분의 사진
//   C(40+): 구도·표정 아쉬움
//   D( ~39): 블러/노출 불량 또는 얼굴 없음
//
// 처리 해상도: 640×640 (1차 필터의 320×240보다 정밀하게 분석)
// ─────────────────────────────────────────────────────────────────────────────

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';
import { computeLaplacianVariance } from '../engine/blur';
import { buildAnalysis } from '../engine/scorer';
import { analyzePoseAndFashion } from '../engine/pose';
import type { AnalyzeWorkerInput, AnalyzeWorkerOutput, FaceData, Penalty } from '../types';

// ─────────────────────────────────────────────────────────
// ① 선명도 점수 (Sharpness)
// ─────────────────────────────────────────────────────────

/** Laplacian 분산값 → 선명도 점수 (0~100)
 *
 *  로그 스케일로 변환해 일반 사진 구간에서 점수가 고르게 분포하도록 합니다.
 *  - 분산 50  (1차 필터 통과 최솟값) → ~0점
 *  - 분산 200 → ~52점
 *  - 분산 600 → ~68점
 *  - 분산 2000 → ~85점
 *  - 분산 5000+ → 100점
 */
function calcSharpnessScore(variance: number): number {
  if (variance <= 0) return 0;
  // 1차 필터 최솟값(50)을 기준점 0으로 재조정 후 로그 스케일 정규화
  const adjusted = Math.max(0, variance - 50);
  const score = Math.log1p(adjusted) / Math.log1p(5000) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// ─────────────────────────────────────────────────────────
// ② 노출 점수 (Exposure)
// ─────────────────────────────────────────────────────────

/** 히스토그램 기반 노출 점수 (0~100)
 *
 *  이상적인 밝기 범위(80~180)의 픽셀 비율을 기준으로 점수를 계산하고,
 *  극단 노출(하이라이트 날림/짙은 그림자)에 대해 감점을 적용합니다.
 *
 *  역광 야외 사진 허용을 위해 임계값을 완화했습니다:
 *  - 밝은 픽셀(>225) 10% 초과분부터 감점 시작
 *  - 과노출 패널티 트리거: 15% 초과
 */
function calcExposureScore(histogram: Uint32Array, totalPixels: number) {
  let brightnessSum = 0, darkPixels = 0, brightPixels = 0, midPixels = 0;

  for (let i = 0; i < 256; i++) {
    brightnessSum += i * histogram[i];
    if (i < 30)                    darkPixels   += histogram[i]; // 어두운 픽셀
    if (i > 225)                   brightPixels += histogram[i]; // 밝은 픽셀
    if (i >= 80 && i <= 180)       midPixels    += histogram[i]; // 이상적 범위
  }

  const brightness  = brightnessSum / totalPixels;
  const darkRatio   = darkPixels   / totalPixels; // 어두운 픽셀 비율
  const brightRatio = brightPixels / totalPixels; // 밝은 픽셀 비율
  const midRatio    = midPixels    / totalPixels; // 이상적 범위 비율 (목표: 0.4~0.65)

  // 기본 점수: 이상적 범위 비율 0.55 → 60점 정도
  let score = midRatio * 110;
  score = Math.min(score, 75); // 노출 단독으로 75점 이상은 어렵게

  // 극단 노출 감점 (역광 야외 허용 — 배경 밝음은 어느 정도 감수)
  if (brightRatio > 0.10) score -= (brightRatio - 0.10) * 200; // 10% 초과분에만 감점
  if (darkRatio   > 0.08) score -= darkRatio * 200;             // 어두운 픽셀 과다 감점
  if (brightness < 50 || brightness > 220) score -= 15;         // 극단 평균밝기 추가 감점

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    brightness,
    isOverexposed:  brightRatio > 0.35, // 밝은 픽셀 35% 초과 = 과노출 패널티 (exposure.ts 동기화)
    isUnderexposed: darkRatio   > 0.10, // 어두운 픽셀 10% 초과 = 과소노출 패널티
  };
}

// ─────────────────────────────────────────────────────────
// ③ 조명 점수 (Lighting)
// ─────────────────────────────────────────────────────────

/** 히스토그램 엔트로피 기반 조명 점수 (0~100)
 *
 *  엔트로피는 밝기 분포가 얼마나 고른지를 나타냅니다.
 *  엔트로피가 높을수록 밝음/어둠이 다양하게 분포 = 입체감 있는 조명
 *
 *  - 엔트로피 4.5 → 약 30점 (단조로운 조명)
 *  - 엔트로피 5.5 → 약 50점
 *  - 엔트로피 6.5 → 약 70점
 *  - 엔트로피 7.5+ → 약 90점 (풍부한 조명)
 */
function calcLightingScore(histogram: Uint32Array, totalPixels: number): number {
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] === 0) continue;
    const p = histogram[i] / totalPixels; // 각 밝기값의 확률
    entropy -= p * Math.log2(p);          // 정보 엔트로피 공식: -Σ p·log₂(p)
  }
  // 엔트로피 4~8 구간 → 0~100으로 선형 매핑
  const score = (entropy - 4) / 4 * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ─────────────────────────────────────────────────────────
// ④ 배경 점수 (Background)
// ─────────────────────────────────────────────────────────

/** 배경 균일도(단순도) 점수 측정 (0~100)
 *
 *  단순한 배경(스튜디오 흰 벽, 단색 하늘)일수록 높은 점수를 받습니다.
 *
 *  [이전 방식의 문제점]
 *  이미지 전체 가장자리(18%)의 고유 색상 수를 세는 방식은
 *  보풀/퍼 소재 의류(니트, 패딩 등)가 가장자리에 걸리면 텍스처 때문에
 *  수백 가지 양자화 색상이 생성되어 복잡한 배경으로 오판합니다.
 *
 *  [새 방식: 지배색 비율]
 *  1. 샘플링 영역을 "상단 스트립 + 좌우 상단 45%"로 제한
 *     - 인물 상체·하체가 걸리는 하단 가장자리 완전 제외
 *     - 좌우는 상단 절반까지만 → 의류가 프레임 가장자리에 닿는 경우 최소화
 *  2. 고유 색상 수 대신 "상위 3개 색상의 비율 합(top3Ratio)"으로 평가
 *     - 스튜디오 흰 배경: 샘플의 80~95%가 같은 흰색 버킷 → top3Ratio ≈ 0.90 → 100점
 *     - 복잡한 야외: 색상이 고르게 분산 → top3Ratio ≈ 0.20~0.35 → 10~30점
 *     - 보풀 의류가 일부 걸려도 배경색이 지배적이면 높은 점수 유지
 */
function calcBackgroundScore(imageData: ImageData): number {
  const { data, width, height } = imageData;

  // 샘플링 영역 정의
  const borderW  = Math.floor(width  * 0.12);  // 좌우 12% 스트립
  const borderH  = Math.floor(height * 0.10);  // 상단 10% 스트립
  const sideMaxY = Math.floor(height * 0.45);  // 좌우 스트립은 이미지 상단 45%까지만

  const colorCounts = new Map<number, number>();
  let totalSampled = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const isTop  = y < borderH;
      const isSide = (x < borderW || x > width - borderW) && y < sideMaxY;
      if (!isTop && !isSide) continue;

      const idx = (y * width + x) * 4;
      // 5비트(32단계) 양자화: 비슷한 색을 하나의 버킷으로 묶음
      const key = ((data[idx] >> 3) << 10) | ((data[idx + 1] >> 3) << 5) | (data[idx + 2] >> 3);
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
      totalSampled++;
    }
  }

  if (totalSampled === 0) return 50;

  // 상위 3개 색상 합산 비율: 배경이 균일할수록 높음
  const sorted = [...colorCounts.values()].sort((a, b) => b - a);
  const top3Sum = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
  const top3Ratio = top3Sum / totalSampled;

  // top3Ratio → 점수 변환
  // 0.75 이상 → 100점 (스튜디오 흰 벽, 완전 단색 배경)
  // 0.20 이하 → 10점  (복잡한 야외, 군중, 건물)
  if (top3Ratio >= 0.75) return 100;
  if (top3Ratio <= 0.20) return 10;
  return Math.round(10 + ((top3Ratio - 0.20) / 0.55) * 90);
}

// ─────────────────────────────────────────────────────────
// 얼굴 영역 추정 (피부색 픽셀 분포)
// ─────────────────────────────────────────────────────────

/** 피부색 픽셀의 분포로 얼굴 영역을 추정합니다
 *
 *  MediaPipe 등 외부 모델 없이 순수 색상 조건으로 얼굴 위치를 대략 파악합니다.
 *
 *  [전신 사진 대응]:
 *  - 이미지 상단 50%만 스캔합니다. 얼굴은 거의 항상 상단 절반에 있습니다.
 *    이 제한이 없으면 손·팔·베이지색 의류가 얼굴 바운딩박스를 오염시킵니다.
 *
 *  [피부색 조건 강화]:
 *  - 기존 조건에 Blue 채널 상한 추가: b < 170
 *    베이지/크림색 의류(R~195, G~155, B~115)의 B값이 실제 피부보다 높아
 *    피부로 오인되는 문제를 줄입니다.
 *  - 채도 조건 강화: (r - g) + (r - b) > 40 → 무채색·회색 계열 제외
 *
 *  @returns 얼굴 중심과 바운딩 박스, 피부색 픽셀이 10개 미만이면 null
 */
function estimateFaceRegion(imageData: ImageData) {
  const { data, width, height } = imageData;

  // 얼굴 탐색 범위: 이미지 상단 50%
  // 전신 사진에서 손·몸통·의류가 얼굴 영역을 오염시키는 것을 방지합니다
  const scanHeight = Math.floor(height * 0.50);

  let sumX = 0, sumY = 0, count = 0;
  let minX = width, maxX = 0, minY = scanHeight, maxY = 0;

  for (let y = 0; y < scanHeight; y += 2) {  // 상단 50%만 스캔
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // 피부색 조건 (강화됨):
      //  - R 채널 지배 (r > g, r > b)
      //  - 최소 밝기 (r > 80, g > 35)
      //  - Blue 상한 b < 170: 베이지·크림 의류 제외
      //  - 채도 조건: (r-g) + (r-b) > 40 (무채색·탁한 색 제외)
      const isSkin =
        r > 80 && g > 35 && b > 15 && b < 170 &&
        r > g && r > b &&
        (r - g) + (r - b) > 40;

      if (isSkin) {
        sumX += x; sumY += y; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  // 피부색 픽셀이 너무 적으면 얼굴 없다고 판단
  if (count < 10) return null;

  return {
    centerX: sumX / count,  // 피부색 픽셀의 무게중심 X
    centerY: sumY / count,  // 피부색 픽셀의 무게중심 Y
    width:   maxX - minX,   // 바운딩 박스 너비
    height:  maxY - minY,   // 바운딩 박스 높이
  };
}

// ─────────────────────────────────────────────────────────
// ⑤ 구도 점수 (Composition)
// ─────────────────────────────────────────────────────────

/** 얼굴 위치 기반 구도 점수 (0~100)
 *
 *  세 가지 서브 점수의 가중 평균으로 최종 구도 점수를 계산합니다:
 *
 *  ① 삼분법 점수 (40%): 얼굴 중심이 이미지를 3등분한 교차점에 가까울수록 높음
 *  ② 헤드룸 점수 (35%): 얼굴 위 여백이 5~22%이면 최고점 (너무 타이트/여유 없는 것 감점)
 *  ③ 얼굴 크기 점수 (25%): 이미지 높이 대비 20~55%일 때 최고점
 *
 *  @param cx    얼굴 중심 X (px)
 *  @param cy    얼굴 중심 Y (px)
 *  @param faceH 얼굴 높이 (px)
 *  @param W     이미지 너비 (px)
 *  @param H     이미지 높이 (px)
 */
function calcCompositionScore(cx: number, cy: number, faceH: number, W: number, H: number): number {
  // ── 삼분법 ──────────────────────────────────────────────
  const t = W / 3, u = H / 3;
  // 삼분법 4개 교차점
  const pts = [{ x: t, y: u }, { x: t * 2, y: u }, { x: t, y: u * 2 }, { x: t * 2, y: u * 2 }];
  const diag = Math.sqrt(W ** 2 + H ** 2); // 대각선 길이 (거리 정규화용)
  const minDist = Math.min(...pts.map(p => Math.sqrt((cx - p.x) ** 2 + (cy - p.y) ** 2)));
  // 교차점에 가까울수록 100점, 멀수록 0점 (220 배율로 급격히 감소)
  const rotScore = Math.max(0, Math.round(100 - (minDist / diag) * 220));

  // ── 헤드룸 (얼굴 위 여백 비율) ──────────────────────────
  const topRatio = (cy - faceH / 2) / H; // 얼굴 상단의 이미지 상단 대비 위치
  let hrScore: number;
  if (topRatio >= 0.05 && topRatio <= 0.22) {
    hrScore = 100; // 이상적 헤드룸 범위
  } else if (topRatio < 0.01 || topRatio > 0.50) {
    hrScore = 0;   // 얼굴이 상단에 붙었거나 너무 아래
  } else {
    hrScore = Math.max(0, Math.round(100 - Math.abs(topRatio - 0.13) * 400));
  }

  // ── 얼굴 크기 비율 ───────────────────────────────────────
  // 클로즈업(얼굴 크게) 뿐만 아니라 전신 사진(얼굴 작음)도 유효한 구도로 인정합니다.
  //
  // 이상적 범위를 0.07~0.55로 확대:
  //   0.07~0.19 : 전신·원거리 사진 (얼굴이 작지만 전체 구도가 있음) → 100점
  //   0.20~0.55 : 반신·클로즈업 사진 (기존 이상적 범위) → 100점
  //   0.04~0.07 : 매우 원거리 (얼굴이 거의 안 보임) → 0~100 점
  //   0.55~0.85 : 너무 클로즈업 → 0~100 점
  //   0.04 미만 or 0.85 초과 : 비정상 → 0점
  const sizeRatio = faceH / H; // 이미지 높이 대비 얼굴 높이
  let sizeScore: number;
  if (sizeRatio >= 0.07 && sizeRatio <= 0.55) {
    sizeScore = 100; // 전신~클로즈업 모두 이상적 범위로 허용
  } else if (sizeRatio < 0.04 || sizeRatio > 0.85) {
    sizeScore = 0;   // 너무 작거나(피사체가 안 보임) 너무 큰 얼굴
  } else if (sizeRatio < 0.07) {
    sizeScore = Math.round((sizeRatio - 0.04) / 0.03 * 100); // 매우 원거리 → 선형
  } else {
    sizeScore = Math.round((0.85 - sizeRatio) / 0.30 * 100); // 너무 클로즈업 → 선형 감소
  }

  // 가중 평균: 삼분법 40% + 헤드룸 35% + 얼굴크기 25%
  return Math.round(rotScore * 0.40 + hrScore * 0.35 + sizeScore * 0.25);
}

// ─────────────────────────────────────────────────────────
// ⑥ 표정 점수 (Expression)
// ─────────────────────────────────────────────────────────

/** 얼굴 영역 픽셀 분석 기반 표정 점수 (0~100)
 *
 *  MediaPipe 없이 세 가지 픽셀 레벨 지표로 표정을 근사합니다:
 *
 *  ① 얼굴 밝기 점수 (35%): 얼굴 평균 밝기가 90~190이면 최고점
 *     → 너무 어둡거나 밝은 얼굴은 조명 문제로 감점
 *
 *  ② 좌우 대칭 점수 (40%): 얼굴 좌우 평균 밝기 차이가 적을수록 높음
 *     → 정면 응시 = 좌우 밝기 비슷 / 측면 = 차이 큼
 *
 *  ③ 디테일 분산 점수 (25%): 얼굴 영역 픽셀 밝기의 표준편차
 *     → 눈·코·입 윤곽이 뚜렷할수록 분산 큼 = 선명한 얼굴
 */
function calcExpressionScore(
  imageData: ImageData, cx: number, cy: number, fw: number, fh: number
): number {
  const { data, width } = imageData;

  // 분석할 얼굴 영역 (바운딩 박스의 90% 크기)
  const x0 = Math.max(0, Math.round(cx - fw * 0.45));
  const x1 = Math.min(imageData.width - 1, Math.round(cx + fw * 0.45));
  const y0 = Math.max(0, Math.round(cy - fh * 0.45));
  const y1 = Math.min(imageData.height - 1, Math.round(cy + fh * 0.45));

  if (x1 <= x0 || y1 <= y0) return 45; // 영역이 너무 작으면 중간 점수 반환

  // ── 밝기 집계 + 좌우 분리 ────────────────────────────────
  let sum = 0, count = 0, leftSum = 0, rightSum = 0, lc = 0, rc = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * width + x) * 4;
      // 가중 평균으로 밝기(휘도) 계산 (ITU-R BT.601)
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += lum; count++;
      if (x < cx) { leftSum += lum; lc++; }   // 얼굴 좌측 픽셀
      else         { rightSum += lum; rc++; }  // 얼굴 우측 픽셀
    }
  }
  if (count === 0) return 45;
  const mean = sum / count; // 얼굴 영역 평균 밝기

  // ── 얼굴 밝기 점수 ───────────────────────────────────────
  // 90~190이 이상적 (자연광/스튜디오 조명), 너무 어둡거나 밝으면 감점
  let brightnessScore: number;
  if      (mean >= 90 && mean <= 190)  brightnessScore = 100;
  else if (mean < 40  || mean > 230)   brightnessScore = 10;
  else if (mean < 90)  brightnessScore = Math.round((mean - 40) / 50 * 90 + 10);
  else                 brightnessScore = Math.round((230 - mean) / 40 * 90 + 10);

  // ── 좌우 대칭 점수 ───────────────────────────────────────
  // 정면 촬영 = 좌우 밝기 유사 = 비대칭 낮음 = 높은 점수
  const lm = lc > 0 ? leftSum / lc : mean;
  const rm = rc > 0 ? rightSum / rc : mean;
  const asymmetry = Math.abs(lm - rm) / (mean + 1); // 정규화 비대칭 지수
  // 비대칭 0.05 이하 = 100점, 0.30 이상 = 0점
  const symmetryScore = Math.max(0, Math.round(100 - (asymmetry / 0.30) * 100));

  // ── 디테일(표준편차) 점수 ────────────────────────────────
  // 눈·코·입 등 윤곽이 뚜렷할수록 밝기 분산이 크고 선명한 얼굴
  let variance = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      variance += (lum - mean) ** 2;
    }
  }
  const stddev = Math.sqrt(variance / count);
  // 표준편차 10 미만 = 밋밋한 얼굴, 55 이상 = 선명한 얼굴
  const detailScore = Math.min(100, Math.round((stddev - 10) / 45 * 100));

  // 가중 평균: 밝기 35% + 좌우대칭 40% + 디테일 25%
  return Math.max(0, Math.round(brightnessScore * 0.35 + symmetryScore * 0.40 + detailScore * 0.25));
}

// ─────────────────────────────────────────────────────────
// Worker 메인 메시지 핸들러
// ─────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<AnalyzeWorkerInput>) => {
  const { id, fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    // 640×640 으로 리사이즈 (EXIF 회전 보정 포함)
    const { imageData } = await loadAndResize(file, 640, 640);
    const gray = toGrayscale(imageData);        // 그레이스케일 변환
    const histogram = computeHistogram(gray);   // 밝기 히스토그램 생성
    const W = imageData.width, H = imageData.height;

    // ── 화질 점수 (선명도 60% + 노출 40%) ─────────────────────────────────
    const sharpVar    = computeLaplacianVariance(gray, W, H);
    const sharpScore  = calcSharpnessScore(sharpVar);
    const expResult   = calcExposureScore(histogram, gray.length);
    const qualityScore = Math.round(sharpScore * 0.60 + expResult.score * 0.40);

    // ── 조명·배경 점수 ──────────────────────────────────────────────────────
    const lightScore = calcLightingScore(histogram, gray.length);
    const bgScore    = calcBackgroundScore(imageData);

    // ── 얼굴 영역 추정 → 구도·표정 점수 계산 ─────────────────────────────
    const face = estimateFaceRegion(imageData);

    let compositionScore: number;
    let expressionScore: number;
    let faceData: FaceData;

    if (face) {
      // 얼굴 감지 성공 → 정상 채점
      compositionScore = calcCompositionScore(face.centerX, face.centerY, face.height, W, H);
      expressionScore  = calcExpressionScore(imageData, face.centerX, face.centerY, face.width, face.height);

      // ── 전신 사진 보정 (Full-Body Shot Compensation) ──────────────────
      // 전신 사진은 얼굴이 작아 표정 분석의 정확도가 낮습니다.
      // 인간은 전신 사진에서 표정보다 포즈·구도·전체 분위기를 봅니다.
      // 따라서 전신 사진의 표정 점수는 최솟값 55점을 보장합니다.
      const faceSizeRatio = face.height / H;
      if (faceSizeRatio < 0.18) {
        // 얼굴이 이미지 높이의 18% 미만 = 전신 또는 원거리 사진
        expressionScore = Math.max(expressionScore, 55);
      }

      faceData = {
        centerX: face.centerX, centerY: face.centerY,
        width:   face.width,   height:  face.height,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: expressionScore,
      };
    } else {
      // 얼굴 감지 실패 → 구도·표정 점수를 낮게 설정 (D/C 등급 유도)
      compositionScore = 25;
      expressionScore  = 15;
      faceData = {
        // 크롭 기준점으로 이미지 중앙 상단 사용
        centerX: W / 2, centerY: H * 0.4, width: W * 0.3, height: H * 0.4,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 15,
      };
    }

    // ── 패널티 적용 ───────────────────────────────────────────────────────
    const penalties: Penalty[] = [];
    // exposure.ts 와 동일한 임계값 사용 (0.22)
    if (expResult.isOverexposed)
      penalties.push({ type: 'blown_highlight', score: -15, description: '하이라이트 날림' });
    if (expResult.isUnderexposed)
      penalties.push({ type: 'heavy_shadow',    score: -15, description: '과도한 그림자' });

    // ── 포즈·패션 분석 (전신 여부 관계없이 항상 실행) ─────────────────────
    // 전신 사진: poseScore/fashionScore가 실제 계산값 (0~100)
    // 클로즈업 사진: poseResult.isFullBody=false → poseScore=0, fashionScore=0
    // → 클로즈업은 pose/fashion 가중치(35%)가 0점이 되어 최대 65점(B등급) 이하로 제한됨
    const faceH = face ? face.height : H * 0.4;
    const poseResult = analyzePoseAndFashion(imageData, faceH);

    // buildAnalysis: 가중 합산 → 패널티 적용 → 등급 변환 → 개선 팁 생성
    const analysis = buildAnalysis({
      qualityScore,
      expressionScore,
      compositionScore,
      lightingScore: lightScore,
      backgroundScore: bgScore,
      poseScore:    poseResult.poseScore,    // 클로즈업이면 0
      fashionScore: poseResult.fashionScore, // 클로즈업이면 0
      isFullBody:   poseResult.isFullBody,
      penalties,
      tips: [],
      faceData,
    });

    self.postMessage({ id, analysis } as AnalyzeWorkerOutput);

  } catch {
    // 분석 중 예외 발생 시 D등급 기본값 반환 (파이프라인 중단 방지)
    self.postMessage({
      id,
      analysis: {
        compositionScore: 35, expressionScore: 35, qualityScore: 35,
        lightingScore: 35,    backgroundScore: 35,
        poseScore: 0, fashionScore: 0, isFullBody: false,
        totalScore: 35,
        grade: 'D' as const,
        penalties: [],
        tips: ['분석 중 오류 발생'],
        faceData: {
          centerX: 0, centerY: 0, width: 0, height: 0,
          yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 35,
        },
      },
    } as AnalyzeWorkerOutput);
  }
};
