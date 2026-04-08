// src/workers/filter.worker.ts
// 1차 필터 Worker: 블러 / 노출 / 피부색 빠른 스크리닝 (320×240 저해상도)

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';
import { computeLaplacianVariance } from '../engine/blur';
import { exposureScore } from '../engine/exposure';
import type { FilterResult, FilterWorkerInput } from '../types';

self.onmessage = async (e: MessageEvent<FilterWorkerInput>) => {
  const { fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    // 320×240으로 리사이즈 (빠른 처리 우선)
    const { imageData } = await loadAndResize(file, 320, 240);
    const gray = toGrayscale(imageData);
    const histogram = computeHistogram(gray);
    const totalPixels = gray.length;

    // 1. 블러 감지
    const sharpness = computeLaplacianVariance(gray, imageData.width, imageData.height);

    // 2. 노출 분석
    const { brightness, isOverexposed, isUnderexposed } = exposureScore(histogram, totalPixels);

    // 3. 피부색 간이 판정 (얼굴 있는지 확인)
    const { data } = imageData;
    let skinPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (
        r > 95 && g > 40 && b > 20 &&
        r > g && r > b &&
        Math.abs(r - g) > 15 && r - b > 15
      ) {
        skinPixels++;
      }
    }
    const skinRatio = skinPixels / totalPixels;

    // 합격 판정
    const blurOk = sharpness >= 50;
    const exposureOk = !isOverexposed && !isUnderexposed && brightness >= 40 && brightness <= 230;
    const faceOk = skinRatio > 0.05;
    const passed = blurOk && exposureOk && faceOk;

    let rejectReason: string | undefined;
    if (!blurOk) rejectReason = '흔들린 사진 (블러)';
    else if (isOverexposed) rejectReason = '너무 밝음 (화이트아웃)';
    else if (isUnderexposed) rejectReason = '너무 어두움';
    else if (!faceOk) rejectReason = '인물 없음';

    const result: FilterResult = {
      passed,
      sharpness,
      brightness,
      hasFace: faceOk,
      faceSize: skinRatio,
      rejectReason,
    };

    self.postMessage(result);
  } catch (err) {
    const fallback: FilterResult = {
      passed: false,
      sharpness: 0,
      brightness: 0,
      hasFace: false,
      faceSize: 0,
      rejectReason: '파일 읽기 실패',
    };
    self.postMessage(fallback);
  }
};
