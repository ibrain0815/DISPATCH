// src/engine/phash.ts
// DCT 기반 64비트 퍼셉추얼 해시 (외부 라이브러리 없이 직접 구현)

/**
 * pHash 계산 과정:
 * 1. 32×32 그레이스케일로 리사이즈
 * 2. 8×8 DCT 변환 (저주파 성분만)
 * 3. 중앙값 기준으로 64비트 이진화
 * 4. 16진수 문자열로 인코딩
 */
export function computePHash(imageData: ImageData): string {
  const SIZE = 32;
  const DCT_SIZE = 8;

  // 1. 32×32 그레이스케일 추출 (OffscreenCanvas 리사이즈 후 받은 데이터)
  const gray = new Float32Array(SIZE * SIZE);
  const { data, width, height } = imageData;
  const scaleX = width / SIZE;
  const scaleY = height / SIZE;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), width - 1);
      const srcY = Math.min(Math.floor(y * scaleY), height - 1);
      const idx = (srcY * width + srcX) * 4;
      gray[y * SIZE + x] =
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // 2. 2D-DCT (좌상단 8×8만 사용)
  const dct = new Float32Array(DCT_SIZE * DCT_SIZE);
  for (let u = 0; u < DCT_SIZE; u++) {
    for (let v = 0; v < DCT_SIZE; v++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) {
        for (let y = 0; y < SIZE; y++) {
          sum +=
            gray[y * SIZE + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * SIZE));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[u * DCT_SIZE + v] = (cu * cv * sum * 2) / SIZE;
    }
  }

  // 3. DC 성분(0,0) 제외한 63개의 중앙값
  const vals = Array.from(dct).slice(1); // DC 제외
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];

  // 4. 이진화 → 16진수 문자열 (16자리)
  let bits = '';
  for (let i = 0; i < 64; i++) {
    bits += dct[i > 0 ? i : 1] > median ? '1' : '0';
  }

  // 4비트씩 묶어서 16진수
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hex; // 16자리 hex 문자열
}

/** 해밍 거리 계산 — 두 해시의 비트 차이 수
 *  거리 ≤ 10 이면 유사 사진으로 판정 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const a = parseInt(hashA[i], 16);
    const b = parseInt(hashB[i], 16);
    let xor = a ^ b;
    while (xor) {
      dist += xor & 1;
      xor >>= 1;
    }
  }
  return dist;
}

/** 유사 사진 클러스터링
 *  임계값: 해밍 거리 ≤ 10 OR EXIF 시간차 ≤ 30초 */
export function clusterPhotos(
  photos: Array<{ id: string; phash: string; dateTime: number | null }>
): Map<string, string[]> { // groupId → id[]
  const groups = new Map<string, string[]>();
  const assigned = new Set<string>();
  let groupCounter = 0;

  for (let i = 0; i < photos.length; i++) {
    if (assigned.has(photos[i].id)) continue;

    const groupId = `group_${groupCounter++}`;
    const members = [photos[i].id];
    assigned.add(photos[i].id);

    for (let j = i + 1; j < photos.length; j++) {
      if (assigned.has(photos[j].id)) continue;

      const hashSimilar = hammingDistance(photos[i].phash, photos[j].phash) <= 10;
      const timeSimilar =
        photos[i].dateTime !== null &&
        photos[j].dateTime !== null &&
        Math.abs(photos[i].dateTime - photos[j].dateTime) <= 30_000;

      if (hashSimilar || timeSimilar) {
        members.push(photos[j].id);
        assigned.add(photos[j].id);
      }
    }

    groups.set(groupId, members);
  }

  return groups;
}
