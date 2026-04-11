// src/engine/scorer.ts
// ─────────────────────────────────────────────────────────────────────────────
// 7가지 지표 점수의 단순 평균으로 종합 점수와 등급을 산출합니다.
//
// 종합 점수 = (화질 + 표정 + 구도 + 조명 + 배경 + 포즈 + 패션) ÷ 7
//
// 클로즈업 사진은 포즈·패션이 0점으로 입력되므로 자연스럽게 낮은 점수를 받습니다.
//   예) 기본 5개 지표 모두 90점, 포즈·패션 0 → (90×5 + 0×2) / 7 ≈ 64점 (B등급)
//   예) 전신 우수 사진: 기본 80점 + 포즈 90점 + 패션 85점 → 약 83점 (A등급)
// ─────────────────────────────────────────────────────────────────────────────

import type { Grade, Penalty, DetailedAnalysis, FaceData } from '../types';

/** scorer에 입력되는 지표 점수 */
interface ScoreInputs {
  qualityScore: number;      // 화질: 선명도(60%) + 노출(40%)
  expressionScore: number;   // 표정: 얼굴밝기(35%) + 좌우대칭(40%) + 디테일(25%)
  compositionScore: number;  // 구도: 삼분법(40%) + 헤드룸(35%) + 얼굴크기(25%)
  lightingScore: number;     // 조명: 히스토그램 엔트로피
  backgroundScore: number;   // 배경: 경계 영역 색상 다양성
  poseScore: number;         // 포즈: 바디필+균형+역동성 (클로즈업이면 0)
  fashionScore: number;      // 패션: 색상조화+자신감 (클로즈업이면 0)
  isFullBody: boolean;       // 전신 사진 여부 (팁 생성에 활용)
  penalties: Penalty[];      // 감점 요소 (패널티는 × 0.5 로 최종 점수에 반영)
  tips: string[];            // 미리 생성된 팁 (buildAnalysis 에서 자동 팁과 합침)
  faceData: FaceData;        // 크롭 기준점 데이터
}

/**
 * 적용되는 지표 점수의 단순 평균으로 종합 점수를 산출합니다 (0~100)
 *
 * 클로즈업 사진 (isFullBody=false): 5개 지표 평균
 *   5개 지표 모두 90점 → 90점 → A등급
 *
 * 전신 사진 (isFullBody=true): 7개 지표 평균
 *   기본 80점, 포즈 90점, 패션 85점 → (80×5 + 90 + 85) / 7 ≈ 82점 → A등급
 *
 * 이 방식으로 UI에 표시되는 점수들의 평균 = 종합 점수가 일치합니다.
 */
export function calcTotalScore(inputs: ScoreInputs): number {
  const baseScores = [
    inputs.qualityScore,
    inputs.expressionScore,
    inputs.compositionScore,
    inputs.lightingScore,
    inputs.backgroundScore,
  ];

  // 전신 사진만 포즈·패션을 평균에 포함 (UI에 표시되는 항목과 동일)
  const scores = inputs.isFullBody
    ? [...baseScores, inputs.poseScore, inputs.fashionScore]
    : baseScores;

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;

  // 패널티는 50%만 반영 (너무 가혹하지 않게)
  const penaltySum = inputs.penalties.reduce((acc, p) => acc + p.score, 0);
  return Math.max(0, Math.min(100, Math.round(avg + penaltySum * 0.5)));
}

/**
 * 종합 점수 → 절대 등급 변환
 * 백분위가 아닌 절대 기준이므로 사진 수와 무관하게 동일한 기준 적용
 *
 * 등급 의미:
 *   S (85+): 완성도 높은 전신 패션 사진 (포즈+패션+화질 모두 우수)
 *   A (70+): 좋은 전신 사진 (포즈 또는 패션이 우수)
 *   B (55+): 통과 수준 사진 (클로즈업 우수작 또는 전신 보통)
 *   C (40+): 아쉬운 사진 (클로즈업 보통 또는 전신 불량)
 *   D (-39): 불량 사진
 */
export function scoreToGrade(score: number): Grade {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/** 각 지표 점수에 따라 다음 촬영 개선 팁 자동 생성 */
export function generateTips(inputs: ScoreInputs): string[] {
  const tips: string[] = [];

  if (inputs.qualityScore < 60)
    tips.push('다음 촬영 시 손떨림 방지를 위해 삼각대나 OIS 기능을 사용해보세요');

  if (inputs.compositionScore < 60)
    tips.push('인물을 화면의 삼분법 교차점 근처에 배치해보세요');

  if (inputs.lightingScore < 60)
    tips.push('측면 또는 앞쪽에서 부드러운 광원을 사용하면 조명 점수가 향상됩니다');

  if (inputs.backgroundScore < 60)
    tips.push('배경이 복잡하면 피사체가 묻힙니다. 단순한 배경이나 아웃포커스를 활용하세요');

  if (inputs.isFullBody) {
    // 전신 사진 전용 팁
    if (inputs.poseScore < 60)
      tips.push('전신 사진은 인물이 프레임의 70~90%를 채우고 자연스러운 S-라인 포즈가 좋습니다');
    if (inputs.fashionScore < 60)
      tips.push('의상 색상 조화를 개선해보세요. 보색 또는 유사색 조합이 세련된 코디를 만듭니다');
  } else {
    // 클로즈업 사진 전용 팁
    tips.push('전신이 나오는 패션 사진으로 촬영하면 더 높은 등급을 받을 수 있습니다');
    if (inputs.expressionScore < 60)
      tips.push('눈을 더 크게 뜨고 자연스러운 미소를 유지하면 점수가 올라갑니다');
  }

  return tips;
}

/** 최종 DetailedAnalysis 객체 조립
 *  총점 계산 → 등급 변환 → 팁 생성 → 중복 제거 후 반환 */
export function buildAnalysis(inputs: ScoreInputs): DetailedAnalysis {
  const totalScore = calcTotalScore(inputs);
  const tips = [...new Set([...inputs.tips, ...generateTips(inputs)])];

  return {
    compositionScore: inputs.compositionScore,
    expressionScore:  inputs.expressionScore,
    qualityScore:     inputs.qualityScore,
    lightingScore:    inputs.lightingScore,
    backgroundScore:  inputs.backgroundScore,
    poseScore:        inputs.poseScore,
    fashionScore:     inputs.fashionScore,
    isFullBody:       inputs.isFullBody,
    totalScore,
    grade:     scoreToGrade(totalScore),
    penalties: inputs.penalties,
    tips,
    faceData:  inputs.faceData,
  };
}
