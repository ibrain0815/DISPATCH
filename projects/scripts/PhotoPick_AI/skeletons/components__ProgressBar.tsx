// src/components/ProgressBar.tsx
// 파이프라인 진행률 표시 (3단계 레이블 포함)

import { usePhotoStore } from '../store/usePhotoStore';

const STAGE_LABELS: Record<string, string> = {
  filtering: '1단계: 불량 사진 제거',
  deduping: '2단계: 중복 사진 정리',
  analyzing: '3단계: AI 정밀 분석',
  done: '분석 완료!',
};

export function ProgressBar() {
  const { stage, progress, summary } = usePhotoStore((s) => ({
    stage: s.stage,
    progress: s.progress,
    summary: s.summary,
  }));

  if (stage === 'idle') return null;

  const percent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="w-full max-w-2xl mx-auto my-8">
      {/* 단계 레이블 */}
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-700">
          {STAGE_LABELS[stage] ?? progress.label}
        </span>
        <span className="text-sm text-gray-500">
          {progress.current}/{progress.total}
        </span>
      </div>

      {/* 프로그레스 바 */}
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className="bg-blue-500 h-3 rounded-full transition-all duration-150"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 중간 요약 */}
      {stage !== 'done' && (
        <p className="text-xs text-gray-400 mt-2">
          총 {summary.totalUploaded}장 중 {summary.passedFilter}장 통과
        </p>
      )}

      {/* 완료 요약 */}
      {stage === 'done' && (
        <div className="mt-4 grid grid-cols-4 gap-3 text-center">
          {[
            { label: '업로드', value: summary.totalUploaded },
            { label: '1차 통과', value: summary.passedFilter },
            { label: '중복 제거 후', value: summary.afterDedup },
            { label: '추천 (S+A)', value: summary.recommended },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3">
              <p className="text-2xl font-bold text-blue-600">{value}</p>
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
