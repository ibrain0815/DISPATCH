// src/engine/pose.ts
// ─────────────────────────────────────────────────────────────────────────────
// 전신 포즈 & 패션 분석 엔진 — ML 모델 없이 픽셀 분석만으로 구현
//
// 전신 사진(얼굴 크기 < 이미지 높이의 18%)일 때 추가 평가 항목 5가지:
//
//   1. 바디 프레임 채움 (Body Fill, 30%)
//      인물이 이미지 높이의 얼마나 채우는가? 전신이 잘 들어왔을수록 좋음
//
//   2. 포즈 균형 (Pose Balance, 25%)
//      인물의 수직 중심선 편차 — 자연스럽게 중앙에 서 있는가?
//
//   3. 포즈 역동성 (Pose Dynamism, 20%)
//      실루엣 너비 변화 — 일자로 서 있는 것보다 적당히 동적인 포즈가 좋음
//
//   4. 패션 색상 조화 (Fashion Color Harmony, 15%)
//      상하의 색상이 어울리는가? 보색/유사색/모노톤 조화 평가
//
//   5. 패션 색상 자신감 (Fashion Color Confidence, 10%)
//      선명하고 뚜렷한 색상 조합인가? 과도하게 단조롭거나 혼잡하지 않은가?
//
// 의존성: Web Worker 환경에서 실행 (OffscreenCanvas 전용, DOM 없음)
// ─────────────────────────────────────────────────────────────────────────────

/** 포즈·패션 분석 결과 타입 */
export interface PoseAnalysisResult {
  poseScore:    number;   // 포즈 점수 0~100 (발끝여백+바디필+균형+역동성)
  fashionScore: number;   // 패션 점수 0~100 (색상조화+자신감)
  isFullBody:   boolean;  // 전신 사진 여부 (얼굴 < 이미지 높이 18%)
  bodyFillRatio: number;  // 인물이 프레임을 채우는 비율 (0~1)
  details: {
    footRoom:      number; // 발끝 하단 여백 점수 (핵심 — 발끝이 하단에 가까울수록 높음)
    bodyFill:      number; // 바디 프레임 채움 점수
    poseBalance:   number; // 좌우 균형 점수
    poseDynamism:  number; // 역동성 점수
    colorHarmony:  number; // 색상 조화 점수
    colorConf:     number; // 색상 자신감 점수
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 내부 유틸리티
// ─────────────────────────────────────────────────────────────────────────────

/**
 * RGB → HSV 변환
 * H: 0~360(°), S: 0~1, V: 0~1
 */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === rn)      h = ((gn - bn) / delta + 6) % 6 * 60;
    else if (max === gn) h = ((bn - rn) / delta + 2) * 60;
    else                 h = ((rn - gn) / delta + 4) * 60;
  }
  const s = max === 0 ? 0 : delta / max;
  return [h, s, max]; // [Hue°, Saturation, Value]
}

/**
 * 이미지 4개 모서리에서 배경색을 추정합니다
 * 각 모서리 10×10 패치의 평균 RGB를 계산합니다
 */
function estimateBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number
): [number, number, number] {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  const patchSize = 10;

  // 4개 모서리 패치 순회
  const corners = [
    { startX: 0,           startY: 0 },           // 좌상단
    { startX: width - patchSize, startY: 0 },       // 우상단
    { startX: 0,           startY: height - patchSize }, // 좌하단
    { startX: width - patchSize, startY: height - patchSize }, // 우하단
  ];

  for (const { startX, startY } of corners) {
    for (let y = startY; y < startY + patchSize && y < height; y++) {
      for (let x = startX; x < startX + patchSize && x < width; x++) {
        const idx = (y * width + x) * 4;
        sumR += data[idx]; sumG += data[idx + 1]; sumB += data[idx + 2];
        count++;
      }
    }
  }

  return [sumR / count, sumG / count, sumB / count];
}

/**
 * 픽셀이 배경색과 유사한지 판정합니다
 * RGB 유클리드 거리가 threshold 이하이면 배경으로 판단합니다
 */
function isBackground(
  r: number, g: number, b: number,
  bgR: number, bgG: number, bgB: number,
  threshold = 50
): boolean {
  const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
  return dist < threshold;
}

/**
 * 픽셀이 피부색인지 판정합니다 (analyze.worker와 동일한 강화 조건)
 */
function isSkin(r: number, g: number, b: number): boolean {
  return (
    r > 80 && g > 35 && b > 15 && b < 170 &&
    r > g && r > b &&
    (r - g) + (r - b) > 40
  );
}

