// src/engine/scorer.ts
// 가중치 합산 → 종합 점수 → 등급 환산

import type { Grade, Penalty, DetailedAnalysis, FaceData } from '../types';

interface ScoreInputs {
  qualityScore: number;     // 화질 (블러 + 노출)
  expressionScore: number;  // 표정
  compositionScore: number; // 구도
  lightingScore: number;    // 조명
  backgroundScore: number;  // 배경
  penalties: Penalty[];
  tips: string[];
  faceData: FaceData;
}

/** 가중치 설정 (합계 = 1.0) */
const WEIGHTS = {
  quality: 0.30,
  expression: 0.25,
  composition: 0.20,
  lighting: 0.15,
  background: 0.10,
};

/** 총점 계산 (패널티 적용 후) */
export function calcTotalScore(inputs: ScoreInputs): number {
  const weighted =
    inputs.qualityScore * WEIGHTS.quality +
    inputs.expressionScore * WEIGHTS.expression +
    inputs.compositionScore * WEIGHTS.composition +
    inputs.lightingScore * WEIGHTS.lighting +
    inputs.backgroundScore * WEIGHTS.background;

  const penaltySum = inputs.penalties.reduce((acc, p) => acc + p.score, 0);
  return Math.max(0, Math.min(100, Math.round(weighted + penaltySum * 0.5)));
}

/** 점수 → 등급 변환 */
export function scoreToGrade(score: number): Grade {
  if (score >= 85) return 'S';
  if (score >= 70) return 'A';
  if (score >= 55) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

/** 개선 팁 자동 생성 */
export function generateTips(inputs: ScoreInputs): string[] {
  const tips: string[] = [];

  if (inputs.qualityScore < 60) {
    tips.push('다음 촬영 시 손떨림 방지를 위해 삼각대나 OIS 기능을 사용해보세요');
  }
  if (inputs.expressionScore < 60) {
    tips.push('눈을 더 크게 뜨고 자연스러운 미소를 유지하면 점수가 올라갑니다');
  }
  if (inputs.compositionScore < 60) {
    tips.push('얼굴을 화면의 삼분법 교차점 근처에 배치해보세요');
  }
  if (inputs.lightingScore < 60) {
    tips.push('측면 또는 앞쪽에서 부드러운 광원을 사용하면 조명 점수가 향상됩니다');
  }
  if (inputs.backgroundScore < 60) {
    tips.push('배경이 복잡하면 피사체가 묻힙니다. 단순한 배경이나 아웃포커스를 활용하세요');
  }

  return tips;
}

/** 최종 DetailedAnalysis 객체 조립 */
export function buildAnalysis(inputs: ScoreInputs): DetailedAnalysis {
  const totalScore = calcTotalScore(inputs);
  const tips = [...inputs.tips, ...generateTips(inputs)];

  return {
    compositionScore: inputs.compositionScore,
    expressionScore: inputs.expressionScore,
    qualityScore: inputs.qualityScore,
    lightingScore: inputs.lightingScore,
    backgroundScore: inputs.backgroundScore,
    totalScore,
    grade: scoreToGrade(totalScore),
    penalties: inputs.penalties,
    tips: [...new Set(tips)], // 중복 제거
    faceData: inputs.faceData,
  };
}
