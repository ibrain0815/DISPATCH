// src/utils/imageLoader.ts
// ─────────────────────────────────────────────────────────────────────────────
// 이미지 로드·리사이즈 유틸 — OffscreenCanvas 기반으로 Web Worker 내에서도 동작합니다
//
// EXIF 회전 보정:
//   스마트폰으로 세로 촬영한 사진은 실제 픽셀이 가로(landscape)로 저장되고,
//   EXIF orientation 태그에 "90° 회전해서 보여줘"라고 기록되어 있습니다.
//   브라우저의 createImageBitmap()은 이 EXIF 태그를 무시하므로
//   수동으로 회전 변환을 적용해야 합니다.
//
//   EXIF orientation 값:
//     1 = 정상 (회전 없음)
//     3 = 180° 회전
//     6 = 90° 시계 방향 회전 (세로 촬영 대부분)
//     8 = 270° 시계 방향 회전 (= 90° 반시계)
//     2,4,5,7 = 좌우/상하 반전 포함 (희귀)
// ─────────────────────────────────────────────────────────────────────────────

import exifr from 'exifr';

/** EXIF Orientation 값 읽기
 *  exifr 라이브러리로 파일 헤더만 파싱 (전체 디코딩 불필요 → 빠름)
 *  파싱 실패 시 1(정상) 반환 */
async function readOrientation(file: File): Promise<number> {
  try {
    const data = await exifr.parse(file, { pick: ['Orientation'] });
    return data?.Orientation ?? 1;
  } catch {
    return 1; // EXIF 없는 파일(PNG, WebP 등)은 회전 없음으로 처리
  }
}

/**
 * orientation 값에 따라 OffscreenCanvas에 회전/반전 변환을 적용하고 이미지를 그립니다
 *
 * 캔버스 크기는 이미 올바른 방향의 (tw × th) 으로 생성되어 있어야 합니다.
 * orientation 5-8은 가로/세로가 뒤바뀌어 있으므로 drawImage 인자도 (th, tw) 순서로 넣습니다.
 *
 * @param ctx         대상 캔버스 컨텍스트 (이미 올바른 크기로 생성됨)
 * @param bitmap      원본 이미지 비트맵 (회전 전 픽셀)
 * @param orientation EXIF orientation 값 (1~8)
 * @param tw          대상 캔버스 너비 (보정 후 기준)
 * @param th          대상 캔버스 높이 (보정 후 기준)
 */
