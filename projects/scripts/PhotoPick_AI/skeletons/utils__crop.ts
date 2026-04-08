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
  faceData: FaceData,
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

  // 얼굴 중심을 크롭 영역 중앙으로 (4:5에서는 얼굴을 약간 위쪽에 배치)
  const faceCenterX = faceData.centerX;
  const faceCenterY = faceData.centerY;

  // 4:5 비율에서는 얼굴을 40% 위치(황금분할)에 배치
  const verticalOffset = ratio === '4:5' ? cropH * 0.1 : 0;

  let x = Math.round(faceCenterX - cropW / 2);
  let y = Math.round(faceCenterY - cropH * 0.4 - verticalOffset);

  // 경계 클램핑
  x = Math.max(0, Math.min(x, imageWidth - cropW));
  y = Math.max(0, Math.min(y, imageHeight - cropH));

  return { x, y, width: cropW, height: cropH };
}

/**
 * 크롭 영역을 Canvas에 렌더링하여 Blob 반환
 */
export async function renderCrop(
  file: File,
  crop: CropRect,
  outputSize: { width: number; height: number } = { width: 1080, height: 1350 }
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(outputSize.width, outputSize.height);
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(
    bitmap,
    crop.x, crop.y, crop.width, crop.height,  // 소스 영역
    0, 0, outputSize.width, outputSize.height   // 대상 영역
  );
  bitmap.close();

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}
