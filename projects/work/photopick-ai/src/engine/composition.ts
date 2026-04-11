// src/engine/composition.ts
// ─────────────────────────────────────────────────────────────────────────────
// 구도(Composition) 분석 — 사진 촬영의 기본 원칙을 수치로 평가합니다
//
// 평가 항목 4가지:
//   1. 삼분법 (Rule of Thirds) — 40% 비중
//      화면을 3×3으로 나누면 4개의 교차점이 생깁니다.
//      이 "황금 교차점"에 주요 피사체(얼굴)를 배치하면 안정감 있고 역동적인 구도가 됩니다.
//      정중앙보다 살짝 벗어난 위치가 더 자연스럽게 느껴지는 심리학적 원리입니다.
//
//   2. 시선 방향 여백 (Gaze Leading Space) — 25% 비중
//      인물이 오른쪽을 보고 있으면 오른쪽에 여백이 있어야 자연스럽습니다.
//      "시선의 앞에 공간을 준다"는 사진 구도의 기본 원칙입니다.
//
//   3. 헤드룸 (Headroom) — 20% 비중
//      인물 머리 위의 공간입니다. 너무 없으면 답답하고, 너무 많으면 인물이 작아 보입니다.
//      얼굴 위 5~15%의 여백이 가장 자연스럽습니다.
//
//   4. 수평 기울기 (Tilt) — 15% 비중
//      카메라가 기울어지면 수평이 맞지 않아 불안정해 보입니다.
//      양눈 연결선의 기울기로 카메라 수평을 간접 측정합니다.
// ─────────────────────────────────────────────────────────────────────────────

/** 2D 좌표 포인트 타입 */
interface Point { x: number; y: number }

/** 바운딩 박스 (좌상단 x, y + 너비, 높이) */
interface BBox { x: number; y: number; width: number; height: number }

/**
 * 삼분법 점수를 계산합니다 (0~100)
 *
 * 삼분법(Rule of Thirds):
 *   화면을 가로·세로 각각 3등분하면 4개의 "파워 포인트"가 생깁니다.
 *   이 점들에 얼굴 중심이 가까울수록 좋은 구도로 판단합니다.
 *
 * 수식:
 *   얼굴 중심 ~ 가장 가까운 파워 포인트 사이의 거리를 대각선 길이 기준으로 정규화합니다.
 *   거리가 0이면 100점, 대각선의 50% 이상이면 0점
 *
 * @param faceCenter   얼굴 중심 좌표 (픽셀 단위)
 * @param imageWidth   이미지 너비 (픽셀)
 * @param imageHeight  이미지 높이 (픽셀)
 * @returns            삼분법 점수 (0~100)
 */
export function ruleOfThirdsScore(
  faceCenter: Point,
  imageWidth: number,
  imageHeight: number
): number {
  const thirdX = imageWidth  / 3; // 가로 1/3 위치
  const thirdY = imageHeight / 3; // 세로 1/3 위치

  // 4개의 파워 포인트 좌표 (1/3, 2/3 교차점)
  const powerPoints: Point[] = [
    { x: thirdX,     y: thirdY },     // 좌상단 교차점
    { x: thirdX * 2, y: thirdY },     // 우상단 교차점
    { x: thirdX,     y: thirdY * 2 }, // 좌하단 교차점
    { x: thirdX * 2, y: thirdY * 2 }, // 우하단 교차점
  ];

  // 이미지 대각선 길이 (거리 정규화 기준)
  const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);

  // 얼굴 중심 ~ 4개 파워 포인트 중 가장 가까운 거리
  const minDist = Math.min(
    ...powerPoints.map((p) =>
      Math.sqrt((faceCenter.x - p.x) ** 2 + (faceCenter.y - p.y) ** 2)
    )
  );

  // 대각선 대비 거리 비율로 점수 계산 (거리가 클수록 점수 낮아짐)
  // × 200 배율: 대각선의 50%만 벗어나도 0점이 되도록 설정
  return Math.max(0, Math.round(100 - (minDist / diagonal) * 200));
}

/**
 * 시선 방향 여백 점수를 계산합니다 (0~100)
 *
 * 원리:
 *   사람이 어디를 보고 있는지(yaw: 얼굴 좌우 회전 각도)에 따라
 *   시선 방향 앞쪽에 적절한 여백(40~60% 위치)이 있으면 좋은 구도입니다.
 *
 * yaw 값 해석:
 *   yaw > 5°  : 오른쪽을 봄 → 오른쪽 여백 확인
 *   yaw < -5° : 왼쪽을 봄 → 왼쪽 여백 확인
 *   -5°~5°   : 정면 → 중앙 위치면 OK
 *
 * @param faceCenter  얼굴 중심 좌표
 * @param yaw         얼굴 좌우 회전 각도 (양수 = 오른쪽, 음수 = 왼쪽, 도 단위)
 * @param imageWidth  이미지 너비
 * @returns           시선 여백 점수 (0~100)
 */
