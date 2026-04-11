// src/workers/filter.worker.ts
// ─────────────────────────────────────────────────────────────────────────────
// 1차 필터 Worker: 블러·노출·인물 여부를 빠르게 스크리닝
//
// 목적: 명백히 불량한 사진(심각한 흔들림, 완전 화이트아웃/블랙아웃, 인물 전혀 없음)을
//       걸러내어 뒤 단계의 연산량을 줄입니다.
//
// ★ 통과율 목표: 전체 업로드 사진의 약 30%
//   임계값을 넉넉하게 설정해 경계선상의 사진을 최대한 통과시킵니다.
//   세밀한 품질 평가는 3차 정밀 분석(analyze.worker)에서 수행합니다.
//
// 완화된 임계값:
//   블러: Laplacian 분산 ≥ 20 (이전: 50)
//   노출: overexposed > 35%, underexposed > 25% (이전: 22%, 10%)
//   밝기: 20~245 (이전: 40~230)
//   인물: 피부색 비율 ≥ 1% (이전: 5%)
//
// 처리 해상도: 320×240 (작게 줄여 속도 우선 — 정확도보다 처리 속도가 중요)
// ─────────────────────────────────────────────────────────────────────────────

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';
import { computeLaplacianVariance } from '../engine/blur';
import { exposureScore } from '../engine/exposure';
import type { FilterResult, FilterWorkerInput } from '../types';

self.onmessage = async (e: MessageEvent<FilterWorkerInput>) => {
  const { fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    // ── 전처리: 320×240 으로 리사이즈 (EXIF 회전 보정 포함) ──────────────
    const { imageData } = await loadAndResize(file, 320, 240);
    const gray = toGrayscale(imageData);
    const histogram = computeHistogram(gray);
    const totalPixels = gray.length;

    // ── 1. 블러 감지 (Laplacian 분산) ────────────────────────────────────
    // 기준 완화: 분산 ≥ 20 통과 (이전: 50)
    // 살짝 흔들린 사진도 전신 구도 평가 대상으로 포함합니다.
    // 심각한 블러(손 크게 흔듦, 극도의 노이즈)만 탈락합니다.
    const sharpness = computeLaplacianVariance(gray, imageData.width, imageData.height);

    // ── 2. 노출 분석 ──────────────────────────────────────────────────────
    // exposure.ts의 완화된 임계값 사용:
    //   isOverexposed: brightRatio > 0.35 (밝은 픽셀 35% 초과 = 완전 화이트아웃)
    //   isUnderexposed: darkRatio > 0.25  (어두운 픽셀 25% 초과 = 완전 블랙아웃)
    const { brightness, isOverexposed, isUnderexposed } = exposureScore(histogram, totalPixels);

    // ── 3. 피부색 간이 판정 (인물 유무 확인) ─────────────────────────────
    // 기준 완화: 피부색 비율 ≥ 1% 통과 (이전: 5%)
    // 전신 사진은 얼굴 면적이 작아 5% 기준에서 탈락하는 경우가 많았습니다.
    // 피부 조건도 완화: Blue 채널 상한을 제거하고 R > G + 10만 확인
    const { data } = imageData;
    let skinPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (
        r > 70 && g > 30 && b > 15 && // 최소 밝기 조건 완화
        r > g && r > b &&              // 빨간 채널 지배
        r - g > 10                     // 최소 색조 차이 (이전: 15)
      ) {
        skinPixels++;
      }
    }
    // 전신 사진 허용: 1%만 피부색이어도 인물 있다고 판정 (이전: 5%)
    const skinRatio = skinPixels / totalPixels;

    // ── 통과/탈락 판정 ────────────────────────────────────────────────────
    const blurOk     = sharpness >= 20;             // 완전 흔들림만 탈락
    const exposureOk = !isOverexposed && !isUnderexposed
                       && brightness >= 20 && brightness <= 245; // 극단 범위만 탈락
    const faceOk     = skinRatio >= 0.01;           // 1% 이상 피부색 = 인물 있음

    const passed = blurOk && exposureOk && faceOk;

    // 탈락 원인 문자열 (UI 및 디버그 용도)
    let rejectReason: string | undefined;
    if (!blurOk)          rejectReason = '심각한 흔들림 (블러)';
    else if (isOverexposed)    rejectReason = '완전 화이트아웃';
    else if (isUnderexposed)   rejectReason = '완전 블랙아웃';
    else if (brightness < 20)  rejectReason = '이미지가 너무 어두움';
    else if (brightness > 245) rejectReason = '이미지가 너무 밝음';
    else if (!faceOk)     rejectReason = '인물 없음';

    const result: FilterResult = {
      passed,
      sharpness,
      brightness,
      hasFace: faceOk,
      faceSize: skinRatio,
      rejectReason,
    };

    self.postMessage(result);

  } catch {
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
