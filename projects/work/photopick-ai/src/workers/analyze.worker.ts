// src/workers/analyze.worker.ts
// 3차 정밀 분석 Worker — S/A/B/C/D 등급이 자연스럽게 분포되도록 절대 점수 산출

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';
import { computeLaplacianVariance } from '../engine/blur';
import { buildAnalysis } from '../engine/scorer';
import type { AnalyzeWorkerInput, AnalyzeWorkerOutput, FaceData, Penalty } from '../types';

// ────────────────────────────────────────────────────────────
// 점수 보정 목표 (가중 평균 기준)
//   D(<40):  블러/노출 불량, 얼굴 없거나 구도 나쁨  → 20-39
//   C(40-54): 평균 이하 (구도·표정 아쉬움)          → 40-54
//   B(55-69): 보통 (1차 필터 통과한 대부분)          → 55-69
//   A(70-84): 좋음 (구도·표정·조명 모두 양호)        → 70-84
//   S(85+):  탁월 (모든 지표 우수)                  → 85-100
// ────────────────────────────────────────────────────────────

/** 블러: 로그 스케일, 1차 필터 통과(variance≥50) 기준으로 분포
 *  50 → 30점, 200 → 52점, 600 → 68점, 2000 → 85점, 5000+ → 100점
 */
function calcSharpnessScore(variance: number): number {
  if (variance <= 0) return 0;
  // 1차 통과 최솟값(50)을 0점 기준으로 재스케일
  const adjusted = Math.max(0, variance - 50);
  const score = Math.log1p(adjusted) / Math.log1p(5000) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/** 노출: 이상적 밝기 범위(80-180) 중심으로 감점 방식
 *  평균 밝기가 중간값에서 벗어날수록, 극단 픽셀이 많을수록 낮은 점수
 *  일반 실내 사진 기준 50-65점 정도가 나오도록 보정
 */
function calcExposureScore(histogram: Uint32Array, totalPixels: number) {
  let brightnessSum = 0, darkPixels = 0, brightPixels = 0, midPixels = 0;
  for (let i = 0; i < 256; i++) {
    brightnessSum += i * histogram[i];
    if (i < 30)  darkPixels  += histogram[i];
    if (i > 225) brightPixels += histogram[i];
    if (i >= 80 && i <= 180) midPixels += histogram[i];
  }
  const brightness = brightnessSum / totalPixels;
  const darkRatio   = darkPixels   / totalPixels;
  const brightRatio = brightPixels / totalPixels;
  const midRatio    = midPixels    / totalPixels; // 이상적 범위 0.4~0.65

  // 기준점: midRatio 0.55 → 60점
  let score = midRatio * 110; // 0.55 → 60.5, 0.7 → 77 (상한 제한)
  score = Math.min(score, 75); // 노출 단독으로 75점 이상 어렵게

  // 극단 노출 감점
  if (brightRatio > 0.03) score -= brightRatio * 250;
  if (darkRatio   > 0.08) score -= darkRatio   * 200;
  if (brightness < 50 || brightness > 210) score -= 20;

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    brightness,
    isOverexposed:  brightRatio > 0.05,
    isUnderexposed: darkRatio   > 0.10,
  };
}

/** 조명: 히스토그램 엔트로피 기반
 *  엔트로피 4.5 → 30점, 5.5 → 50점, 6.5 → 70점, 7.5+ → 90점
 */
function calcLightingScore(histogram: Uint32Array, totalPixels: number): number {
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (histogram[i] === 0) continue;
    const p = histogram[i] / totalPixels;
    entropy -= p * Math.log2(p);
  }
  // 엔트로피 4~8 → 0~100으로 선형 매핑
  const score = (entropy - 4) / 4 * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** 배경: 가장자리 색상 다양성 — 실제 사진은 색상 수가 많아 낮은 점수
 *  n<=5 → 95(단색), n=20 → 68, n=50 → 42, n=100+ → 10
 */
