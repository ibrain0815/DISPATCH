// src/components/ProgressBar.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 파이프라인 진행률 표시 컴포넌트 — 3단계 레이블 + 프로그레스바 + 완료 요약
//
// 표시 조건:
//   stage !== 'idle' 일 때 렌더링됩니다 (분석이 시작된 후부터 완료까지)
//   idle 상태에서는 UploadZone이 보이고, ProgressBar는 숨겨집니다.
//
// 3단계 진행 표시:
//   filtering  → "1단계: 불량 사진 제거"  (흔들림/노출 불량/해상도 부족 필터)
//   deduping   → "2단계: 중복 사진 정리"  (pHash 기반 유사 사진 제거)
//   analyzing  → "3단계: AI 정밀 분석"    (표정/구도/조명/배경 분석 + 점수)
//   done       → "분석 완료!"
//
// 완료 후 요약 카드:
//   업로드 총 수 / 1차 필터 통과 수 / 중복 제거 후 수 / S+A 추천 수
// ─────────────────────────────────────────────────────────────────────────────

import { usePhotoStore } from '../store/usePhotoStore';

/** 파이프라인 단계 코드 → 사용자에게 보여줄 한국어 레이블 */
const STAGE_LABELS: Record<string, string> = {
  filtering: '1단계: 불량 사진 제거',
  deduping:  '2단계: 중복 사진 정리',
  analyzing: '3단계: AI 정밀 분석',
  done:      '분석 완료!',
};

export function ProgressBar() {
  // ── Zustand 스토어 구독 ────────────────────────────────────────────────────
  const stage    = usePhotoStore((s) => s.stage);    // 현재 파이프라인 단계
  const progress = usePhotoStore((s) => s.progress); // { current, total, label }
  const summary  = usePhotoStore((s) => s.summary);  // 단계별 통계 요약

  // idle 상태에서는 렌더링하지 않음 (업로드 전)
  if (stage === 'idle') return null;

  // 진행률 퍼센트 계산 (총 처리할 사진이 없으면 0%)
  const percent = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div className="w-full max-w-2xl mx-auto my-8">

      {/* ── 단계 레이블 + 처리 현황 ────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-2">
        {/* 단계명: STAGE_LABELS에 없으면 progress.label 사용 (폴백) */}
        <span className="text-sm font-medium text-gray-700">
          {STAGE_LABELS[stage] ?? progress.label}
        </span>
        {/* 처리된 수 / 전체 수 (예: "247 / 1000") */}
        <span className="text-sm text-gray-500">
          {progress.current}/{progress.total}
        </span>
      </div>

      {/* ── 프로그레스 바 ──────────────────────────────────────────────────── */}
      {/* 회색 배경 트랙 위에 파란색 채움 바가 올라가는 구조 */}
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className="bg-blue-500 h-3 rounded-full transition-all duration-150"
          style={{ width: `${percent}%` }} // 인라인 스타일로 동적 너비 제어
        />
      </div>

      {/* ── 진행 중 중간 요약 (done 이전 단계에서 표시) ──────────────────── */}
      {/* 예: "총 1000장 중 234장 통과" — 1단계 필터 통과율을 실시간 확인 */}
      {stage !== 'done' && (
        <p className="text-xs text-gray-400 mt-2">
          총 {summary.totalUploaded}장 중 {summary.passedFilter}장 통과
        </p>
      )}

      {/* ── 완료 요약 카드 (done 상태에서 표시) ─────────────────────────────── */}
      {/* 4개의 통계 카드: 업로드 → 1차 통과 → 중복 제거 후 → 추천 */}
      {stage === 'done' && (
        <div className="mt-4 grid grid-cols-4 gap-3 text-center">
          {[
            {
              label: '업로드',        // 원본 업로드 사진 총 수
              value: summary.totalUploaded,
            },
            {
              label: '1차 통과',      // Stage 1 필터 통과 수 (불량 제거 후)
              value: summary.passedFilter,
            },
            {
              label: '중복 제거 후',  // Stage 2 중복 제거 후 남은 수
              value: summary.afterDedup,
            },
            {
              label: '추천 (S+A)',    // Stage 3 분석 후 S/A 등급 수
              value: summary.recommended,
            },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3">
              {/* 큰 숫자 (파란색 굵은 폰트) */}
              <p className="text-2xl font-bold text-blue-600">{value}</p>
              {/* 레이블 (작은 회색 텍스트) */}
              <p className="text-xs text-gray-500 mt-1">{label}</p>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
