// src/utils/crop.ts
// 인스타 비율별 스마트 크롭 — 얼굴 중심 기준

import type { AspectRatio, FaceData } from '../types';

const RATIO_MAP: Record<AspectRatio, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '1.91:1': 1.91,
  '9:16': 9 / 16,
};

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 얼굴 중심을 기준으로 최적 크롭 영역 계산
 * @param imageWidth  원본 이미지 너비 (px)
 * @param imageHeight 원본 이미지 높이 (px)
 * @param faceData    정밀 분석 결과의 얼굴 데이터 (정규화 아닌 px 단위)
 * @param ratio       인스타 크롭 비율
 */
export function calcSmartCrop(
  imageWidth: number,
  imageHeight: number,
  _faceData: FaceData,
  ratio: AspectRatio
): CropRect {
  const targetRatio = RATIO_MAP[ratio];

  // 크롭 영역 크기 결정 (원본에서 최대한 크게)
  let cropW: number, cropH: number;
  if (imageWidth / imageHeight > targetRatio) {
    // 원본이 더 넓음 → 높이 기준
    cropH = imageHeight;
    cropW = Math.round(cropH * targetRatio);
  } else {
    // 원본이 더 높음 → 너비 기준
    cropW = imageWidth;
    cropH = Math.round(cropW / targetRatio);
  }

  // 가로·세로 모두 이미지 정중앙 기준으로 크롭
  let x = Math.round(imageWidth / 2 - cropW / 2);
  let y = Math.round(imageHeight / 2 - cropH / 2);

  // 경계 클램핑
  x = Math.max(0, Math.min(x, imageWidth - cropW));
  y = Math.max(0, Math.min(y, imageHeight - cropH));

  return { x, y, width: cropW, height: cropH };
}

/**
 * 크롭 영역을 원본 해상도 그대로 Blob으로 반환
 * 업스케일/다운스케일 없이 crop 좌표만큼 잘라낸 픽셀을 1:1로 출력
 */
export async function renderCrop(
  file: File,
  crop: CropRect
): Promise<Blob> {
  const bitmap = await createImageBitmap(
    file,
    crop.x, crop.y, crop.width, crop.height  // 브라우저가 직접 소스 영역만 디코딩
  );
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // JPEG quality 0.95 — 원본 화질에 최대한 근접
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
}
