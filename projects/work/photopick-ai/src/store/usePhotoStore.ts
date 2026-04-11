// src/store/usePhotoStore.ts
// ─────────────────────────────────────────────────────────────────────────────
// Zustand 전역 상태 스토어 — 전체 앱의 사진 데이터와 UI 상태를 관리합니다
//
// Map 구조 사용 이유:
//   배열(Array) 대신 Map<id, PhotoData>를 사용하면 특정 사진을 O(1)로 조회·수정 가능.
//   1000장 이상의 사진을 업로드해도 파이프라인이 느려지지 않습니다.
//
// 무한 루프 방지:
//   Zustand에서 `(s) => ({ a: s.a, b: s.b })` 형태의 객체 선택자는
//   매 렌더마다 새 객체를 반환해 무한 리렌더링을 유발합니다.
//   각 필드를 `(s) => s.a` 처럼 개별 선택자로 구독해야 합니다.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from 'zustand';
import type { PhotoData, AnalysisStage, AspectRatio, Grade, FilterResult } from '../types';

/** 파이프라인 완료 후 상단에 표시되는 요약 통계 */
interface Summary {
  totalUploaded: number;  // 전체 업로드 장수
  passedFilter: number;   // 1차 필터 통과 장수
  afterDedup: number;     // 중복 제거 후 대표 사진 장수
  recommended: number;    // S+A 등급 추천 사진 장수
}

/** 스토어 전체 상태 + 액션 인터페이스 */
interface PhotoStore {
  // ── 상태 ──────────────────────────────────────────────────────────────────
  photos: Map<string, PhotoData>;      // 전체 사진 (id → PhotoData)
  stage: AnalysisStage;                // 현재 파이프라인 단계
  progress: { current: number; total: number; label: string }; // 진행률
  selectedIds: Set<string>;            // 선택된 사진 id 목록 (다운로드용)
  cropRatio: AspectRatio;              // 현재 선택된 인스타 크롭 비율
  activeGrade: Grade | 'ALL';          // 그리드 필터 탭 (ALL/S/A/B/C/D)
  summary: Summary;                    // 파이프라인 완료 후 집계

  // ── 사진 관리 액션 ────────────────────────────────────────────────────────
  addPhotos: (files: File[]) => void;                              // 파일 업로드
  updatePhoto: (id: string, updates: Partial<PhotoData>) => void; // 단일 사진 부분 업데이트
  setFilterResult: (id: string, result: FilterResult) => void;    // 1차 필터 결과 저장
  setPhash: (id: string, phash: string, groupId: string, isGroupBest: boolean) => void;
  reset: () => void;                                               // 전체 초기화 (새로 시작)

  // ── 파이프라인 상태 액션 ──────────────────────────────────────────────────
  setStage: (stage: AnalysisStage) => void;
  updateProgress: (current: number, total: number, label: string) => void;

  // ── UI 상태 액션 ──────────────────────────────────────────────────────────
  focusedId: string | null;             // 상세 패널 표시 중인 사진 id
  setFocusedId: (id: string | null) => void;
  toggleSelect: (id: string) => void;   // 사진 선택/해제 토글
  selectMany: (ids: string[]) => void;  // 여러 사진 한꺼번에 추가 선택 (드래그 선택용)
  selectAll: () => void;                // 현재 추천 사진 전체 선택
  deselectAll: () => void;              // 전체 선택 해제
  setCropRatio: (ratio: AspectRatio) => void;
  setActiveGrade: (grade: Grade | 'ALL') => void;

  // ── 파생 데이터 조회 ──────────────────────────────────────────────────────
  getRecommended: () => PhotoData[];              // 분석 완료 + 그룹 대표 사진 목록 (점수순)
  getByGrade: (grade: Grade | 'ALL') => PhotoData[];
  getSelected: () => PhotoData[];                 // 선택된 사진 목록
  recalcSummary: () => void;                      // 파이프라인 단계마다 통계 재계산
}

