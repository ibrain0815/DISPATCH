// src/engine/expression.ts
// ─────────────────────────────────────────────────────────────────────────────
// 표정 분석 — EAR(눈 뜨임), 미소 점수, 패널티 평가
//
// 사용 기술: MediaPipe Face Mesh 랜드마크
//   MediaPipe Face Mesh는 얼굴에서 468개의 3D 랜드마크(기준점)를 탐지합니다.
//   각 랜드마크는 얼굴 이미지 내의 정규화된 좌표 (x: 0~1, y: 0~1, z: 깊이)를 가집니다.
//   이 좌표들을 이용해 눈·입의 열림 정도를 수치로 계산합니다.
//
// 평가 항목:
//   1. EAR (Eye Aspect Ratio, 눈 가로세로 비율) — 눈을 떴는지 확인
//   2. 미소 점수 — 입꼬리 위치로 미소 정도 측정
//   3. 입 벌림 패널티 — 입이 크게 벌어진 경우 감점
// ─────────────────────────────────────────────────────────────────────────────

import type { Penalty } from '../types';

/** MediaPipe 랜드마크 단일 포인트 타입 (정규화된 3D 좌표) */
type Landmark = { x: number; y: number; z: number };

// ── MediaPipe Face Mesh 눈 랜드마크 인덱스 ──────────────────────────────────
// EAR 계산에 사용되는 눈 주변 6개 포인트의 인덱스입니다.
// 순서: [왼쪽끝, 위1, 위2, 오른쪽끝, 아래1, 아래2]
// 참고: https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker

/** 왼쪽 눈 랜드마크 6개 인덱스 (MediaPipe 기준) */
const LEFT_EYE_IDX  = [33, 160, 158, 133, 153, 144];

/** 오른쪽 눈 랜드마크 6개 인덱스 (MediaPipe 기준) */
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

/**
 * EAR (Eye Aspect Ratio, 눈 가로세로 비율)을 계산합니다
 *
 * EAR 공식 (Soukupová & Čech, 2016):
 *   EAR = (‖p2-p6‖ + ‖p3-p5‖) / (2 × ‖p1-p4‖)
 *
 *   p1─────────────────────p4  ← 가로 방향 (p1: 안쪽끝, p4: 바깥끝)
 *          p2     p3            ← 윗 눈꺼풀 포인트
 *          p6     p5            ← 아랫 눈꺼풀 포인트
 *
 *   분자: 눈꺼풀 세로 거리의 합 (눈이 크게 떠질수록 커짐)
 *   분모: 눈의 가로 거리 × 2 (눈 크기로 정규화)
 *
 * EAR 값 해석:
 *   0.25 이상: 눈을 크게 뜸 (정상)
 *   0.15~0.22: 눈을 반쯤 감음 (약한 패널티)
 *   0.15 미만: 눈을 감음 (강한 패널티)
 *
 * @param landmarks  MediaPipe 얼굴 랜드마크 배열 (468개)
 * @param eyeIndices 눈 랜드마크 6개 인덱스 [p1, p2, p3, p4, p5, p6]
 * @returns          EAR 값 (0~약 0.35)
 */
export function calculateEAR(landmarks: Landmark[], eyeIndices: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map((i) => landmarks[i]);

  // 눈꺼풀 세로 거리 1 (위쪽 포인트 1 ↔ 아래쪽 포인트 1)
  const v1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);

  // 눈꺼풀 세로 거리 2 (위쪽 포인트 2 ↔ 아래쪽 포인트 2)
  const v2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);

  // 눈의 가로 거리 (안쪽끝 ↔ 바깥끝)
  const h = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);

  return (v1 + v2) / (2.0 * h); // EAR 공식
}

/**
 * 미소 점수를 계산합니다 (0~100)
 *
 * 미소 측정 원리:
 *   미소를 지을 때 입꼬리가 위로 올라갑니다.
 *   입꼬리의 y좌표와 윗입술 중앙의 y좌표를 비교합니다.
 *   (이미지 좌표계에서 y가 작을수록 위쪽)
 *
 * 사용 랜드마크:
 *   61: 왼쪽 입꼬리
 *  291: 오른쪽 입꼬리
 *   13: 윗입술 중앙
 *   14: 아랫입술 중앙
 *
 * smileRatio 계산:
 *   = (윗입술_y - 입꼬리평균_y) / 입 높이
 *   입꼬리가 윗입술보다 위에 있으면 양수 (미소)
 *   입꼬리가 윗입술보다 아래에 있으면 음수 (무표정 또는 슬픈 표정)
 *
 * @param landmarks  MediaPipe 얼굴 랜드마크 배열
 * @returns          미소 점수 (0~100)
 */
