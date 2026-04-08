// src/utils/exif.ts
import exifr from 'exifr';
import type { ExifData } from '../types';

export async function parseExif(file: File): Promise<ExifData | null> {
  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'Make', 'Model', 'FocalLength', 'ISO', 'GPSLatitude', 'GPSLongitude'],
    });
    if (!data) return null;

    return {
      dateTime: data.DateTimeOriginal ? new Date(data.DateTimeOriginal) : null,
      camera: [data.Make, data.Model].filter(Boolean).join(' '),
      focalLength: data.FocalLength ?? null,
      iso: data.ISO ?? null,
      gps: data.GPSLatitude && data.GPSLongitude
        ? { lat: data.GPSLatitude, lng: data.GPSLongitude }
        : null,
    };
  } catch {
    return null;
  }
}
