// src/utils/zip.ts
// fflate 기반 선택 사진 ZIP 다운로드

import { zip } from 'fflate';
import type { PhotoData, AspectRatio } from '../types';
import { calcSmartCrop, renderCrop } from './crop';

/**
 * 선택된 사진들을 크롭 후 ZIP으로 다운로드
 * @param photos    다운로드할 사진 목록
 * @param ratio     인스타 크롭 비율
 * @param onProgress 진행률 콜백 (0~100)
 */
export async function downloadAsZip(
  photos: PhotoData[],
  ratio: AspectRatio,
  onProgress?: (percent: number) => void
): Promise<void> {
  const files: Record<string, Uint8Array> = {};
  let done = 0;

  const RATIO_SIZE: Record<AspectRatio, { width: number; height: number }> = {
    '1:1': { width: 1080, height: 1080 },
    '4:5': { width: 1080, height: 1350 },
    '1.91:1': { width: 1080, height: 566 },
    '9:16': { width: 1080, height: 1920 },
  };

  for (const photo of photos) {
    try {
      const bitmap = await createImageBitmap(photo.file);
      const origW = bitmap.width;
      const origH = bitmap.height;
      bitmap.close();

      const faceData = photo.analysis?.faceData ?? {
        centerX: origW / 2, centerY: origH * 0.4,
        width: origW * 0.3, height: origH * 0.4,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 50,
      };

      const crop = calcSmartCrop(origW, origH, faceData, ratio);
      const blob = await renderCrop(photo.file, crop, RATIO_SIZE[ratio]);
      const buffer = await blob.arrayBuffer();
      const baseName = photo.fileName.replace(/\.[^.]+$/, '');
      files[`photopick_${baseName}_${ratio.replace(':', 'x')}.jpg`] = new Uint8Array(buffer);
    } catch {
      // 개별 파일 실패는 건너뜀
    }

    done++;
    onProgress?.(Math.round((done / photos.length) * 100));
  }

  // ZIP 압축
  await new Promise<void>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => {
      if (err) { reject(err); return; }

      const blob = new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photopick_${ratio.replace(':', 'x')}_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      resolve();
    });
  });
}
