// src/utils/exif.ts
// ─────────────────────────────────────────────────────────────────────────────
// EXIF 메타데이터 파싱 — exifr 라이브러리 래퍼
//
// EXIF(Exchangeable Image File Format)란?
//   디지털 카메라/스마트폰이 사진 파일에 기록하는 촬영 정보입니다.
//   PhotoPick AI에서는 주로 촬영 시각을 연사 사진 중복 제거에 활용합니다.
//
// orientation 파싱은 imageLoader.ts에서 별도로 처리합니다.
// ─────────────────────────────────────────────────────────────────────────────

import exifr from 'exifr';
import type { ExifData } from '../types';

/**
 * 이미지 파일에서 주요 EXIF 메타데이터를 파싱합니다
 *
 * 파싱 항목:
 *   - DateTimeOriginal: 실제 촬영 시각 (중복 제거 시간 비교용)
 *   - Make + Model:     카메라 제조사 및 모델명
 *   - FocalLength:      초점 거리 (mm)
 *   - ISO:              촬영 감도
 *   - GPSLatitude/Longitude: 촬영 위치
 *
 * @param file  EXIF를 파싱할 이미지 파일
 * @returns     파싱된 ExifData, EXIF 없거나 실패 시 null
 */
export async function parseExif(file: File): Promise<ExifData | null> {
  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'Make', 'Model', 'FocalLength', 'ISO', 'GPSLatitude', 'GPSLongitude'],
    });
    if (!data) return null;

    return {
      dateTime:    data.DateTimeOriginal ? new Date(data.DateTimeOriginal) : null,
      camera:      [data.Make, data.Model].filter(Boolean).join(' '), // "Apple iPhone 15 Pro"
      focalLength: data.FocalLength  ?? null,
      iso:         data.ISO          ?? null,
      gps:         data.GPSLatitude && data.GPSLongitude
                     ? { lat: data.GPSLatitude, lng: data.GPSLongitude }
                     : null,
    };
  } catch {
    // PNG, WebP 등 EXIF가 없는 포맷이나 파싱 오류 시 null 반환
    return null;
  }
}
