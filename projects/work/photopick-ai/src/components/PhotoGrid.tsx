// src/components/PhotoGrid.tsx
// 분석 결과 그리드 — 등급 탭 필터 + 선택 기능

import { useMemo, useState } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import type { Grade, PhotoData } from '../types';

const GRADES: Array<Grade | 'ALL'> = ['ALL', 'S', 'A', 'B', 'C', 'D'];

const GRADE_COLORS: Record<Grade, string> = {
  S: 'bg-yellow-400 text-black',
  A: 'bg-green-500 text-white',
  B: 'bg-blue-500 text-white',
  C: 'bg-gray-400 text-white',
  D: 'bg-red-400 text-white',
};

function filterByGrade(allPhotos: PhotoData[], grade: Grade | 'ALL'): PhotoData[] {
  const recommended = allPhotos
    .filter((p) => p.analysis !== null && p.isGroupBest)
    .sort((a, b) => (b.analysis!.totalScore) - (a.analysis!.totalScore));
  if (grade === 'ALL') return recommended;
  return recommended.filter((p) => p.analysis?.grade === grade);
}

export function PhotoGrid() {
  const stage = usePhotoStore((s) => s.stage);
  const photosMap = usePhotoStore((s) => s.photos);
  const selectedIds = usePhotoStore((s) => s.selectedIds);
  const toggleSelect = usePhotoStore((s) => s.toggleSelect);
  const selectAll = usePhotoStore((s) => s.selectAll);
  const deselectAll = usePhotoStore((s) => s.deselectAll);

  const [activeGrade, setActiveGrade] = useState<Grade | 'ALL'>('ALL');

  const allPhotos = useMemo(() => Array.from(photosMap.values()), [photosMap]);
  const photos = useMemo(() => filterByGrade(allPhotos, activeGrade), [allPhotos, activeGrade]);
  const gradeCount = useMemo(
    () => Object.fromEntries(GRADES.map((g) => [g, filterByGrade(allPhotos, g).length])),
    [allPhotos]
  );

  if (stage !== 'done') return null;

  return (
    <div className="w-full">
      {/* 등급 탭 */}
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

      {/* 선택 도구 */}
      <div className="flex justify-between items-center mb-3">
        <p className="text-sm text-gray-500">{photos.length}장</p>
        <div className="flex items-center gap-3">
          <button onClick={selectAll} className="text-xs text-blue-500 hover:underline">
            전체 선택
          </button>
          <span className="text-gray-200">|</span>
          <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline">
            선택 해제
          </button>
          <span className="text-sm font-medium text-gray-700">{selectedIds.size}장 선택됨</span>
        </div>
      </div>

      {/* 사진 그리드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {photos.map((photo) => {
          const isSelected = selectedIds.has(photo.id);
          const grade = photo.analysis?.grade ?? 'D';

          return (
            <div
              key={photo.id}
              onClick={() => toggleSelect(photo.id)}
              className={`relative rounded-xl overflow-hidden cursor-pointer aspect-square
                ring-2 transition-all
                ${isSelected ? 'ring-blue-500 scale-95' : 'ring-transparent hover:ring-gray-300'}`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <span className={`absolute top-1 right-1 text-xs font-bold px-1.5 py-0.5 rounded ${GRADE_COLORS[grade as Grade]}`}>
                {grade}
              </span>
              <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-xs text-center py-1">
                {photo.analysis?.totalScore ?? '-'}점
              </div>
              {isSelected && (
                <div className="absolute top-1 left-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">
                  ✓
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
