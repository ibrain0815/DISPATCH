// src/utils/zip.ts
// ─────────────────────────────────────────────────────────────────────────────
// 선택된 사진들을 인스타 비율로 크롭 후 ZIP 파일로 다운로드합니다
//
// 처리 흐름:
//   1. 각 사진의 원본 파일에서 가로·세로 크기 조회
//   2. faceData 좌표를 640px 분석 공간 → 원본 해상도로 스케일 변환
//   3. calcSmartCrop으로 크롭 영역 계산
//   4. renderCrop으로 원본 해상도 그대로 크롭 (다운스케일 없음)
//   5. fflate 라이브러리로 ZIP 압축 (level: 0 = 무압축, JPEG는 이미 압축됨)
//   6. <a> 태그 클릭으로 자동 다운로드
// ─────────────────────────────────────────────────────────────────────────────

import { zip } from 'fflate';
import type { PhotoData, AspectRatio } from '../types';
import { calcSmartCrop, renderCrop } from './crop';

/**
 * 선택된 사진들을 크롭 후 ZIP으로 묶어 브라우저 다운로드를 시작합니다
 *
 * @param photos      다운로드할 PhotoData 배열 (선택된 사진들)
 * @param ratio       인스타그램 크롭 비율 (4:5 / 1:1 / 1.91:1 / 9:16)
 * @param onProgress  진행률 콜백 (0~100 정수) — 다운로드 UI 프로그레스바에 사용
 */
export async function downloadAsZip(
  photos: PhotoData[],
  ratio: AspectRatio,
  onProgress?: (percent: number) => void
): Promise<void> {
  // ZIP에 담을 파일 맵 (파일명 → Uint8Array 바이트 데이터)
  const files: Record<string, Uint8Array> = {};
  let done = 0;

  for (const photo of photos) {
    try {
      // ── 원본 이미지 크기 조회 ────────────────────────────────────────────
      // File 전체를 디코딩하지 않고 비트맵 헤더만 읽어 너비·높이 파악
      const bitmap = await createImageBitmap(photo.file);
      const origW  = bitmap.width;
      const origH  = bitmap.height;
      bitmap.close();

      // ── faceData 좌표 스케일 변환 ─────────────────────────────────────────
      // analyze.worker는 640px 리사이즈 기준으로 얼굴 좌표를 계산했습니다.
      // 원본 해상도 크롭에 사용하려면 원본 스케일로 변환해야 합니다.
      const faceData = photo.analysis?.faceData ?? {
        // 분석 결과가 없으면 이미지 중앙 상단을 기본 얼굴 위치로 사용
        centerX: origW / 2,     centerY: origH * 0.4,
        width:   origW * 0.3,   height:  origH * 0.4,
        yaw: 0, pitch: 0, eyeAspectRatio: 0.3, smileScore: 50,
      };

      // 640px 공간 → 원본 해상도로 선형 스케일
      const scale = origW / 640;
      const scaledFace = {
        ...faceData,
        centerX: faceData.centerX * scale,
        centerY: faceData.centerY * scale,
        width:   faceData.width   * scale,
        height:  faceData.height  * scale,
      };

      // ── 크롭 영역 계산 + 원본 해상도 크롭 ───────────────────────────────
      const crop = calcSmartCrop(origW, origH, scaledFace, ratio);
      // renderCrop: createImageBitmap(file, x, y, w, h)로 원본 픽셀 그대로 크롭
      const blob   = await renderCrop(photo.file, crop);
      const buffer = await blob.arrayBuffer();

      // 파일명: photopick_원본파일명_비율.jpg (콜론을 x로 치환)
      const baseName = photo.fileName.replace(/\.[^.]+$/, ''); // 확장자 제거
      files[`photopick_${baseName}_${ratio.replace(':', 'x')}.jpg`] = new Uint8Array(buffer);

    } catch {
      // 개별 파일 처리 실패는 건너뛰고 계속 진행 (전체 다운로드 중단 방지)
    }

    done++;
    onProgress?.(Math.round((done / photos.length) * 100)); // 진행률 업데이트
  }

  // ── fflate로 ZIP 압축 후 다운로드 트리거 ─────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    zip(
      files,
      { level: 0 }, // level: 0 = 무압축 (JPEG는 이미 압축되어 있어 추가 압축 효과 없음)
      (err, data) => {
        if (err) { reject(err); return; }

        // Blob → Object URL → <a> 자동 클릭 → 다운로드 시작
        const blob = new Blob([data.buffer as ArrayBuffer], { type: 'application/zip' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        // 다운로드 파일명: photopick_비율_날짜.zip
        a.download = `photopick_${ratio.replace(':', 'x')}_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url); // Object URL 즉시 해제 (메모리 누수 방지)
        resolve();
      }
    );
  });
}
