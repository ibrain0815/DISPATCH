// src/components/PhotoGrid.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 분석 결과 사진 그리드 — 등급 탭 필터 + 사진 선택
// Shift + 마우스 드래그로 영역 내 사진 일괄 선택 지원
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState, useEffect, useRef } from 'react';
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
    .sort((a, b) => b.analysis!.totalScore - a.analysis!.totalScore);
  if (grade === 'ALL') return recommended;
  return recommended.filter((p) => p.analysis?.grade === grade);
}

/** 드래그 선택 상태 */
interface DragSel {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  active: boolean; // 5px 이상 이동했을 때 true
}

export function PhotoGrid() {
  const stage        = usePhotoStore((s) => s.stage);
  const photosMap    = usePhotoStore((s) => s.photos);
  const selectedIds  = usePhotoStore((s) => s.selectedIds);
  const toggleSelect = usePhotoStore((s) => s.toggleSelect);
  const selectMany   = usePhotoStore((s) => s.selectMany);
  const selectAll    = usePhotoStore((s) => s.selectAll);
  const deselectAll  = usePhotoStore((s) => s.deselectAll);
  const focusedId    = usePhotoStore((s) => s.focusedId);
  const setFocusedId = usePhotoStore((s) => s.setFocusedId);

  const [activeGrade, setActiveGrade] = useState<Grade | 'ALL'>('ALL');

  // ── 드래그 선택 상태 ──────────────────────────────────────────────────────
  const [drag, setDragState] = useState<DragSel | null>(null);
  // ref로도 유지해 mousemove/mouseup 핸들러에서 최신값 참조
  const dragRef    = useRef<DragSel | null>(null);
  // 드래그가 끝난 직후 카드 onClick이 발화되는 것을 막기 위한 플래그
  const wasDragged = useRef(false);
  // 각 카드 DOM 요소를 id 별로 저장 (교차 판정용)
  const cardRefs   = useRef(new Map<string, HTMLDivElement>());

  const setDrag = (d: DragSel | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  // Shift+mousedown 시 드래그 시작
  const handleGridMouseDown = (e: React.MouseEvent) => {
    if (!e.shiftKey) return;
    e.preventDefault(); // 텍스트 선택 방지
    const d: DragSel = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY, active: false };
    setDrag(d);
  };

  // drag가 활성 중일 때만 mousemove / mouseup 전역 리스너 등록
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const prev = dragRef.current;
      if (!prev) return;
      const dx = e.clientX - prev.startX;
      const dy = e.clientY - prev.startY;
      const next: DragSel = {
        ...prev,
        curX: e.clientX,
        curY: e.clientY,
        active: Math.sqrt(dx * dx + dy * dy) > 5,
      };
      dragRef.current = next;
      setDragState({ ...next });
    };

    const onUp = () => {
      const prev = dragRef.current;
      if (!prev) return;

      if (prev.active) {
        // 드래그 영역과 교차하는 카드 모두 선택
        const left   = Math.min(prev.startX, prev.curX);
        const top    = Math.min(prev.startY, prev.curY);
        const right  = Math.max(prev.startX, prev.curX);
        const bottom = Math.max(prev.startY, prev.curY);

        const toSelect: string[] = [];
        cardRefs.current.forEach((el, id) => {
          const r = el.getBoundingClientRect();
          if (r.right >= left && r.left <= right && r.bottom >= top && r.top <= bottom) {
            toSelect.push(id);
          }
        });

        if (toSelect.length > 0) selectMany(toSelect);
        wasDragged.current = true; // 카드 onClick 무시 신호
      }

      setDrag(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    // 드래그 중 텍스트 선택 차단
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      document.body.style.userSelect = '';
    };
  }, [!!drag]); // drag 시작/종료 시에만 재등록

  const allPhotos  = useMemo(() => Array.from(photosMap.values()), [photosMap]);
  const photos     = useMemo(() => filterByGrade(allPhotos, activeGrade), [allPhotos, activeGrade]);
  const gradeCount = useMemo(
    () => Object.fromEntries(GRADES.map((g) => [g, filterByGrade(allPhotos, g).length])),
    [allPhotos]
  );

  if (stage !== 'done') return null;

  /** 카드 클릭: 드래그 직후면 무시, 같은 사진 재클릭 시 포커스 해제, 아니면 포커스+선택 */
  const handleCardClick = (id: string) => {
    if (wasDragged.current) { wasDragged.current = false; return; }
    if (focusedId === id) {
      setFocusedId(null);
    } else {
      setFocusedId(id);
      if (!selectedIds.has(id)) toggleSelect(id);
    }
  };

  // 드래그 선택 사각형 좌표
  const selRect = drag?.active ? {
    left:   Math.min(drag.startX, drag.curX),
    top:    Math.min(drag.startY, drag.curY),
    width:  Math.abs(drag.curX - drag.startX),
    height: Math.abs(drag.curY - drag.startY),
  } : null;

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
        <p className="text-sm text-gray-500">
          {photos.length}장
          <span className="ml-2 text-xs text-gray-400">Shift+드래그로 영역 선택</span>
        </p>
        <div className="flex items-center gap-3">
          <button onClick={selectAll}   className="text-xs text-blue-500 hover:underline">전체 선택</button>
          <span className="text-gray-200">|</span>
          <button onClick={deselectAll} className="text-xs text-gray-400 hover:underline">선택 해제</button>
          <span className="text-sm font-medium text-gray-700">{selectedIds.size}장 선택됨</span>
        </div>
      </div>

      {/* ── 사진 그리드 ──────────────────────────────────────────────────────── */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2"
        onMouseDown={handleGridMouseDown}
      >
        {photos.map((photo) => {
          const isSelected = selectedIds.has(photo.id);
          const isFocused  = focusedId === photo.id;
          const grade      = photo.analysis?.grade ?? 'D';

          // 드래그 중 실시간 하이라이트
          const isDragHighlighted = drag?.active && (() => {
            const el = cardRefs.current.get(photo.id);
            if (!el || !selRect) return false;
            const r = el.getBoundingClientRect();
            return r.right >= selRect.left &&
                   r.left  <= selRect.left + selRect.width &&
                   r.bottom >= selRect.top &&
                   r.top   <= selRect.top + selRect.height;
          })();

          return (
            <div
              key={photo.id}
              ref={(el) => {
                if (el) cardRefs.current.set(photo.id, el);
                else    cardRefs.current.delete(photo.id);
              }}
              onClick={() => handleCardClick(photo.id)}
              className={`relative rounded-xl overflow-hidden cursor-pointer aspect-square
                ring-2 transition-all
                ${isFocused
                  ? 'ring-blue-500 ring-offset-2 scale-95'
                  : isSelected || isDragHighlighted
                    ? 'ring-blue-400 scale-95'
                    : 'ring-transparent hover:ring-gray-300'
                }`}
            >
              <img
                src={photo.thumbnailUrl}
                alt={photo.fileName}
                className="w-full h-full object-cover"
                loading="lazy"
                draggable={false}
              />

              {/* 드래그 하이라이트 오버레이 */}
              {isDragHighlighted && !isSelected && (
                <div className="absolute inset-0 bg-blue-400/20" />
              )}

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

              {/* 선택 체크 (좌상단) */}
              {isSelected && (
                <div
                  className="absolute top-1 left-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs"
                  onClick={(e) => { e.stopPropagation(); toggleSelect(photo.id); }}
                >
                  ✓
                </div>
              )}

              {/* 상세보기 안내 hover */}
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

      {/* ── 드래그 선택 사각형 오버레이 (viewport 고정) ─────────────────────── */}
      {selRect && (
        <div
          className="fixed pointer-events-none z-50 border-2 border-blue-500 bg-blue-500/10 rounded"
          style={{
            left:   selRect.left,
            top:    selRect.top,
            width:  selRect.width,
            height: selRect.height,
          }}
        />
      )}
    </div>
  );
}
