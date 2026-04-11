// src/components/CropPreview.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 인스타그램 비율별 크롭 미리보기 + ZIP 다운로드 하단 고정 바
//
// 기능:
//   1. 크롭 미리보기 캔버스 — 선택된 첫 번째 사진을 선택한 비율로 크롭 미리보기
//   2. 비율 선택 버튼 — 4:5(세로), 1:1(정사각형), 1.91:1(가로), 9:16(릴스)
//   3. ZIP 다운로드 버튼 — 선택된 사진들을 크롭 후 ZIP으로 묶어 다운로드
//
// 표시 조건:
//   stage === 'done' 일 때만 렌더링됩니다 (분석이 완료된 후)
//
// 캔버스 렌더링 방식:
//   미리보기 캔버스(240×240)에 썸네일 이미지를 letterbox로 그린 후
//   선택한 비율에 맞는 크롭 박스를 파란 테두리로 표시합니다.
//   크롭 바깥 영역은 반투명 어두운 오버레이로 덮습니다.
//   크롭 박스 안에는 삼분선(가이드라인)도 그립니다.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import { downloadAsZip } from '../utils/zip';
import type { AspectRatio, Grade, DetailedAnalysis } from '../types';

// ── 상세 평가 패널 (하단 바 오른쪽 표시용) ─────────────────────────────────

const GRADE_COLORS: Record<Grade, string> = {
  S: 'bg-yellow-400 text-black',
  A: 'bg-green-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-400 text-white',
  D: 'bg-red-400 text-white',
};

const GRADE_COMMENT: Record<Grade, string> = {
  S: '완성도 높은 전신 패션 사진입니다.',
  A: '좋은 전신 사진입니다.',
  B: '기본 품질을 갖춘 사진입니다.',
  C: '아쉬운 부분이 있는 사진입니다.',
  D: '품질이 낮거나 인물이 없는 사진입니다.',
};

function barColor(score: number) {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-yellow-400';
  return 'bg-red-400';
}

function getScoreItems(a: DetailedAnalysis) {
  const items = [
    { label: '화질', score: a.qualityScore,     icon: '📷' },
    { label: '구도', score: a.compositionScore, icon: '📐' },
    { label: '조명', score: a.lightingScore,    icon: '💡' },
    { label: '배경', score: a.backgroundScore,  icon: '🌿' },
    { label: '표정', score: a.expressionScore,  icon: '😊' },
  ];
  if (a.isFullBody) {
    items.push(
      { label: '포즈', score: a.poseScore,    icon: '🧍' },
      { label: '패션', score: a.fashionScore, icon: '👗' },
    );
  }
  return items;
}

interface ScorePanelProps {
  fileName: string;
  analysis: DetailedAnalysis;
  onClose: () => void;
}