function drawWithOrientation(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  orientation: number,
  tw: number,
  th: number,
) {
  switch (orientation) {
    case 2: // 좌우 반전 (수평 미러)
      ctx.translate(tw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(bitmap, 0, 0, tw, th);
      break;

    case 3: // 180° 회전 (뒤집어 찍힌 사진)
      ctx.translate(tw, th);
      ctx.rotate(Math.PI);
      ctx.drawImage(bitmap, 0, 0, tw, th);
      break;

    case 4: // 상하 반전 (수직 미러)
      ctx.translate(0, th);
      ctx.scale(1, -1);
      ctx.drawImage(bitmap, 0, 0, tw, th);
      break;

    case 5: // 90° CCW + 좌우 반전 (희귀) → CCW 로 근사 처리
    case 8: // 270° CW = 90° CCW (일부 카메라의 세로 촬영)
      ctx.translate(0, th);
      ctx.rotate(-Math.PI / 2);
      // swapped: 원본의 가로(bh)가 보정 후 세로(th)가 됨 → (th, tw) 순서로 그리기
      ctx.drawImage(bitmap, 0, 0, th, tw);
      break;

    case 6: // 90° CW (대부분의 스마트폰 세로 촬영)
      ctx.translate(tw, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0, th, tw); // swapped
      break;

    case 7: // 90° CW + 좌우 반전 (희귀) → CW 로 근사 처리
      ctx.translate(tw, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(bitmap, 0, 0, th, tw); // swapped
      break;

    default: // orientation 1 (정상) — 변환 없이 그대로 그림
      ctx.drawImage(bitmap, 0, 0, tw, th);
  }
}

/**
 * File → 지정 크기 ImageData 변환 (비율 유지, EXIF 회전 보정 포함)
 *
 * 사용 위치: filter.worker(320×240), dedup.worker(32×32), analyze.worker(640×640)
 *
 * @param file      원본 이미지 파일
 * @param maxWidth  출력 최대 너비 (px)
 * @param maxHeight 출력 최대 높이 (px)
 * @returns         imageData(보정된 이미지), originalWidth/Height(보정 후 원본 크기)
 */
export async function loadAndResize(
  file: File,
  maxWidth: number,
  maxHeight: number
): Promise<{ imageData: ImageData; originalWidth: number; originalHeight: number }> {
  // 비트맵 디코딩 + EXIF 방향 읽기를 병렬로 실행 (속도 최적화)
  const [bitmap, orientation] = await Promise.all([
    createImageBitmap(file),
    readOrientation(file),
  ]);

  const bw = bitmap.width;   // 원본 픽셀 너비 (회전 전)
  const bh = bitmap.height;  // 원본 픽셀 높이 (회전 전)

  // orientation 5~8은 가로/세로가 뒤바뀜
  // 예: 세로로 찍힌 사진 → 픽셀은 6000×4000(landscape), 실제 표시는 4000×6000(portrait)
  const swapped = orientation >= 5;
  const ow = swapped ? bh : bw; // 보정 후 실제 너비
  const oh = swapped ? bw : bh; // 보정 후 실제 높이

  // 비율 유지하며 maxWidth × maxHeight 내에 맞게 축소
  const scale = Math.min(maxWidth / ow, maxHeight / oh, 1);
  const tw = Math.round(ow * scale); // 출력 너비
  const th = Math.round(oh * scale); // 출력 높이

  const canvas = new OffscreenCanvas(tw, th);
  const ctx = canvas.getContext('2d')!;
  drawWithOrientation(ctx, bitmap, orientation, tw, th);
  bitmap.close(); // ImageBitmap 메모리 즉시 해제

  return { imageData: ctx.getImageData(0, 0, tw, th), originalWidth: ow, originalHeight: oh };
}

/**
 * RGBA ImageData → Float32Array 그레이스케일 변환 (0~255 범위)
 *
 * ITU-R BT.601 가중 평균:  Y = 0.299R + 0.587G + 0.114B
 * 이 가중치는 인간의 눈이 초록색에 가장 민감하다는 특성을 반영합니다.
 */
export function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

/**
 * 그레이스케일 배열 → 256단계 밝기 히스토그램 생성
 *
 * 히스토그램[i] = 밝기가 i인 픽셀 수
 * 노출 분석, 조명 점수, 1차 필터 등 다수의 엔진에서 공통으로 사용합니다.
 */
export function computeHistogram(gray: Float32Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, Math.round(gray[i]))]++;
  }
  return hist;
}

/**
 * 사진 파일 → 정사각형 썸네일 Object URL 생성 (EXIF 회전 보정 포함)
 *
 * 처리 과정:
 *   1. EXIF 회전 보정 적용
 *   2. 짧은 변 기준으로 size×size 보다 약간 크게 축소
 *   3. 중앙 크롭 → 정확히 size×size 출력
 *
 * @param file 원본 이미지 파일
 * @param size 썸네일 한 변 크기 (기본값: 200px)
 * @returns    Object URL (사용 후 URL.revokeObjectURL 호출 권장)
 */
export async function createThumbnail(file: File, size = 200): Promise<string> {
  const [bitmap, orientation] = await Promise.all([
    createImageBitmap(file),
    readOrientation(file),
  ]);

  const bw = bitmap.width;
  const bh = bitmap.height;
  const swapped = orientation >= 5;
  const ow = swapped ? bh : bw; // 보정 후 실제 너비
  const oh = swapped ? bw : bh; // 보정 후 실제 높이

  // 짧은 변이 size 이상이 되도록 축소 비율 계산
  const minDim = Math.min(ow, oh);
  const scale  = size / minDim;
  const sw = Math.round(ow * scale); // 축소 후 너비
  const sh = Math.round(oh * scale); // 축소 후 높이

  // 회전 보정 적용 후 중간 캔버스에 그리기
  const tmp  = new OffscreenCanvas(sw, sh);
  const tctx = tmp.getContext('2d')!;
  drawWithOrientation(tctx, bitmap, orientation, sw, sh);
  bitmap.close();

  // 정중앙 크롭 → size×size 정사각형
  const canvas = new OffscreenCanvas(size, size);
  const ctx    = canvas.getContext('2d')!;
  const offsetX = (sw - size) / 2;
  const offsetY = (sh - size) / 2;
  ctx.drawImage(tmp, offsetX, offsetY, size, size, 0, 0, size, size);

  // JPEG 70% 압축 → Object URL 반환
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return URL.createObjectURL(blob);
}
