// src/components/PhotoGrid.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 분석 결과 사진 그리드 — 등급 탭 필터 + 사진 선택 + 상세 평가 패널
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import type { Grade, PhotoData, DetailedAnalysis } from '../types';

const GRADES: Array<Grade | 'ALL'> = ['ALL', 'S', 'A', 'B', 'C', 'D'];

const GRADE_COLORS: Record<Grade, string> = {
  S: 'bg-yellow-400 text-black',
  A: 'bg-green-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-400 text-white',
  D: 'bg-red-400 text-white',
};

const GRADE_BG: Record<Grade, string> = {
  S: 'bg-yellow-50 border-yellow-300',
  A: 'bg-green-50 border-green-300',
  B: 'bg-blue-50 border-blue-300',
  C: 'bg-gray-50 border-gray-300',
  D: 'bg-red-50 border-red-300',
};

const GRADE_COMMENT: Record<Grade, string> = {
  S: '완성도 높은 전신 패션 사진입니다. 포즈·패션·화질이 모두 우수합니다.',
  A: '좋은 전신 사진입니다. 포즈 또는 패션 코디가 잘 나왔습니다.',
  B: '기본 품질을 갖춘 사진입니다. 전신 구도로 촬영하면 더 높은 점수를 받을 수 있습니다.',
  C: '아쉬운 부분이 있는 사진입니다. 아래 개선 팁을 참고하세요.',
  D: '품질이 낮거나 인물이 없는 사진입니다.',
};

/** 점수 → 바 색상 */
function barColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-blue-500';
  if (score >= 40) return 'bg-yellow-400';
  return 'bg-red-400';
}


/** 상세 점수 항목 정의 */
function getScoreItems(a: DetailedAnalysis) {
  const items = [
    { label: '화질', key: 'qualityScore',     score: a.qualityScore,     icon: '📷', desc: '선명도와 노출 상태' },
    { label: '구도', key: 'compositionScore', score: a.compositionScore, icon: '📐', desc: '삼분법·헤드룸·프레이밍' },
    { label: '조명', key: 'lightingScore',    score: a.lightingScore,    icon: '💡', desc: '밝기 분포와 명암 대비' },
    { label: '배경', key: 'backgroundScore',  score: a.backgroundScore,  icon: '🌿', desc: '배경 단순도' },
    { label: '표정', key: 'expressionScore',  score: a.expressionScore,  icon: '😊', desc: '얼굴 밝기·대칭·디테일' },
  ];

  if (a.isFullBody) {
    items.push(
      { label: '포즈', key: 'poseScore',    score: a.poseScore,    icon: '🧍', desc: '발끝 여백·바디 채움·균형·역동성' },
      { label: '패션', key: 'fashionScore', score: a.fashionScore, icon: '👗', desc: '색상 조화와 코디 자신감' },
    );
  }

  return items;
}