/**
 * 픽셀이 의류색인지 판정합니다 (피부색·배경색이 아닌 모든 픽셀)
 */
function isClothing(
  r: number, g: number, b: number,
  bgR: number, bgG: number, bgB: number
): boolean {
  if (isSkin(r, g, b)) return false;
  if (isBackground(r, g, b, bgR, bgG, bgB)) return false;
  // 너무 어두운 픽셀(그림자 영역)은 제외
  const brightness = (r + g + b) / 3;
  if (brightness < 20) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 포즈 분석 함수들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인물 바운딩 박스를 찾습니다
 * 배경이 아닌 픽셀의 상단/하단/좌우 경계를 반환합니다
 */
function findBodyBounds(
  data: Uint8ClampedArray,
  width: number, height: number,
  bgR: number, bgG: number, bgB: number
): { topY: number; bottomY: number; leftX: number; rightX: number } {
  let topY = height, bottomY = 0, leftX = width, rightX = 0;

  for (let y = 0; y < height; y += 2) {
    let rowHasBody = false;
    for (let x = 0; x < width; x += 2) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (!isBackground(r, g, b, bgR, bgG, bgB)) {
        rowHasBody = true;
        if (x < leftX) leftX = x;
        if (x > rightX) rightX = x;
      }
    }
    if (rowHasBody) {
      if (y < topY) topY = y;
      if (y > bottomY) bottomY = y;
    }
  }

  return { topY, bottomY, leftX, rightX };
}

/**
 * 발끝 하단 여백 점수를 계산합니다 (0~100)
 *
 * 패션 사진에서 발끝(신발 끝)이 프레임 하단에 가깝게 위치할수록 좋습니다.
 * "발끝부터 위로 여백 없이 꽉 찬 구도"가 전신 패션 사진의 기본 원칙입니다.
 *
 * footGap = (이미지 높이 - 발끝 bottomY) / 이미지 높이
 *           → 발끝 아래 남은 여백의 비율 (0 = 발끝이 맨 아래, 0.5 = 절반 여백)
 *
 * 점수 기준:
 *   0~5%   (발끝이 거의 하단): 100점 — 이상적. 발끝까지 프레임을 꽉 활용
 *   5~12%  (약간의 여백):      80~100점 — 자연스러운 여유 공간
 *   12~25% (중간 여백):        선형 감소 → 30점 — 인물이 위로 떠 있는 느낌
 *   25% 이상 (과도한 여백):    10점 이하 — 아래 공간이 낭비됨
 *
 * 예외: footGap = 0에 가까워도 발이 잘린 경우(-5% 미만)는 감점
 */
function calcFootRoomScore(bottomY: number, imageHeight: number): number {
  const footGap = (imageHeight - bottomY) / imageHeight; // 발끝 아래 여백 비율

  if (footGap < 0) return 60;                        // 발이 프레임 밖으로 잘림 (감지 오류)
  if (footGap <= 0.05) return 100;                   // 0~5%: 발끝이 거의 하단 — 최고
  if (footGap <= 0.12)                               // 5~12%: 자연스러운 여유
    return Math.round(100 - (footGap - 0.05) / 0.07 * 20); // 100 → 80
  if (footGap <= 0.25)                               // 12~25%: 여백이 점점 많아짐
    return Math.round(80 - (footGap - 0.12) / 0.13 * 50); // 80 → 30
  if (footGap <= 0.40)                               // 25~40%: 많은 여백
    return Math.round(30 - (footGap - 0.25) / 0.15 * 20); // 30 → 10
  return 10;                                         // 40% 이상: 인물이 화면 상단에 뜸
}

/**
 * 바디 프레임 채움 점수를 계산합니다 (0~100)
 *
 * 인물이 이미지 높이의 얼마나 차지하는가를 평가합니다.
 * 전신 사진이라면 인물이 이미지 높이의 65~95%를 채워야 자연스럽습니다.
 *
 * 점수 기준:
 *   65~95%: 100점 (이상적 전신 프레이밍)
 *   50~65%: 선형 감소 → 50점 (너무 멀리서 찍음)
 *   95~100%: 선형 감소 → 70점 (인물이 프레임 밖으로 잘림)
 *   50% 미만: 급격 감소
 */