function calcBackgroundScore(imageData: ImageData): number {
  const { data, width, height } = imageData;
  const border = Math.floor(Math.min(width, height) * 0.18);
  const colorSet = new Set<number>();

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const isEdge = x < border || x > width - border || y < border || y > height - border;
      if (!isEdge) continue;
      const idx = (y * width + x) * 4;
      // 5비트 양자화 (32단계)
      const key = ((data[idx] >> 3) << 10) | ((data[idx + 1] >> 3) << 5) | (data[idx + 2] >> 3);
      colorSet.add(key);
    }
  }

  const n = colorSet.size;
  if (n <= 4)  return 95;
  if (n <= 10) return Math.round(95 - (n - 4) / 6 * 25);  // 95→70
  if (n <= 40) return Math.round(70 - (n - 10) / 30 * 35); // 70→35
  if (n <= 100) return Math.round(35 - (n - 40) / 60 * 25); // 35→10
  return 10;
}

/** 피부색 픽셀로 얼굴 영역 추정 */
function estimateFaceRegion(imageData: ImageData) {
  const { data, width, height } = imageData;
  let sumX = 0, sumY = 0, count = 0;
  let minX = width, maxX = 0, minY = height, maxY = 0;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const isSkin = r > 95 && g > 40 && b > 20 && r > g && r > b &&
        Math.abs(r - g) > 15 && r - b > 15;
      if (isSkin) {
        sumX += x; sumY += y; count++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  if (count < 10) return null;
  return { centerX: sumX / count, centerY: sumY / count, width: maxX - minX, height: maxY - minY };
}

/** 구도: 삼분법 + 헤드룸 + 얼굴 크기 비율
 *  완벽한 조건이 갖춰져야 높은 점수 → 자연스러운 분포
 */
function calcCompositionScore(cx: number, cy: number, faceH: number, W: number, H: number): number {
  // 삼분법 (0-100)
  const t = W / 3, u = H / 3;
  const pts = [{ x: t, y: u }, { x: t * 2, y: u }, { x: t, y: u * 2 }, { x: t * 2, y: u * 2 }];
  const diag = Math.sqrt(W ** 2 + H ** 2);
  const minDist = Math.min(...pts.map(p => Math.sqrt((cx - p.x) ** 2 + (cy - p.y) ** 2)));
  const rotScore = Math.max(0, Math.round(100 - (minDist / diag) * 220));

  // 헤드룸 (얼굴 상단 여백 5-22%가 이상적)
  const topRatio = (cy - faceH / 2) / H;
  let hrScore: number;
  if (topRatio >= 0.05 && topRatio <= 0.22) hrScore = 100;
  else if (topRatio < 0.01 || topRatio > 0.50) hrScore = 0;
  else hrScore = Math.max(0, Math.round(100 - Math.abs(topRatio - 0.13) * 400));

  // 얼굴 크기 비율 (이미지 높이 대비 20-55%가 이상적)
  const sizeRatio = faceH / H;
  let sizeScore: number;
  if (sizeRatio >= 0.20 && sizeRatio <= 0.55) sizeScore = 100;
  else if (sizeRatio < 0.08 || sizeRatio > 0.85) sizeScore = 0;
  else if (sizeRatio < 0.20) sizeScore = Math.round((sizeRatio - 0.08) / 0.12 * 100);
  else sizeScore = Math.round((0.85 - sizeRatio) / 0.30 * 100);

  return Math.round(rotScore * 0.40 + hrScore * 0.35 + sizeScore * 0.25);
}

/** 표정: 얼굴 밝기 균일도 + 좌우 대칭 + 디테일(분산)
 *  조명 불균형이나 측면 촬영 시 낮은 점수
 */
function calcExpressionScore(
  imageData: ImageData, cx: number, cy: number, fw: number, fh: number
): number {
  const { data, width } = imageData;
  const x0 = Math.max(0, Math.round(cx - fw * 0.45));
  const x1 = Math.min(imageData.width - 1, Math.round(cx + fw * 0.45));
  const y0 = Math.max(0, Math.round(cy - fh * 0.45));
  const y1 = Math.min(imageData.height - 1, Math.round(cy + fh * 0.45));

  if (x1 <= x0 || y1 <= y0) return 45;

  let sum = 0, count = 0, leftSum = 0, rightSum = 0, lc = 0, rc = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      sum += lum; count++;
      if (x < cx) { leftSum += lum; lc++; } else { rightSum += lum; rc++; }
    }
  }
  if (count === 0) return 45;

  const mean = sum / count;

  // 얼굴 밝기 (90-190 범위가 최적)
  let brightnessScore: number;
  if (mean >= 90 && mean <= 190) brightnessScore = 100;
  else if (mean < 40 || mean > 230) brightnessScore = 10;
  else if (mean < 90) brightnessScore = Math.round((mean - 40) / 50 * 90 + 10);
  else brightnessScore = Math.round((230 - mean) / 40 * 90 + 10);

  // 좌우 대칭 (정면 여부)
  const lm = lc > 0 ? leftSum / lc : mean;
  const rm = rc > 0 ? rightSum / rc : mean;
  const asymmetry = Math.abs(lm - rm) / (mean + 1);
  // 비대칭 0.05 이하 = 100점, 0.3 이상 = 0점
  const symmetryScore = Math.max(0, Math.round(100 - (asymmetry / 0.30) * 100));

  // 얼굴 디테일 분산 (선명한 눈/코/입 = 높은 분산)
  let variance = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      variance += (lum - mean) ** 2;
    }
  }
  const stddev = Math.sqrt(variance / count);
  // stddev 15 미만 = 밋밋한 얼굴, 50 이상 = 선명한 얼굴
  const detailScore = Math.min(100, Math.round((stddev - 10) / 45 * 100));

  return Math.max(0, Math.round(brightnessScore * 0.35 + symmetryScore * 0.40 + detailScore * 0.25));
}

