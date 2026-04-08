// src/components/CropPreview.tsx
// 인스타 비율별 크롭 미리보기 + 다운로드

import { useState, useEffect, useRef } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import { calcSmartCrop } from '../utils/crop';
import { downloadAsZip } from '../utils/zip';
import type { AspectRatio } from '../types';

const RATIOS: AspectRatio[] = ['4:5', '1:1', '1.91:1', '9:16'];
const RATIO_LABELS: Record<AspectRatio, string> = {
  '4:5': '인스타 세로 (4:5)',
  '1:1': '정사각형 (1:1)',
  '1.91:1': '인스타 가로 (1.91:1)',
  '9:16': '릴스 (9:16)',
};

export function CropPreview() {
  const { selectedIds, photos, cropRatio, setCropRatio, stage } = usePhotoStore((s) => ({
    selectedIds: s.selectedIds,
    photos: s.photos,
    cropRatio: s.cropRatio,
    setCropRatio: s.setCropRatio,
    stage: s.stage,
  }));

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 첫 번째 선택 사진 미리보기
  const previewPhoto = selectedIds.size > 0
    ? photos.get(Array.from(selectedIds)[0])
    : null;

  useEffect(() => {
    if (!previewPhoto || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = previewPhoto.thumbnailUrl;

    img.onload = () => {
      // 크롭 영역 계산 (썸네일 기준)
      const faceData = previewPhoto.analysis?.faceData;
      if (!faceData) return;

      // 썸네일에서 crop 비율만 시각화
      const RATIO_MAP: Record<AspectRatio, number> = {
        '1:1': 1, '4:5': 4 / 5, '1.91:1': 1.91, '9:16': 9 / 16,
      };
      const targetRatio = RATIO_MAP[cropRatio];
      const tw = 200, th = 200; // 썸네일 크기

      let cw: number, ch: number;
      if (targetRatio > 1) { cw = tw; ch = Math.round(tw / targetRatio); }
      else { ch = th; cw = Math.round(ch * targetRatio); }

      canvas.width = tw;
      canvas.height = th;
      ctx.drawImage(img, 0, 0, tw, th);

      // 크롭 오버레이
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      const x = Math.round((tw - cw) / 2);
      const y = Math.round((th - ch) / 2);
      ctx.fillRect(0, 0, tw, th);
      ctx.clearRect(x, y, cw, ch);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, cw, ch);
    };
  }, [previewPhoto, cropRatio]);

  const handleDownload = async () => {
    if (selectedIds.size === 0) return;
    const selected = Array.from(selectedIds)
      .map((id) => photos.get(id)!)
      .filter(Boolean);

    setDownloading(true);
    setDownloadProgress(0);
    await downloadAsZip(selected, cropRatio, setDownloadProgress);
    setDownloading(false);
  };

  if (stage !== 'done') return null;

  return (
    <div className="sticky bottom-0 bg-white border-t shadow-lg p-4">
      <div className="max-w-4xl mx-auto flex flex-wrap gap-4 items-center">
        {/* 비율 선택 */}
        <div className="flex gap-2 flex-wrap">
          {RATIOS.map((r) => (
            <button
              key={r}
              onClick={() => setCropRatio(r)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors
                ${cropRatio === r
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
                }`}
            >
              {RATIO_LABELS[r]}
            </button>
          ))}
        </div>

        {/* 미리보기 캔버스 */}
        {previewPhoto && (
          <canvas
            ref={canvasRef}
            className="w-20 h-20 rounded object-cover border"
          />
        )}

        {/* 다운로드 버튼 */}
        <button
          onClick={handleDownload}
          disabled={selectedIds.size === 0 || downloading}
          className="ml-auto px-6 py-2 bg-blue-600 text-white rounded-xl font-medium
                     hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors min-w-[140px]"
        >
          {downloading
            ? `다운로드 중... ${downloadProgress}%`
            : `ZIP 다운로드 (${selectedIds.size}장)`}
        </button>
      </div>
    </div>
  );
}
