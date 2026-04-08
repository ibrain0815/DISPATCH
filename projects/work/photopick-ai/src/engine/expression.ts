// src/engine/expression.ts
// 표정 분석: EAR(눈 뜨임), 미소, 패널티

import type { Penalty } from '../types';

type Landmark = { x: number; y: number; z: number };

/** MediaPipe Face Mesh 눈 랜드마크 인덱스 */
const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

/** EAR (Eye Aspect Ratio) 계산
 *  정상: 0.25 이상 / 반쯤 감음: 0.15~0.22 / 감음: 0.15 미만 */
export function calculateEAR(landmarks: Landmark[], eyeIndices: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((i) => landmarks[i]);
  const v1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);
  const v2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);
  const h = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);
  return (v1 + v2) / (2.0 * h);
}

/** 미소 점수 (0~100)
 *  입꼬리(61, 291)가 윗입술(13) 위로 올라갈수록 미소 */
export function smileScore(landmarks: Landmark[]): number {
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];

  const cornerAvgY = (leftCorner.y + rightCorner.y) / 2;
  const smileRatio = (upperLip.y - cornerAvgY) / (lowerLip.y - upperLip.y + 0.001);

  return Math.min(100, Math.max(0, Math.round(smileRatio * 200)));
}

/** 표정 종합 평가 — 점수 + 패널티 목록 반환 */
export function evaluateExpression(
  landmarks: Landmark[]
): { score: number; eyeAspectRatio: number; smile: number; penalties: Penalty[] } {
  const leftEAR = calculateEAR(landmarks, LEFT_EYE_IDX);
  const rightEAR = calculateEAR(landmarks, RIGHT_EYE_IDX);
  const avgEAR = (leftEAR + rightEAR) / 2;
  const smile = smileScore(landmarks);

  const penalties: Penalty[] = [];
  let score = 50; // 기본 점수

  // 눈 뜨임 판정
  if (avgEAR < 0.15) {
    penalties.push({ type: 'eyes_closed', score: -35, description: '눈을 감았습니다' });
    score -= 35;
  } else if (avgEAR < 0.22) {
    penalties.push({ type: 'half_blink', score: -15, description: '눈을 반쯤 감았습니다' });
    score -= 15;
  } else {
    score += 20; // 눈 잘 뜸 보너스
  }

  // 미소 반영
  score += Math.round(smile * 0.3); // 최대 30점

  // 입 벌림 감지 (랜드마크 13, 14 거리)
  const mouthGap = Math.abs(landmarks[13].y - landmarks[14].y);
  if (mouthGap > 0.05) {
    penalties.push({ type: 'mouth_open', score: -10, description: '입이 벌려져 있습니다' });
    score -= 10;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    eyeAspectRatio: avgEAR,
    smile,
    penalties,
  };
}