export function gazeLeadingSpaceScore(
  faceCenter: Point,
  yaw: number,
  imageWidth: number
): number {
  let gazeSpace: number; // 시선 방향의 여백 비율 (0~1)

  if (yaw > 5) {
    // 오른쪽을 보는 경우 → 얼굴 오른쪽 공간 비율
    // 예: 얼굴이 x=300, 이미지 너비 640 → 오른쪽 여백 = (640-300)/640 = 53%
    gazeSpace = (imageWidth - faceCenter.x) / imageWidth;
  } else if (yaw < -5) {
    // 왼쪽을 보는 경우 → 얼굴 왼쪽 공간 비율
    // 예: 얼굴이 x=400 → 왼쪽 여백 = 400/640 = 63%
    gazeSpace = faceCenter.x / imageWidth;
  } else {
    // 정면을 보는 경우 → 화면 중앙(50%)이 이상적
    gazeSpace = 0.5;
  }

  // 0.5(50%)에서 벗어난 정도로 감점
  // 편차가 0이면 100점, 편차가 0.5(극단적으로 치우침)이면 0점
  const deviation = Math.abs(gazeSpace - 0.5);
  return Math.max(0, Math.round(100 - deviation * 200));
}

/**
 * 헤드룸 점수를 계산합니다 (0~100)
 *
 * 헤드룸(Headroom):
 *   인물 머리 위의 빈 공간입니다.
 *   이미지 높이 대비 5~15% 범위가 가장 이상적입니다.
 *
 * 점수 기준:
 *   5~15%: 100점 (이상적)
 *   2% 미만 또는 35% 초과: 0점 (너무 없거나 너무 많음)
 *   그 사이: 10%(중간값)에서 멀어질수록 선형 감점
 *
 * @param faceBBox     얼굴 바운딩 박스 (y: 얼굴 상단의 이미지 내 y 좌표)
 * @param imageHeight  이미지 높이
 * @returns            헤드룸 점수 (0~100)
 */
export function headroomScore(faceBBox: BBox, imageHeight: number): number {
  // 얼굴 상단의 이미지 높이 대비 위치 (faceBBox.y = 얼굴 박스의 맨 위)
  const topSpace = faceBBox.y / imageHeight;

  if (topSpace >= 0.05 && topSpace <= 0.15) return 100; // 이상적인 헤드룸
  if (topSpace < 0.02 || topSpace > 0.35)  return 0;   // 너무 극단적

  // 이상적인 중간값 0.10에서 멀어질수록 감점 (× 500 배율 = 0.02 편차마다 10점 감점)
  const deviation = Math.abs(topSpace - 0.10);
  return Math.max(0, Math.round(100 - deviation * 500));
}

/**
 * 수평 기울기 점수를 계산합니다 (0~100)
 *
 * 수평 기울기(Tilt):
 *   카메라가 기울어지면 수평선이 맞지 않아 사진이 불안정하게 느껴집니다.
 *   양눈의 y좌표 차이로 카메라의 기울기를 간접적으로 측정합니다.
 *
 *   정확히는 "얼굴 자체의 기울기"이지만, 사람이 고개를 심하게 기울이는 경우보다
 *   카메라가 기울어지는 경우가 훨씬 많으므로 실용적인 근사값입니다.
 *
 * 점수 기준:
 *   ±2도 이내: 100점 (수평)
 *   ±15도 이상: 0점 (심하게 기울어짐)
 *   그 사이: 선형 감점
 *
 * @param leftEye   왼쪽 눈 좌표
 * @param rightEye  오른쪽 눈 좌표
 * @returns         수평 기울기 점수 (0~100)
 */
export function tiltScore(leftEye: Point, rightEye: Point): number {
  // 양눈 연결선의 기울기를 각도(도)로 계산
  const deltaY = rightEye.y - leftEye.y; // 오른쪽 눈이 낮으면 양수 (오른쪽 기울어짐)
  const deltaX = rightEye.x - leftEye.x;
  const angleDeg = Math.abs(Math.atan2(deltaY, deltaX) * (180 / Math.PI));

  if (angleDeg <= 2)  return 100; // 2도 이내: 완벽한 수평
  if (angleDeg >= 15) return 0;   // 15도 이상: 심하게 기울어짐

  // 2~15도 사이: 선형 감점 (13도 범위에서 100→0점)
  return Math.max(0, Math.round(100 - (angleDeg - 2) * (100 / 13)));
}

/**
 * 구도 종합 점수를 계산합니다 (0~100)
 *
 * 4가지 구도 요소의 가중 평균:
 *   - 삼분법 (ruleOfThirds): 40% — 가장 중요한 구도 원칙
 *   - 시선 여백 (gazeSpace): 25% — 자연스러운 시선 흐름
 *   - 헤드룸 (headroom):     20% — 인물 위 적절한 공간
 *   - 수평 기울기 (tilt):    15% — 카메라 수평
 *
 * @param scores  각 항목별 점수 객체
 * @returns       종합 구도 점수 (0~100)
 */
export function compositionTotalScore(scores: {
  ruleOfThirds: number; // 삼분법 점수
  gazeSpace: number;    // 시선 방향 여백 점수
  headroom: number;     // 헤드룸 점수
  tilt: number;         // 수평 기울기 점수
}): number {
  return Math.round(
    scores.ruleOfThirds * 0.40 + // 삼분법 40%
    scores.gazeSpace    * 0.25 + // 시선 여백 25%
    scores.headroom     * 0.20 + // 헤드룸 20%
    scores.tilt         * 0.15   // 수평 기울기 15%
  );
}
