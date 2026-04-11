// src/workers/dedup.worker.ts
// ─────────────────────────────────────────────────────────────────────────────
// 2차 중복 제거 Worker: 사진별 퍼셉추얼 해시(pHash) 계산
//
// pHash란? 사진의 시각적 특징을 64비트 숫자로 압축한 것입니다.
//   - 같은 사진이나 비슷한 사진 → 해밍 거리(비트 차이) ≤ 10
//   - 전혀 다른 사진 → 해밍 거리 > 10
//
// 클러스터링(유사 사진 그룹화)은 메인 스레드(pipeline.ts)에서 수행합니다.
// 이 Worker는 해시 계산만 담당합니다.
// ─────────────────────────────────────────────────────────────────────────────

import { loadAndResize } from '../utils/imageLoader';
import { computePHash } from '../engine/phash';
import type { DedupWorkerInput, DedupWorkerOutput } from '../types';

self.onmessage = async (e: MessageEvent<DedupWorkerInput>) => {
  const { id, fileBuffer, fileName } = e.data;

  // ArrayBuffer → File 객체 변환
  const file = new File([fileBuffer], fileName);

  try {
    // pHash는 32×32 저해상도로도 충분한 정확도를 냄
    // EXIF 회전 보정을 포함해 리사이즈
    const { imageData } = await loadAndResize(file, 32, 32);

    // DCT 기반 64비트 퍼셉추얼 해시 계산 → 16진수 16자리 문자열
    const phash = computePHash(imageData);

    const result: DedupWorkerOutput = { id, phash };
    self.postMessage(result);

  } catch {
    // 해시 계산 실패 시 랜덤 UUID 반환
    // → 해밍 거리가 항상 크게 나와 다른 사진과 중복으로 묶이지 않음
    const result: DedupWorkerOutput = {
      id,
      phash: crypto.randomUUID().replace(/-/g, ''),
    };
    self.postMessage(result);
  }
};
