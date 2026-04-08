// src/utils/imageLoader.ts
// 이미지 로드/리사이즈 유틸 — OffscreenCanvas 기반 (Worker에서도 동작)

/** File → 지정 크기 ImageData (비율 유지) */
export async function loadAndResize(
  file: File,
  maxWidth: number,
  maxHeight: number
): Promise<{ imageData: ImageData; originalWidth: number; originalHeight: number }> {
  const bitmap = await createImageBitmap(file);
  const { width: ow, height: oh } = bitmap;

  const scale = Math.min(maxWidth / ow, maxHeight / oh, 1);
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close(); // 메모리 해제

  return { imageData: ctx.getImageData(0, 0, w, h), originalWidth: ow, originalHeight: oh };
}

/** RGBA ImageData → Float32Array 그레이스케일 (0~255) */
export function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

/** 그레이스케일 → 256단계 히스토그램 */
export function computeHistogram(gray: Float32Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.round(gray[i]))]++;
  }
  return hist;
}

/** 썸네일 생성 (200×200, Object URL 반환) */
export async function createThumbnail(file: File, size = 200): Promise<string> {
  const bitmap = await createImageBitmap(file, { resizeWidth: size, resizeHeight: size, resizeQuality: 'medium' });
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;

  // 중앙 크롭
  const minDim = Math.min(bitmap.width, bitmap.height);
  const offsetX = (bitmap.width - minDim) / 2;
  const offsetY = (bitmap.height - minDim) / 2;
  ctx.drawImage(bitmap, offsetX, offsetY, minDim, minDim, 0, 0, size, size);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return URL.createObjectURL(blob);
}