/** summary 초기값 */
const INITIAL_SUMMARY: Summary = {
  totalUploaded: 0,
  passedFilter: 0,
  afterDedup: 0,
  recommended: 0,
};

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  // ── 초기 상태 ──────────────────────────────────────────────────────────────
  photos: new Map(),
  stage: 'idle',
  progress: { current: 0, total: 0, label: '' },
  selectedIds: new Set(),
  focusedId: null,
  cropRatio: '4:5',         // 기본 비율: 세로 4:5 (인스타 피드 표준)
  activeGrade: 'ALL',
  summary: { ...INITIAL_SUMMARY },

  // ── 사진 관리 ──────────────────────────────────────────────────────────────

  /** 파일 배열을 받아 PhotoData Map에 추가합니다
   *  thumbnailUrl은 Object URL (URL.revokeObjectURL 호출 필요) */
  addPhotos: (files) => {
    const photos = new Map(get().photos);
    files.forEach((file) => {
      const id = crypto.randomUUID(); // 고유 ID 생성
      photos.set(id, {
        id,
        file,
        fileName: file.name,
        thumbnailUrl: URL.createObjectURL(file), // 썸네일은 createThumbnail로 교체 예정
        exif: null,
        filterResult: null,
        phash: null,
        groupId: null,
        isGroupBest: false,
        analysis: null,
      });
    });
    set({ photos, summary: { ...get().summary, totalUploaded: photos.size } });
  },

  /** 특정 사진의 일부 필드만 업데이트 (불변성 유지를 위해 Map 복사 후 변경) */
  updatePhoto: (id, updates) => {
    const photos = new Map(get().photos);
    const existing = photos.get(id);
    if (existing) photos.set(id, { ...existing, ...updates });
    set({ photos });
  },

  /** 1차 필터 결과 저장 (updatePhoto 래퍼) */
  setFilterResult: (id, result) => {
    get().updatePhoto(id, { filterResult: result });
  },

  /** 2차 중복 제거 결과 저장 (updatePhoto 래퍼) */
  setPhash: (id, phash, groupId, isGroupBest) => {
    get().updatePhoto(id, { phash, groupId, isGroupBest });
  },

  /** 전체 상태를 초기값으로 리셋 (헤더 '새로 시작' 버튼) */
  reset: () =>
    set({
      photos: new Map(),
      stage: 'idle',
      progress: { current: 0, total: 0, label: '' },
      selectedIds: new Set(),
      focusedId: null,
      summary: { ...INITIAL_SUMMARY },
    }),

  // ── 파이프라인 상태 ────────────────────────────────────────────────────────

  /** 현재 파이프라인 단계 설정 (UI의 ProgressBar가 이를 구독해 표시) */
  setStage: (stage) => set({ stage }),

  /** 작업 진행률 업데이트 (WorkerPool.execBatch 콜백에서 호출) */
  updateProgress: (current, total, label) =>
    set({ progress: { current, total, label } }),

  // ── UI 상태 ────────────────────────────────────────────────────────────────

  /** 사진 클릭 시 선택/해제 토글 */
  toggleSelect: (id) => {
    const selectedIds = new Set(get().selectedIds);
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    set({ selectedIds });
  },

  /** 현재 추천 사진(분석 완료 + 그룹 대표) 전체 선택 */
  selectAll: () => {
    const ids = new Set(get().getRecommended().map((p) => p.id));
    set({ selectedIds: ids });
  },

  deselectAll: () => set({ selectedIds: new Set() }),

  selectMany: (ids) => {
    const selectedIds = new Set(get().selectedIds);
    ids.forEach((id) => selectedIds.add(id));
    set({ selectedIds });
  },

  setFocusedId: (id) => set({ focusedId: id }),

  setCropRatio: (ratio) => set({ cropRatio: ratio }),

  setActiveGrade: (grade) => set({ activeGrade: grade }),

  // ── 파생 데이터 조회 ──────────────────────────────────────────────────────

  /** 분석 완료 + 그룹 대표 사진만 반환 (점수 내림차순 정렬)
   *  그리드와 다운로드에서 사용하는 핵심 조회 */
  getRecommended: () => {
    return Array.from(get().photos.values())
      .filter((p) => p.analysis !== null && p.isGroupBest)
      .sort((a, b) => b.analysis!.totalScore - a.analysis!.totalScore);
  },

  /** 등급 탭 필터: ALL이면 전체 추천 사진, 아니면 해당 등급만 */
  getByGrade: (grade) => {
    const all = get().getRecommended();
    if (grade === 'ALL') return all;
    return all.filter((p) => p.analysis?.grade === grade);
  },

  /** 선택된 사진 목록 반환 (ZIP 다운로드에서 사용) */
  getSelected: () => {
    const { photos, selectedIds } = get();
    return Array.from(selectedIds)
      .map((id) => photos.get(id))
      .filter((p): p is PhotoData => p !== undefined);
  },

  /** 파이프라인 각 단계 완료 후 요약 통계 재계산 */
  recalcSummary: () => {
    const photos = Array.from(get().photos.values());
    const passedFilter = photos.filter((p) => p.filterResult?.passed).length;
    const afterDedup   = photos.filter((p) => p.isGroupBest).length;
    const recommended  = photos.filter(
      (p) => p.analysis && ['S', 'A'].includes(p.analysis.grade)
    ).length;
    set({ summary: { totalUploaded: photos.length, passedFilter, afterDedup, recommended } });
  },
}));
