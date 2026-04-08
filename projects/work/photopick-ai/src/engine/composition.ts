// src/engine/composition.ts
// 구도 분석: 삼분법, 시선방향, 헤드룸, 기울기

interface Point { x: number; y: number }
interface BBox { x: number; y: number; width: number; height: number }

/** 삼분법 점수 (0~100)
 *  얼굴 중심이 4개 교차점 중 하나에 가까울수록 높은 점수 */
export function ruleOfThirdsScore(
  faceCenter: Point,
  imageWidth: number,
  imageHeight: number
): number {
  const thirdX = imageWidth / 3;
  const thirdY = imageHeight / 3;
  const powerPoints: Point[] = [
    { x: thirdX, y: thirdY },
    { x: thirdX * 2, y: thirdY },
    { x: thirdX, y: thirdY * 2 },
    { x: thirdX * 2, y: thirdY * 2 },
  ];

  const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
  const minDist = Math.min(
    ...powerPoints.map((p) =>
      Math.sqrt((faceCenter.x - p.x) ** 2 + (faceCenter.y - p.y) ** 2)
    )
  );

  return Math.max(0, Math.round(100 - (minDist / diagonal) * 200));
}

/** 시선 방향 여백 점수 (0~100)
 *  시선 앞쪽에 40~60% 여백이 있으면 최적 */
export function gazeLeadingSpaceScore(
  faceCenter: Point,
  yaw: number,          // + = 오른쪽 봄, - = 왼쪽 봄 (도 단위)
  imageWidth: number
): number {
  let gazeSpace: number;

  if (yaw > 5) {
    gazeSpace = (imageWidth - faceCenter.x) / imageWidth; // 오른쪽 여백
  } else if (yaw < -5) {
    gazeSpace = faceCenter.x / imageWidth; // 왼쪽 여백
  } else {
    gazeSpace = 0.5; // 정면 → 중앙이면 OK
  }

  const deviation = Math.abs(gazeSpace - 0.5); // 0.5(50%)에서 벗어난 정도
  return Math.max(0, Math.round(100 - deviation * 200));
}

/** 헤드룸 점수 (0~100)
 *  얼굴 위 공간이 5~15%가 최적 */
export function headroomScore(faceBBox: BBox, imageHeight: number): number {
  const topSpace = faceBBox.y / imageHeight;
  if (topSpace >= 0.05 && topSpace <= 0.15) return 100;
  if (topSpace < 0.02 || topSpace > 0.35) return 0;
  const deviation = Math.abs(topSpace - 0.10);
  return Math.max(0, Math.round(100 - deviation * 500));
}

/** 수평 기울기 점수 (0~100)
 *  양눈 연결선 기울기가 ±2도 이내면 100 */
export function tiltScore(leftEye: Point, rightEye: Point): number {
  const deltaY = rightEye.y - leftEye.y;
  const deltaX = rightEye.x - leftEye.x;
  const angleDeg = Math.abs(Math.atan2(deltaY, deltaX) * (180 / Math.PI));

  if (angleDeg <= 2) return 100;
  if (angleDeg >= 15) return 0;
  return Math.max(0, Math.round(100 - (angleDeg - 2) * (100 / 13)));
}

/** 구도 종합 점수
 *  삼분법 40% + 시선여백 25% + 헤드룸 20% + 기울기 15% */
export function compositionTotalScore(scores: {
  ruleOfThirds: number;
  gazeSpace: number;
  headroom: number;
  tilt: number;
}): number {
  return Math.round(
    scores.ruleOfThirds * 0.4 +
    scores.gazeSpace * 0.25 +
    scores.headroom * 0.2 +
    scores.tilt * 0.15
  );
}
