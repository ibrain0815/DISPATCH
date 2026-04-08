// src/workers/dedup.worker.ts
// 2차 중복 제거 Worker: pHash 계산 (클러스터링은 메인 스레드에서)

import { loadAndResize } from '../utils/imageLoader';
import { computePHash } from '../engine/phash';
import type { DedupWorkerInput, DedupWorkerOutput } from '../types';

self.onmessage = async (e: MessageEvent<DedupWorkerInput>) => {
  const { id, fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    // 32×32로 리사이즈 (pHash는 저해상도로 충분)
    const { imageData } = await loadAndResize(file, 32, 32);
    const phash = computePHash(imageData);

    const result: DedupWorkerOutput = { id, phash };
    self.postMessage(result);
  } catch {
    // 해시 실패 시 고유 해시 반환 (중복으로 처리되지 않도록)
    const result: DedupWorkerOutput = { id, phash: crypto.randomUUID().replace(/-/g, '') };
    self.postMessage(result);
  }
};