export function smileScore(landmarks: Landmark[]): number {
  const leftCorner  = landmarks[61];  // 왼쪽 입꼬리
  const rightCorner = landmarks[291]; // 오른쪽 입꼬리
  const upperLip    = landmarks[13];  // 윗입술 중앙
  const lowerLip    = landmarks[14];  // 아랫입술 중앙

  // 양쪽 입꼬리의 평균 y좌표
  const cornerAvgY = (leftCorner.y + rightCorner.y) / 2;

  // 미소 비율: 입꼬리가 윗입술 위로 올라간 정도를 입 높이로 정규화
  // + 0.001: 입이 완전히 닫혀 높이가 0인 경우의 0 나누기 방지
  const smileRatio = (upperLip.y - cornerAvgY) / (lowerLip.y - upperLip.y + 0.001);

  // 0~100 범위로 변환 (× 200 배율: smileRatio가 0.5이면 100점)
  return Math.min(100, Math.max(0, Math.round(smileRatio * 200)));
}

/**
 * 표정을 종합 평가합니다 — 점수와 패널티 목록을 함께 반환합니다
 *
 * 점수 계산:
 *   기본 점수 50점에서 시작
 *   + 눈을 잘 뜸: +20점
 *   + 미소: 최대 +30점 (미소 점수 × 0.3)
 *   - 눈 감음: -35점
 *   - 반쯤 감음: -15점
 *   - 입 벌림: -10점
 *
 * @param landmarks  MediaPipe 얼굴 랜드마크 배열 (468개)
 * @returns          {
 *                     score: 종합 표정 점수 (0~100),
 *                     eyeAspectRatio: 평균 EAR 값,
 *                     smile: 미소 점수 (0~100),
 *                     penalties: 적용된 패널티 목록
 *                   }
 */
export function evaluateExpression(
  landmarks: Landmark[]
): { score: number; eyeAspectRatio: number; smile: number; penalties: Penalty[] } {
  // 좌우 눈 EAR 계산
  const leftEAR  = calculateEAR(landmarks, LEFT_EYE_IDX);
  const rightEAR = calculateEAR(landmarks, RIGHT_EYE_IDX);
  const avgEAR   = (leftEAR + rightEAR) / 2; // 양쪽 평균 EAR

  const smile = smileScore(landmarks); // 미소 점수

  const penalties: Penalty[] = [];
  let score = 50; // 기본 점수

  // ── 눈 뜨임 판정 ───────────────────────────────────────────────────────────
  if (avgEAR < 0.15) {
    // 눈을 완전히 감은 상태 (순간 포착된 눈 깜빡임 등)
    penalties.push({ type: 'eyes_closed', score: -35, description: '눈을 감았습니다' });
    score -= 35;
  } else if (avgEAR < 0.22) {
    // 눈을 반쯤 감은 상태 (졸린 눈, 역광에 찡그림 등)
    penalties.push({ type: 'half_blink', score: -15, description: '눈을 반쯤 감았습니다' });
    score -= 15;
  } else {
    // 눈을 잘 뜬 상태 → 보너스
    score += 20;
  }

  // ── 미소 반영 ─────────────────────────────────────────────────────────────
  // 미소 점수의 30%를 총점에 반영 (미소 점수 100점 = +30점 추가)
  score += Math.round(smile * 0.3);

  // ── 입 벌림 감지 ──────────────────────────────────────────────────────────
  // 랜드마크 13(윗입술)과 14(아랫입술)의 y좌표 차이로 입 열림 판단
  // 0.05 이상: 입이 눈에 띄게 벌어진 상태 (자연스럽지 않은 입 벌림)
  const mouthGap = Math.abs(landmarks[13].y - landmarks[14].y);
  if (mouthGap > 0.05) {
    penalties.push({ type: 'mouth_open', score: -10, description: '입이 벌려져 있습니다' });
    score -= 10;
  }

  return {
    score: Math.max(0, Math.min(100, score)), // 0~100 범위 클램핑
    eyeAspectRatio: avgEAR,
    smile,
    penalties,
  };
}