self.onmessage = async (e: MessageEvent<AnalyzeWorkerInput>) => {
  const { id, fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    const { imageData } = await loadAndResize(file, 640, 640);
    const gray = toGrayscale(imageData);
    const histogram = computeHistogram(gray);
    const W = imageData.width, H = imageData.height;

    // 화질 (블러 + 노출) ─────────────────────────────────
    const sharpVar = computeLaplacianVariance(gray, W, H);
    const sharpScore = calcSharpnessScore(sharpVar);
    const expResult = calcExposureScore(histogram, gray.length);
    const qualityScore = Math.round(sharpScore * 0.60 + expResult.score * 0.40);

    // 조명 / 배경 ─────────────────────────────────────────
    const lightScore = calcLightingScore(histogram, gray.length);
    const bgScore = calcBackgroundScore(imageData);

    // 얼굴 영역 추정 ───────────────────────────────────────
    const face = estimateFaceRegion(imageData);

    let compositionScore: number;
    let expressionScore: number;
    let faceData: FaceData;

    if (face) {
      compositionScore = calcCompositionScore(face.centerX, face.centerY, face.height, W, H);
      expressionScore  = calcExpressionScore(imageData, face.centerX, face.centerY, face.width, face.height);
      faceData = {
        centerX: face.centerX, centerY: face.centerY,
        width: face.width, height: face.height,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: expressionScore,
      };
    } else {
      // 얼굴 감지 실패 → 구도·표정 점수 낮게
      compositionScore = 25;
      expressionScore  = 15;
      faceData = {
        centerX: W / 2, centerY: H * 0.4, width: W * 0.3, height: H * 0.4,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 15,
      };
    }

    // 패널티 ──────────────────────────────────────────────
    const penalties: Penalty[] = [];
    if (expResult.isOverexposed)
      penalties.push({ type: 'blown_highlight', score: -15, description: '하이라이트 날림' });
    if (expResult.isUnderexposed)
      penalties.push({ type: 'heavy_shadow',    score: -15, description: '과도한 그림자' });

    const analysis = buildAnalysis({
      qualityScore,
      expressionScore,
      compositionScore,
      lightingScore: lightScore,
      backgroundScore: bgScore,
      penalties,
      tips: [],
      faceData,
    });

    self.postMessage({ id, analysis } as AnalyzeWorkerOutput);
  } catch {
    self.postMessage({
      id,
      analysis: {
        compositionScore: 35, expressionScore: 35, qualityScore: 35,
        lightingScore: 35, backgroundScore: 35, totalScore: 35,
        grade: 'D' as const, penalties: [],
        tips: ['분석 중 오류 발생'],
        faceData: { centerX: 0, centerY: 0, width: 0, height: 0, yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 35 },
      },
    } as AnalyzeWorkerOutput);
  }
};
