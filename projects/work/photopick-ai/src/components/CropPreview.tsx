// src/components/CropPreview.tsx
// 인스타 비율별 크롭 미리보기 + 다운로드

import { useState, useEffect, useRef } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import { downloadAsZip } from '../utils/zip';
import type { AspectRatio } from '../types';

const RATIOS: AspectRatio[] = ['4:5', '1:1', '1.91:1', '9:16'];
const RATIO_LABELS: Record<AspectRatio, string> = {
  '4:5': '세로 4:5',
  '1:1': '정사각형',
  '1.91:1': '가로 1.91:1',
  '9:16': '릴스 9:16',
};
const RATIO_VALUES: Record<AspectRatio, number> = {
  '4:5': 4 / 5,
  '1:1': 1,
  '1.91:1': 1.91,
  '9:16': 9 / 16,
};

// 미리보기 캔버스 크기 (표시용)
const PREVIEW_W = 240;
const PREVIEW_H = 240;

export function CropPreview() {
  const selectedIds = usePhotoStore((s) => s.selectedIds);
  const photos = usePhotoStore((s) => s.photos);
  const cropRatio = usePhotoStore((s) => s.cropRatio);
  const setCropRatio = usePhotoStore((s) => s.setCropRatio);
  const stage = usePhotoStore((s) => s.stage);

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const previewPhoto = selectedIds.size > 0
    ? photos.get(Array.from(selectedIds)[0])
    : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = PREVIEW_W;
    canvas.height = PREVIEW_H;

    // 사진이 없거나 선택 해제 시 캔버스 초기화
    if (!previewPhoto) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('사진을 선택하면', PREVIEW_W / 2, PREVIEW_H / 2 - 8);
      ctx.fillText('미리보기가 표시됩니다', PREVIEW_W / 2, PREVIEW_H / 2 + 12);
      return;
    }

    const img = new Image();
    img.src = previewPhoto.thumbnailUrl;

    img.onload = () => {
      // 1. 원본 이미지를 캔버스에 맞게 그리기 (letterbox)
      const imgW = img.naturalWidth || PREVIEW_W;
      const imgH = img.naturalHeight || PREVIEW_H;
      const scale = Math.min(PREVIEW_W / imgW, PREVIEW_H / imgH);
      const drawW = imgW * scale;
      const drawH = imgH * scale;
      const offsetX = (PREVIEW_W - drawW) / 2;
      const offsetY = (PREVIEW_H - drawH) / 2;

      ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      // 2. 크롭 박스 계산 (drawW × drawH 기준)
      const targetRatio = RATIO_VALUES[cropRatio];

      let cropW: number, cropH: number;
      if (drawW / drawH > targetRatio) {
        // 이미지가 더 넓음 → 높이 기준
        cropH = drawH;
        cropW = drawH * targetRatio;
      } else {
        // 이미지가 더 높음 → 너비 기준
        cropW = drawW;
        cropH = drawW / targetRatio;
      }

      // 3. 가로·세로 모두 이미지 정중앙 기준 크롭
      let cropX: number, cropY: number;
      cropX = offsetX + (drawW - cropW) / 2;
      cropY = offsetY + (drawH - cropH) / 2;

      // 경계 클램핑
      cropX = Math.max(offsetX, Math.min(cropX, offsetX + drawW - cropW));
      cropY = Math.max(offsetY, Math.min(cropY, offsetY + drawH - cropH));

      // 4. 크롭 밖 영역 어둡게
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(offsetX, offsetY, drawW, drawH);

      // 5. 크롭 영역 원본 이미지로 복원
      ctx.save();
      ctx.beginPath();
      ctx.rect(cropX, cropY, cropW, cropH);
      ctx.clip();
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      ctx.restore();

      // 6. 크롭 테두리 + 삼분선
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(cropX, cropY, cropW, cropH);

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i <= 2; i++) {
        const gx = cropX + (cropW / 3) * i;
        const gy = cropY + (cropH / 3) * i;
        ctx.beginPath(); ctx.moveTo(gx, cropY); ctx.lineTo(gx, cropY + cropH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cropX, gy); ctx.lineTo(cropX + cropW, gy); ctx.stroke();
      }

      // 7. 크롭 크기 레이블
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(cropX, cropY + cropH - 20, cropW, 20);
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cropRatio, cropX + cropW / 2, cropY + cropH - 6);
    };

    img.onerror = () => {
      ctx.fillStyle = '#fee2e2';
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    };
  }, [previewPhoto, cropRatio]);

  const handleDownload = async () => {
    if (selectedIds.size === 0) return;
    const selected = Array.from(selectedIds).map((id) => photos.get(id)!).filter(Boolean);
    setDownloading(true);
    setDownloadProgress(0);
    await downloadAsZip(selected, cropRatio, setDownloadProgress);
    setDownloading(false);
  };

  if (stage !== 'done') return null;

  return (
    <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-xl">
      <div className="max-w-6xl mx-auto px-6 py-4 flex flex-wrap gap-6 items-center">

        {/* 미리보기 캔버스 */}
        <div className="flex-shrink-0">
          <p className="text-xs text-gray-400 mb-1 text-center">크롭 미리보기</p>
          <canvas
            ref={canvasRef}
            width={PREVIEW_W}
            height={PREVIEW_H}
            className="rounded-lg border border-gray-200"
            style={{ width: PREVIEW_W, height: PREVIEW_H }}
          />
        </div>

        {/* 비율 선택 + 다운로드 */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 mb-2 font-medium">인스타그램 비율 선택</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {RATIOS.map((r) => (
              <button
                key={r}
                onClick={() => setCropRatio(r)}
                className={`px-3 py-2 rounded-lg text-sm border transition-colors font-medium
                  ${cropRatio === r
                    ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
              >
                {RATIO_LABELS[r]}
                <span className="block text-xs opacity-60 font-normal">{r}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <p className="text-sm text-gray-500">
              {selectedIds.size > 0
                ? `${selectedIds.size}장 선택됨`
                : '그리드에서 사진을 선택하세요'}
            </p>
            <button
              onClick={handleDownload}
              disabled={selectedIds.size === 0 || downloading}
              className="ml-auto px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium
                         hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors min-w-[160px] text-sm"
            >
              {downloading
                ? `다운로드 중... ${downloadProgress}%`
                : `ZIP 다운로드 (${selectedIds.size}장)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