/** 상세 평가 패널 컴포넌트 */
function ScorePanel({ photo, onClose }: { photo: PhotoData; onClose: () => void }) {
  const a = photo.analysis!;
  const grade = a.grade;
  const items = getScoreItems(a);

  return (
    <div className={`rounded-2xl border-2 p-5 mb-4 relative ${GRADE_BG[grade]}`}>
      {/* 닫기 버튼 */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 text-lg leading-none"
      >
        ✕
      </button>

      {/* 헤더: 등급 + 파일명 + 종합 코멘트 */}
      <div className="flex items-start gap-3 mb-4 pr-6">
        <div className={`text-2xl font-black px-3 py-1 rounded-xl ${GRADE_COLORS[grade]}`}>
          {grade}
        </div>
        <div>
          <p className="text-sm font-semibold text-gray-800 truncate max-w-xs">{photo.fileName}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {a.isFullBody ? '전신 패션 사진' : '클로즈업 사진'} &nbsp;·&nbsp; 종합 {a.totalScore}점
          </p>
          <p className="text-sm text-gray-700 mt-1">{GRADE_COMMENT[grade]}</p>
        </div>
      </div>

      {/* 점수 항목 바 */}
      <div className="space-y-2.5 mb-4">
        {items.map(({ label, score, icon, desc }) => (
          <div key={label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium text-gray-700 flex items-center gap-1">
                <span>{icon}</span>
                <span>{label}</span>
                <span className="text-gray-400 font-normal">— {desc}</span>
              </span>
              <span className={`text-xs font-bold ${
                score === 0 ? 'text-gray-400' :
                score >= 70 ? 'text-green-600' :
                score >= 50 ? 'text-blue-600' : 'text-red-500'
              }`}>
                {score === 0 ? '—' : `${score}점`}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${score === 0 ? 'bg-gray-300' : barColor(score)}`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* 패널티 */}
      {a.penalties.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-red-600 mb-1">감점 요소</p>
          <div className="flex flex-wrap gap-1.5">
            {a.penalties.map((p) => (
              <span key={p.type} className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                {p.description} ({p.score}점)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 개선 팁 */}
      {a.tips.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-blue-600 mb-1">개선 팁</p>
          <ul className="space-y-1">
            {a.tips.map((tip, i) => (
              <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                <span className="text-blue-400 mt-0.5 flex-shrink-0">›</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function filterByGrade(allPhotos: PhotoData[], grade: Grade | 'ALL'): PhotoData[] {
  const recommended = allPhotos
    .filter((p) => p.analysis !== null && p.isGroupBest)
    .sort((a, b) => b.analysis!.totalScore - a.analysis!.totalScore);
  if (grade === 'ALL') return recommended;
  return recommended.filter((p) => p.analysis?.grade === grade);
}

export function PhotoGrid() {
  const stage        = usePhotoStore((s) => s.stage);
  const photosMap    = usePhotoStore((s) => s.photos);
  const selectedIds  = usePhotoStore((s) => s.selectedIds);
  const toggleSelect = usePhotoStore((s) => s.toggleSelect);
  const selectAll    = usePhotoStore((s) => s.selectAll);
  const deselectAll  = usePhotoStore((s) => s.deselectAll);

  const [activeGrade, setActiveGrade] = useState<Grade | 'ALL'>('ALL');
  // 현재 상세 패널을 표시할 사진 ID (null이면 패널 숨김)
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const allPhotos  = useMemo(() => Array.from(photosMap.values()), [photosMap]);
  const photos     = useMemo(() => filterByGrade(allPhotos, activeGrade), [allPhotos, activeGrade]);
  const gradeCount = useMemo(
    () => Object.fromEntries(GRADES.map((g) => [g, filterByGrade(allPhotos, g).length])),
    [allPhotos]
  );

  if (stage !== 'done') return null;

  const focusedPhoto = focusedId ? photosMap.get(focusedId) ?? null : null;

  /** 카드 클릭: 이미 포커스된 사진이면 패널 닫기, 아니면 포커스 + 선택 */
  const handleCardClick = (id: string) => {
    if (focusedId === id) {
      setFocusedId(null); // 같은 사진 재클릭 → 패널 닫기
    } else {
      setFocusedId(id);   // 다른 사진 클릭 → 패널 열기
      if (!selectedIds.has(id)) toggleSelect(id); // 미선택 상태면 함께 선택
    }
  };

  return (
    <div className="w-full">

      {/* ── 등급 탭 ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {GRADES.map((grade) => (
          <button
            key={grade}
            onClick={() => setActiveGrade(grade)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors
              ${activeGrade === grade
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
          >
            {grade === 'ALL' ? '전체' : `${grade}등급`}
            <span className="ml-1 text-xs opacity-70">({gradeCount[grade]})</span>
          </button>
        ))}
      </div>

      {/* ── 선택 도구 ────────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">{photos.length}장</p>
        <div className="flex items-center gap-3">
          <button onClick={selectAll}   className="text-xs text-blue-500 hover:underline">전체 선택</button>
          <span className="text-gray-200">|</span>
          <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline">선택 해제</button>
          <span className="text-sm font-medium text-gray-700">{selectedIds.size}장 선택됨</span>
        </div>
      </div>

      {/* ── 상세 평가 패널 (선택된 사진이 있을 때 그리드 위에 표시) ────────── */}
      {focusedPhoto?.analysis && (
        <ScorePanel
          photo={focusedPhoto}
          onClose={() => setFocusedId(null)}
        />
      )}

      {/* ── 사진 그리드 ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {photos.map((photo) => {
          const isSelected = selectedIds.has(photo.id);
          const isFocused  = focusedId === photo.id;
          const grade      = photo.analysis?.grade ?? 'D';

          return (
            <div
              key={photo.id}
              onClick={() => handleCardClick(photo.id)}
              className={`relative rounded-xl overflow-hidden cursor-pointer aspect-square
                ring-2 transition-all
                ${isFocused
                  ? 'ring-blue-500 ring-offset-2 scale-95'  // 포커스: 굵은 파란 테두리
                  : isSelected
                    ? 'ring-blue-400 scale-95'               // 선택만: 테두리
                    : 'ring-transparent hover:ring-gray-300'
                }`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />

              {/* 등급 배지 */}
              <span className={`absolute top-1 right-1 text-xs font-bold px-1.5 py-0.5 rounded ${GRADE_COLORS[grade as Grade]}`}>
                {grade}
              </span>

              {/* 점수 + 전신 아이콘 */}
              <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs text-center py-1">
                {photo.analysis?.totalScore ?? '-'}점
                {photo.analysis?.isFullBody && (
                  <span className="ml-1 text-yellow-300">👗</span>
                )}
              </div>

              {/* 선택 체크 (좌상단) — 클릭으로 선택 토글 별도 처리 */}
              {isSelected && (
                <div
                  className="absolute top-1 left-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(photo.id); }}
                >
                  ✓
                </div>
              )}

              {/* 상세보기 안내 (미선택 상태 + 미포커스 시 hover에 표시) */}
              {!isSelected && !isFocused && (
                <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                  <span className="text-white text-xs bg-black/60 px-2 py-1 rounded-full">탭하여 상세보기</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {photos.length === 0 && (
        <p className="text-center text-gray-400 py-16">{activeGrade}등급 사진이 없습니다</p>
      )}
    </div>
  );
}