function calcBodyFillScore(topY: number, bottomY: number, imageHeight: number): number {
  const fillRatio = (bottomY - topY) / imageHeight;

  if (fillRatio >= 0.65 && fillRatio <= 0.95) return 100;
  if (fillRatio >= 0.50 && fillRatio < 0.65)
    return Math.round(50 + (fillRatio - 0.50) / 0.15 * 50);
  if (fillRatio > 0.95)
    return Math.round(70 + (1.0 - fillRatio) / 0.05 * 30);
  if (fillRatio >= 0.35)
    return Math.round((fillRatio - 0.35) / 0.15 * 50);
  return 0;
}

/**
 * 포즈 좌우 균형 점수를 계산합니다 (0~100)
 *
 * 각 행에서 인물 실루엣의 가로 중심 좌표를 구합니다.
 * 이 중심선이 이미지 중앙에 얼마나 가까운지로 균형을 평가합니다.
 * 단, 약간의 편심(삼분법 위치)은 감점하지 않습니다.
 */
function calcPoseBalanceScore(
  data: Uint8ClampedArray,
  width: number, _height: number,
  bgR: number, bgG: number, bgB: number,
  topY: number, bottomY: number
): number {
  const centers: number[] = [];

  for (let y = topY; y <= bottomY; y += 4) {
    let leftEdge = -1, rightEdge = -1;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (!isBackground(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB)) {
        if (leftEdge === -1) leftEdge = x;
        rightEdge = x;
      }
    }
    if (leftEdge !== -1 && rightEdge !== -1) {
      centers.push((leftEdge + rightEdge) / 2);
    }
  }

  if (centers.length === 0) return 50;

  // 중심선의 평균 x 위치
  const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length;

  // 이미지 중앙에서 얼마나 벗어났는지 (0~0.5)
  const deviation = Math.abs(avgCenter / width - 0.5);

  // 25% 이내의 편심은 감점 없음 (삼분법 여유 허용)
  if (deviation <= 0.15) return 100;
  if (deviation >= 0.35) return 0;
  return Math.round(100 - (deviation - 0.15) / 0.20 * 100);
}

/**
 * 포즈 역동성 점수를 계산합니다 (0~100)
 *
 * 실루엣 너비의 행별 변화를 분석합니다.
 * 완전히 직립한 포즈(너비 변화 없음)보다 자연스러운 S-라인/체중 이동이 있는
 * 포즈가 패션 사진에서 더 역동적으로 보입니다.
 *
 * 변화계수(CV, 표준편차/평균)로 너비 변화를 측정합니다:
 *   CV < 0.05: 너무 일자 (막대기 포즈) → 낮은 점수
 *   CV 0.05~0.20: 자연스러운 동적 포즈 → 높은 점수
 *   CV > 0.35: 과도한 동작 (팔을 크게 벌림 등) → 중간 점수
 */
function calcPoseDynamismScore(
  data: Uint8ClampedArray,
  width: number, _height: number,
  bgR: number, bgG: number, bgB: number,
  topY: number, bottomY: number
): number {
  const widths: number[] = [];

  for (let y = topY; y <= bottomY; y += 4) {
    let leftEdge = -1, rightEdge = -1;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (!isBackground(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB)) {
        if (leftEdge === -1) leftEdge = x;
        rightEdge = x;
      }
    }
    if (leftEdge !== -1) widths.push(rightEdge - leftEdge);
  }

  if (widths.length < 5) return 60; // 데이터 부족 시 중간 점수

  const avg = widths.reduce((a, b) => a + b, 0) / widths.length;
  const variance = widths.reduce((acc, w) => acc + (w - avg) ** 2, 0) / widths.length;
  const stddev = Math.sqrt(variance);
  const cv = stddev / (avg + 1); // 변화계수 (0에 가까울수록 일자 포즈)

  if (cv >= 0.05 && cv <= 0.25) return 100; // 자연스러운 포즈
  if (cv < 0.02) return 30;                 // 너무 일자 포즈
  if (cv < 0.05) return Math.round(30 + (cv - 0.02) / 0.03 * 70);
  if (cv <= 0.35) return Math.round(100 - (cv - 0.25) / 0.10 * 40);
  return Math.round(60 - (cv - 0.35) / 0.15 * 30); // 과도한 동작
}

