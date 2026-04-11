// src/engine/phash.ts
// ─────────────────────────────────────────────────────────────────────────────
// DCT 기반 퍼셉추얼 해시(pHash) — 외부 라이브러리 없이 순수 JavaScript로 구현
//
// 퍼셉추얼 해시란?
//   사진의 시각적 특징을 64비트 숫자로 압축한 '사진의 지문'입니다.
//   - 같은 사진 or 약간 편집된 사진 → 해밍 거리 ≤10 (비슷함)
//   - 전혀 다른 사진 → 해밍 거리 >30 (다름)
//   일반 파일 해시(MD5 등)와 달리 픽셀 1개만 달라져도 완전히 달라지지 않습니다.
//
// 알고리즘 (Phash 표준):
//   1. 32×32 그레이스케일로 축소 (이미지 내용의 저주파 특징만 남김)
//   2. 8×8 DCT 변환 (밝기 패턴의 주파수 성분 추출)
//   3. DC 성분(0,0) 제외한 63개의 중앙값 계산
//   4. 각 성분이 중앙값보다 크면 '1', 작으면 '0' → 64비트 이진 문자열
//   5. 4비트씩 묶어 16진수 문자열(16자리)로 인코딩
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 이미지 데이터에서 pHash 계산
 * @param imageData 32×32 로 리사이즈된 이미지 (dedup.worker에서 전달)
 * @returns         16자리 16진수 해시 문자열 (예: "a3f8b2d1e4c7...")
 */
export function computePHash(imageData: ImageData): string {
  const SIZE = 32;     // 리샘플링 크기 (32×32)
  const DCT_SIZE = 8;  // DCT 결과 중 사용할 크기 (좌상단 8×8만 의미 있음)

  // ── 1단계: 32×32 그레이스케일 추출 ─────────────────────────────────────
  // createImageBitmap + OffscreenCanvas 로 이미 32×32로 리사이즈된 데이터를 받음
  const gray = new Float32Array(SIZE * SIZE);
  const { data, width, height } = imageData;
  const scaleX = width  / SIZE;
  const scaleY = height / SIZE;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const srcX = Math.min(Math.floor(x * scaleX), width  - 1);
      const srcY = Math.min(Math.floor(y * scaleY), height - 1);
      const idx  = (srcY * width + srcX) * 4;
      // ITU-R BT.601 가중 평균으로 그레이스케일 변환
      gray[y * SIZE + x] =
        0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // ── 2단계: 2D-DCT 변환 (좌상단 8×8 블록만 계산) ─────────────────────
  // DCT는 이미지를 코사인 파형의 합으로 분해합니다.
  // 저주파 성분(좌상단)이 이미지의 전반적인 밝기 패턴을 담고 있습니다.
  const dct = new Float32Array(DCT_SIZE * DCT_SIZE);
  for (let u = 0; u < DCT_SIZE; u++) {
    for (let v = 0; v < DCT_SIZE; v++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) {
        for (let y = 0; y < SIZE; y++) {
          sum +=
            gray[y * SIZE + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)) *  // x 방향 코사인
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * SIZE));    // y 방향 코사인
        }
      }
      // DCT 정규화 계수 (표준 2D-DCT 공식)
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[u * DCT_SIZE + v] = (cu * cv * sum * 2) / SIZE;
    }
  }

  // ── 3단계: DC 성분(인덱스 0) 제외한 63개의 중앙값 계산 ──────────────
  // DC 성분은 전체 밝기이므로 해시 비교에 노이즈가 됨 (조명 차이에 민감)
  const vals = Array.from(dct).slice(1); // 인덱스 0 제외
  vals.sort((a, b) => a - b);
  const median = vals[Math.floor(vals.length / 2)];

  // ── 4단계: 중앙값 기준 이진화 → 16진수 인코딩 ───────────────────────
  let bits = '';
  for (let i = 0; i < 64; i++) {
    bits += dct[i > 0 ? i : 1] > median ? '1' : '0';
  }

  // 4비트씩 묶어 16진수 1자리로 변환 → 총 16자리
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }

  return hex; // 예: "a3f8b2d1e4c79058"
}

/**
 * 두 pHash의 해밍 거리 계산 — 비트가 다른 개수
 *
 * 해밍 거리 해석:
 *   0~5  : 거의 동일한 사진 (JPEG 재저장 등 무손실 수준 변환)
 *   6~10 : 유사한 사진 (크기 조정, 밝기 조정 등)
 *   11~20: 약간 다름 (같은 장면 다른 각도 등)
 *   20+  : 전혀 다른 사진
 *
 * @returns 비트 차이 수 (같으면 0, 해시 길이 다르면 Infinity)
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return Infinity;
  let dist = 0;
  for (let i = 0; i < hashA.length; i++) {
    const a = parseInt(hashA[i], 16);
    const b = parseInt(hashB[i], 16);
    let xor = a ^ b; // XOR → 다른 비트만 1
    while (xor) {
      dist += xor & 1; // 최하위 비트가 1이면 카운트
      xor >>= 1;
    }
  }
  return dist;
}

/**
 * 유사 사진 클러스터링 — 비슷한 사진끼리 그룹으로 묶기
 *
 * 같은 그룹으로 묶는 조건 (둘 중 하나):
 *   ① pHash 해밍 거리 ≤ 10 (시각적으로 유사)
 *   ② EXIF 촬영 시각 차이 ≤ 30초 (연사 촬영된 사진)
 *
 * @param photos id, phash, dateTime 을 담은 사진 목록
 * @returns      groupId → id[] 맵 (각 그룹의 멤버 id 목록)
 */
export function clusterPhotos(
  photos: Array<{ id: string; phash: string; dateTime: number | null }>
): Map<string, string[]> {
  const groups  = new Map<string, string[]>(); // groupId → 멤버 id 목록
  const assigned = new Set<string>();          // 이미 그룹에 배정된 사진 id
  let groupCounter = 0;

  for (let i = 0; i < photos.length; i++) {
    if (assigned.has(photos[i].id)) continue; // 이미 배정됨 → 건너뜀

    const groupId = `group_${groupCounter++}`;
    const members = [photos[i].id];
    assigned.add(photos[i].id);

    // i 이후 사진들 중 현재 사진과 유사한 것을 같은 그룹으로 묶음
    for (let j = i + 1; j < photos.length; j++) {
      if (assigned.has(photos[j].id)) continue;

      const hashSimilar = hammingDistance(photos[i].phash, photos[j].phash) <= 10;
      const timeSimilar =
        photos[i].dateTime !== null &&
        photos[j].dateTime !== null &&
        Math.abs(photos[i].dateTime! - photos[j].dateTime!) <= 30_000; // 30초 이내

      if (hashSimilar || timeSimilar) {
        members.push(photos[j].id);
        assigned.add(photos[j].id);
      }
    }

    groups.set(groupId, members);
  }

  return groups;
}