function ScorePanel({ fileName, analysis: a, onClose }: ScorePanelProps) {
  const items = getScoreItems(a);
  return (
    <div className="flex-1 min-w-0 max-w-sm border-l border-gray-100 pl-4 flex flex-col">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`flex-shrink-0 text-sm font-black px-2 py-0.5 rounded-lg ${GRADE_COLORS[a.grade]}`}>
            {a.grade}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-800 truncate">{fileName}</p>
            <p className="text-xs text-gray-400">
              {a.isFullBody ? '전신' : '클로즈업'} · 종합 {a.totalScore}점
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 text-gray-300 hover:text-gray-500 text-sm ml-2"
        >
          ✕
        </button>
      </div>

      <p className="text-xs text-gray-500 mb-2">{GRADE_COMMENT[a.grade]}</p>

      {/* 점수 바 */}
      <div className="space-y-1.5 flex-1 overflow-y-auto">
        {items.map(({ label, score, icon }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-gray-600 flex items-center gap-1">
                <span>{icon}</span><span>{label}</span>
              </span>
              <span className={`text-xs font-bold ${
                score >= 70 ? 'text-green-600' :
                score >= 50 ? 'text-blue-600' : 'text-red-500'
              }`}>{score}점</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${barColor(score)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 감점 + 팁 */}
      {a.penalties.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {a.penalties.map((p) => (
            <span key={p.type} className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
              {p.description} ({p.score}점)
            </span>
          ))}
        </div>
      )}
      {a.tips.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {a.tips.slice(0, 2).map((tip, i) => (
            <li key={i} className="text-xs text-gray-400 flex gap-1">
              <span className="text-blue-300 flex-shrink-0">›</span>
              <span className="line-clamp-1">{tip}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 지원하는 인스타그램 비율 목록 */
const RATIOS: AspectRatio[] = ['4:5', '1:1', '1.91:1', '9:16'];

/** 비율 코드 → 사람이 읽기 쉬운 한국어 레이블 */
const RATIO_LABELS: Record<AspectRatio, string> = {
  '4:5':    '세로 4:5',
  '1:1':    '정사각형',
  '1.91:1': '가로 1.91:1',
  '9:16':   '릴스 9:16',
};

/** 비율 코드 → 가로/세로 비율 숫자 값 (크롭 계산용) */
const RATIO_VALUES: Record<AspectRatio, number> = {
  '4:5':    4 / 5,    // 0.8  (세로가 더 긴 세로형)
  '1:1':    1,        // 1.0  (정사각형)
  '1.91:1': 1.91,     // 1.91 (가로가 더 긴 가로형)
  '9:16':   9 / 16,   // 0.5625 (릴스: 세로가 훨씬 긴 세로형)
};

/** 미리보기 캔버스 표시 크기 (픽셀) */
const PREVIEW_W = 240;
const PREVIEW_H = 240;

export function CropPreview() {
  // ── Zustand 스토어 구독 ────────────────────────────────────────────────────
  const selectedIds  = usePhotoStore((s) => s.selectedIds);
  const photos       = usePhotoStore((s) => s.photos);
  const cropRatio    = usePhotoStore((s) => s.cropRatio);
  const setCropRatio = usePhotoStore((s) => s.setCropRatio);
  const stage        = usePhotoStore((s) => s.stage);
  const focusedId    = usePhotoStore((s) => s.focusedId);
  const setFocusedId = usePhotoStore((s) => s.setFocusedId);

  // ── 로컬 상태 ─────────────────────────────────────────────────────────────
  const [downloading,      setDownloading]      = useState(false); // 다운로드 진행 중 여부
  const [downloadProgress, setDownloadProgress] = useState(0);     // 다운로드 진행률 (0~100)

  const canvasRef = useRef<HTMLCanvasElement>(null); // 미리보기 캔버스 DOM 참조

  // 미리보기에 표시할 사진: 포커스된 사진 → 없으면 선택된 첫 번째
  const focusedPhoto  = focusedId ? photos.get(focusedId) : null;
  const previewPhoto  = focusedPhoto
    ?? (selectedIds.size > 0 ? photos.get(Array.from(selectedIds)[0]) : null);

  // ── 캔버스 렌더링 ──────────────────────────────────────────────────────────
  // previewPhoto 또는 cropRatio가 바뀔 때마다 캔버스를 다시 그립니다
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width  = PREVIEW_W;
    canvas.height = PREVIEW_H;

    // 선택된 사진이 없으면 안내 텍스트만 표시
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

    // 썸네일 이미지 로드 (base64 data URL 또는 blob URL)
    const img = new Image();
    img.src = previewPhoto.thumbnailUrl;

    img.onload = () => {
      const imgW = img.naturalWidth  || PREVIEW_W;
      const imgH = img.naturalHeight || PREVIEW_H;

      // ── Step 1: 이미지를 캔버스에 letterbox로 그리기 ──────────────────────
      // letterbox: 이미지 비율을 유지하면서 캔버스에 꽉 차게 축소
      // 가로 또는 세로 중 더 작은 스케일 값 사용
      const scale   = Math.min(PREVIEW_W / imgW, PREVIEW_H / imgH);
      const drawW   = imgW * scale;  // 캔버스에 그려질 실제 이미지 너비
      const drawH   = imgH * scale;  // 캔버스에 그려질 실제 이미지 높이
      const offsetX = (PREVIEW_W - drawW) / 2; // 가로 중앙 정렬을 위한 오프셋
      const offsetY = (PREVIEW_H - drawH) / 2; // 세로 중앙 정렬을 위한 오프셋

      ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.fillStyle = '#1f2937'; // 어두운 배경 (letterbox 여백 색상)
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

      // ── Step 2: 크롭 박스 크기 계산 ──────────────────────────────────────
      // 선택된 비율(예: 4:5 = 0.8)에 맞춰 그려진 이미지(drawW × drawH) 내에서
      // 최대한 크게 들어가는 크롭 영역을 계산합니다
      const targetRatio = RATIO_VALUES[cropRatio];
      let cropW: number, cropH: number;

      if (drawW / drawH > targetRatio) {
        // 이미지가 목표 비율보다 더 넓음 → 이미지 높이 전체를 사용
        // 예: 가로 400 × 세로 300 이미지에서 4:5(0.8) 크롭
        //     높이 300 사용, 너비 = 300 × 0.8 = 240
        cropH = drawH;
        cropW = drawH * targetRatio;
      } else {
        // 이미지가 목표 비율보다 더 높음 → 이미지 너비 전체를 사용
        // 예: 가로 300 × 세로 400 이미지에서 1.91:1(1.91) 크롭
        //     너비 300 사용, 높이 = 300 / 1.91 = 157
        cropW = drawW;
        cropH = drawW / targetRatio;
      }

      // ── Step 3: 크롭 박스 위치 (이미지 정중앙 기준) ──────────────────────
      let cropX = offsetX + (drawW - cropW) / 2; // 그려진 이미지 내 가로 중앙
      let cropY = offsetY + (drawH - cropH) / 2; // 그려진 이미지 내 세로 중앙

      // 경계 클램핑: 크롭 박스가 이미지 밖으로 나가지 않도록
      cropX = Math.max(offsetX, Math.min(cropX, offsetX + drawW - cropW));
      cropY = Math.max(offsetY, Math.min(cropY, offsetY + drawH - cropH));

      // ── Step 4: 크롭 바깥 영역을 반투명 오버레이로 덮기 ─────────────────
      // 이미지 전체에 어두운 오버레이를 씌운 후
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(offsetX, offsetY, drawW, drawH);

      // ── Step 5: 크롭 영역만 원본 이미지로 복원 ───────────────────────────
      // clip() 으로 크롭 영역을 클리핑 마스크로 설정하고 이미지를 다시 그림
      ctx.save();
      ctx.beginPath();
      ctx.rect(cropX, cropY, cropW, cropH);
      ctx.clip();
      ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      ctx.restore();

      // ── Step 6: 크롭 테두리 그리기 ───────────────────────────────────────
      ctx.strokeStyle = '#3b82f6'; // 파란색 테두리
      ctx.lineWidth   = 2;
      ctx.strokeRect(cropX, cropY, cropW, cropH);

      // 삼분선 (가이드라인): 크롭 영역을 3×3으로 나누는 반투명 흰 선
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = 0.5;
      for (let i = 1; i <= 2; i++) {
        const gx = cropX + (cropW / 3) * i; // 가로 1/3, 2/3 위치
        const gy = cropY + (cropH / 3) * i; // 세로 1/3, 2/3 위치
        // 세로선
        ctx.beginPath(); ctx.moveTo(gx, cropY); ctx.lineTo(gx, cropY + cropH); ctx.stroke();
        // 가로선
        ctx.beginPath(); ctx.moveTo(cropX, gy); ctx.lineTo(cropX + cropW, gy); ctx.stroke();
      }

      // ── Step 7: 크롭 비율 레이블 (크롭 박스 하단에 표시) ─────────────────
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; // 반투명 검은 배경
      ctx.fillRect(cropX, cropY + cropH - 20, cropW, 20);
      ctx.fillStyle   = '#fff';
      ctx.font        = '11px sans-serif';
      ctx.textAlign   = 'center';
      ctx.fillText(cropRatio, cropX + cropW / 2, cropY + cropH - 6);
    };

    // 썸네일 이미지 로드 실패 시 빨간 배경으로 오류 표시
    img.onerror = () => {
      ctx.fillStyle = '#fee2e2';
      ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    };
  }, [previewPhoto, cropRatio]); // previewPhoto 또는 cropRatio 변경 시 재렌더링

  /** ZIP 다운로드 버튼 클릭 핸들러 */
  const handleDownload = async () => {
    if (selectedIds.size === 0) return;

    // 선택된 ID → PhotoData 객체 배열 변환 (Map에서 꺼내고 undefined 제거)
    const selected = Array.from(selectedIds)
      .map((id) => photos.get(id)!)
      .filter(Boolean);

    setDownloading(true);
    setDownloadProgress(0);

    // downloadAsZip: 각 사진을 크롭 후 ZIP으로 묶어 브라우저 다운로드 트리거
    await downloadAsZip(selected, cropRatio, setDownloadProgress);

    setDownloading(false);
  };

  // done 상태가 아니면 렌더링하지 않음
  if (stage !== 'done') return null;

  return (
    // 화면 하단에 고정되는 바 (sticky bottom-0)
    <div className="sticky bottom-0 bg-white border-t border-gray-200 shadow-xl">
      <div className="max-w-6xl mx-auto px-6 py-4 flex gap-4 items-start">

        {/* ── 크롭 미리보기 캔버스 ─────────────────────────────────────────── */}
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

        {/* ── 상세 평가 패널 (사진 포커스 시 표시) ────────────────────────── */}
        {focusedPhoto?.analysis && (
          <ScorePanel
            fileName={focusedPhoto.fileName}
            analysis={focusedPhoto.analysis}
            onClose={() => setFocusedId(null)}
          />
        )}

        {/* ── 비율 선택 버튼 + 다운로드 버튼 ──────────────────────────────── */}
        <div className="flex-shrink-0 ml-auto flex flex-col justify-between" style={{ minWidth: 220 }}>
          <div>
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
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm text-gray-500">
              {selectedIds.size > 0 ? `${selectedIds.size}장 선택됨` : '그리드에서 사진을 선택하세요'}
            </p>
            <button
              onClick={handleDownload}
              disabled={selectedIds.size === 0 || downloading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium
                         hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed
                         transition-colors text-sm"
            >
              {downloading ? `다운로드 중... ${downloadProgress}%` : `ZIP 다운로드 (${selectedIds.size}장)`}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
