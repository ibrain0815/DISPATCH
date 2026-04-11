// src/utils/crop.ts
// ─────────────────────────────────────────────────────────────────────────────
// 인스타그램 비율별 스마트 크롭 계산 및 실제 크롭 이미지 생성
//
// 크롭 기준:
//   모든 비율에서 이미지의 정중앙(가로·세로 모두)을 기준으로 크롭합니다.
//   이전 버전에서는 얼굴 위치 기반으로 크롭했으나, 중앙 기준으로 변경해
//   예측 가능하고 일관된 크롭 결과를 제공합니다.
//
// 화질 보장:
//   renderCrop은 createImageBitmap의 소스 영역 파라미터를 사용해
//   크롭 영역만 디코딩 → 픽셀 1:1 출력 (다운스케일 없음)
// ─────────────────────────────────────────────────────────────────────────────

import type { AspectRatio, FaceData } from '../types';

/** 각 AspectRatio의 가로/세로 비율값 (너비 ÷ 높이) */
const RATIO_MAP: Record<AspectRatio, number> = {
  '1:1':    1,        // 정사각형
  '4:5':    4 / 5,    // 세로 피드 (0.8)
  '1.91:1': 1.91,     // 가로 피드 (약 1.91)
  '9:16':   9 / 16,   // 릴스/스토리 (0.5625)
};

/** 크롭 영역 좌표와 크기 */
export interface CropRect {
  x: number;       // 원본 이미지 기준 좌측 시작점 (px)
  y: number;       // 원본 이미지 기준 상단 시작점 (px)
  width: number;   // 크롭 너비 (px)
  height: number;  // 크롭 높이 (px)
}

/**
 * 이미지 정중앙을 기준으로 최적 크롭 영역을 계산합니다
 *
 * 크롭 크기 결정 원칙:
 *   - 원본보다 업스케일하지 않음 (scale ≤ 1)
 *   - 목표 비율에 맞게 원본에서 최대한 크게 자름
 *   - 가로·세로 모두 이미지 정중앙 기준 (얼굴 위치 무시)
 *
 * @param imageWidth  원본 이미지 너비 (px)
 * @param imageHeight 원본 이미지 높이 (px)
 * @param _faceData   얼굴 데이터 (현재 미사용 — 향후 얼굴 기반 크롭 재도입 시 활용)
 * @param ratio       인스타그램 크롭 비율
 */
export function calcSmartCrop(
  imageWidth: number,
  imageHeight: number,
  _faceData: FaceData,
  ratio: AspectRatio
): CropRect {
  const targetRatio = RATIO_MAP[ratio];

  // 크롭 영역 크기 결정 — 원본에서 최대 크기로 잘라내기
  let cropW: number, cropH: number;
  if (imageWidth / imageHeight > targetRatio) {
    // 원본이 목표 비율보다 더 넓음 → 높이를 최대로 채우고 너비를 맞춤
    cropH = imageHeight;
    cropW = Math.round(cropH * targetRatio);
  } else {
    // 원본이 목표 비율보다 더 높음(좁음) → 너비를 최대로 채우고 높이를 맞춤
    cropW = imageWidth;
    cropH = Math.round(cropW / targetRatio);
  }

  // 가로·세로 모두 이미지 정중앙 기준으로 크롭 위치 계산
  let x = Math.round(imageWidth  / 2 - cropW / 2);
  let y = Math.round(imageHeight / 2 - cropH / 2);

  // 경계 클램핑 — 크롭 영역이 이미지 밖으로 나가지 않도록
  x = Math.max(0, Math.min(x, imageWidth  - cropW));
  y = Math.max(0, Math.min(y, imageHeight - cropH));

  return { x, y, width: cropW, height: cropH };
}

/**
 * 크롭 영역을 원본 해상도 그대로 Blob으로 출력합니다
 *
 * 핵심: createImageBitmap(file, x, y, w, h) 형식을 사용하면
 *       브라우저가 지정된 소스 영역만 디코딩 → 메모리 효율적
 *       결과물은 crop.width × crop.height 원본 해상도 (다운스케일 없음)
 *
 * @param file 원본 파일 (File 객체 — ArrayBuffer가 아닌 File 직접 사용)
 * @param crop calcSmartCrop()으로 계산된 크롭 영역
 * @returns    JPEG Blob (quality 0.95 — 원본 화질에 최대한 근접)
 */
export async function renderCrop(
  file: File,
  crop: CropRect
): Promise<Blob> {
  // 소스 좌표를 직접 지정해 해당 영역만 디코딩 (전체 이미지 디코딩 후 잘라내는 것보다 효율적)
  const bitmap = await createImageBitmap(
    file,
    crop.x, crop.y, crop.width, crop.height
  );

  // 크롭 크기와 동일한 캔버스에 1:1 드로잉
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx    = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close(); // 메모리 즉시 해제

  // JPEG quality 0.95: 육안으로 원본과 구분 불가 수준의 화질
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