// ─────────────────────────────────────────────────────────────────────────────
// 패션 분석 함수들
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 색상 조화 점수를 계산합니다 (0~100)
 *
 * 의류 픽셀의 색조(Hue) 분포를 분석해 색상 조화를 평가합니다.
 * 패션 색상 조화 이론 적용:
 *
 *   모노톤 (1개 색조 지배):           85점 — 단색 코디, 안정적
 *   유사색 (지배 색조들이 30° 이내):   90점 — 비슷한 색 조합, 세련됨
 *   보색 (지배 색조들이 150~210°):     100점 — 강한 대비, 임팩트
 *   삼각색 (3색이 120° 간격):         90점 — 발랄하고 다채로움
 *   무채색 코디 (채도 낮음):           80점 — 블랙/화이트/베이지 등
 *   4개 이상 색조 (혼잡):             40~60점
 */
function calcColorHarmonyScore(
  data: Uint8ClampedArray,
  width: number, _height: number,
  bgR: number, bgG: number, bgB: number,
  topY: number, bottomY: number
): { harmonyScore: number; confScore: number } {
  // 36개 휴(Hue) 버킷 (10°씩), 채도 합산용
  const hueBuckets = new Float32Array(36);
  const satSum = new Float32Array(36);
  let totalClothing = 0;
  let lowSatCount = 0; // 채도 낮은 픽셀 수 (무채색 의류)

  for (let y = topY; y <= bottomY; y += 3) {
    for (let x = Math.floor(width * 0.1); x < Math.floor(width * 0.9); x += 3) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (!isClothing(r, g, b, bgR, bgG, bgB)) continue;

      totalClothing++;
      const [h, s, v] = rgbToHsv(r, g, b);

      if (s < 0.15 || v < 0.15) {
        // 채도·명도 낮음 = 흰/검/회/베이지 계열 무채색
        lowSatCount++;
      } else {
        const bin = Math.floor(h / 10) % 36;
        hueBuckets[bin]++;
        satSum[bin] += s;
      }
    }
  }

  if (totalClothing < 20) return { harmonyScore: 65, confScore: 65 }; // 의류 픽셀 부족

  const lowSatRatio = lowSatCount / totalClothing;

  // ── 무채색 코디 판단 ──────────────────────────────────────────────────────
  // 의류의 60% 이상이 무채색이면 블랙/화이트/베이지 무채색 코디로 판단
  if (lowSatRatio >= 0.60) {
    return {
      harmonyScore: 80,
      confScore: Math.round(70 + lowSatRatio * 20), // 순수할수록 높은 점수
    };
  }

  // ── 유채색 의류의 지배 색조 분석 ──────────────────────────────────────────
  const totalColored = totalClothing - lowSatCount;
  if (totalColored < 10) return { harmonyScore: 75, confScore: 70 };

  // 각 버킷의 비율 계산
  const bucketRatios = hueBuckets.map((v) => v / totalColored);

  // 지배 색조 (5% 이상 = 유의미한 색)
  const dominantHues: number[] = [];
  for (let i = 0; i < 36; i++) {
    if (bucketRatios[i] >= 0.05) dominantHues.push(i * 10); // 각도로 변환
  }

  // ── 색상 조화 판단 ────────────────────────────────────────────────────────
  let harmonyScore: number;

  if (dominantHues.length === 0 || dominantHues.length === 1) {
    harmonyScore = 85; // 모노톤
  } else if (dominantHues.length === 2) {
    // 두 색의 각도 차이
    const diff = Math.min(
      Math.abs(dominantHues[0] - dominantHues[1]),
      360 - Math.abs(dominantHues[0] - dominantHues[1])
    );
    if (diff <= 30)           harmonyScore = 90; // 유사색
    else if (diff >= 150 && diff <= 210) harmonyScore = 100; // 보색 (최고)
    else if (diff >= 110 && diff <= 130) harmonyScore = 88; // 삼각에 가까운 2색
    else                      harmonyScore = 75; // 어중간한 관계
  } else if (dominantHues.length === 3) {
    // 삼각색 여부 확인 (각 색이 약 120° 간격)
    const diffs = [
      Math.abs(dominantHues[1] - dominantHues[0]),
      Math.abs(dominantHues[2] - dominantHues[1]),
    ].map((d) => Math.min(d, 360 - d));
    const isTriadic = diffs[0] >= 100 && diffs[0] <= 140 &&
                      diffs[1] >= 100 && diffs[1] <= 140;
    harmonyScore = isTriadic ? 90 : 72;
  } else {
    // 4색 이상 = 혼잡
    harmonyScore = Math.max(40, 70 - (dominantHues.length - 3) * 10);
  }

  // 무채색이 섞인 비율에 따라 보너스 (무채색이 적당히 섞이면 세련됨)
  if (lowSatRatio >= 0.30 && lowSatRatio < 0.60) harmonyScore += 5;

  // ── 색상 자신감 점수 ──────────────────────────────────────────────────────
  // 지배 색의 평균 채도가 높을수록 자신감 있는 패션
  let avgSat = 0;
  for (let i = 0; i < 36; i++) {
    if (hueBuckets[i] > 0) avgSat += satSum[i] / hueBuckets[i] * bucketRatios[i];
  }
  // 채도 0~1 → 20~100점 (무채색 코디 제외)
  const confScore = Math.round(20 + Math.min(avgSat * 1.5, 0.80) * 100);

  return {
    harmonyScore: Math.min(100, harmonyScore),
    confScore:    Math.min(100, confScore),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 메인 엔트리 포인트
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 전신 포즈와 패션을 종합 분석합니다
 *
 * @param imageData  분석할 이미지 (640×640 리사이즈 기준)
 * @param faceHeight 얼굴 영역 높이 (px) — 전신 판단에 사용
 * @returns          PoseAnalysisResult
 */
export function analyzePoseAndFashion(
  imageData: ImageData,
  faceHeight: number,
): PoseAnalysisResult {
  const { data, width, height } = imageData;
  const isFullBody = (faceHeight / height) < 0.18;

  if (!isFullBody) {
    // 전신 사진이 아니면 계산 생략, 기본값 반환
    return {
      poseScore: 0, fashionScore: 0, isFullBody: false, bodyFillRatio: 0,
      details: { footRoom: 0, bodyFill: 0, poseBalance: 0, poseDynamism: 0, colorHarmony: 0, colorConf: 0 },
    };
  }

  // ── 배경색 추정 ─────────────────────────────────────────────────────────
  const [bgR, bgG, bgB] = estimateBackgroundColor(data, width, height);

  // ── 인물 바운딩 박스 탐지 ───────────────────────────────────────────────
  const bounds = findBodyBounds(data, width, height, bgR, bgG, bgB);
  const { topY, bottomY } = bounds;

  const bodySpan = bottomY - topY;
  if (bodySpan < height * 0.2) {
    // 인물 영역을 찾지 못한 경우 중간 점수 반환
    return {
      poseScore: 55, fashionScore: 55, isFullBody: true, bodyFillRatio: bodySpan / height,
      details: { footRoom: 55, bodyFill: 55, poseBalance: 55, poseDynamism: 55, colorHarmony: 55, colorConf: 55 },
    };
  }

  // ── 포즈 점수 계산 ───────────────────────────────────────────────────────
  const footRoom    = calcFootRoomScore(bottomY, height);
  const bodyFill    = calcBodyFillScore(topY, bottomY, height);
  const poseBalance = calcPoseBalanceScore(data, width, height, bgR, bgG, bgB, topY, bottomY);
  const poseDynamism = calcPoseDynamismScore(data, width, height, bgR, bgG, bgB, topY, bottomY);

  // 포즈 종합 가중치:
  //   발끝 여백(footRoom) 35% — 핵심 지표: 발끝이 프레임 하단에 가까울수록 좋음
  //   바디 채움(bodyFill) 25% — 인물이 이미지 높이의 65~95%를 차지하는가
  //   좌우 균형(balance)  25% — 인물이 가로 중앙에 위치하는가
  //   역동성(dynamism)    15% — 실루엣 너비 변화 (S라인, 체중 이동 등)
  const poseScore = Math.round(
    footRoom    * 0.35 +
    bodyFill    * 0.25 +
    poseBalance * 0.25 +
    poseDynamism * 0.15
  );

  // ── 패션 색상 점수 계산 ──────────────────────────────────────────────────
  const { harmonyScore, confScore } = calcColorHarmonyScore(
    data, width, height, bgR, bgG, bgB, topY, bottomY
  );

  // 패션 종합: 색상 조화 60% + 색상 자신감 40%
  const fashionScore = Math.round(harmonyScore * 0.60 + confScore * 0.40);

  return {
    poseScore:    Math.max(0, Math.min(100, poseScore)),
    fashionScore: Math.max(0, Math.min(100, fashionScore)),
    isFullBody:   true,
    bodyFillRatio: bodySpan / height,
    details: {
      footRoom,
      bodyFill,
      poseBalance,
      poseDynamism,
      colorHarmony: harmonyScore,
      colorConf:    confScore,
    },
  };
}
