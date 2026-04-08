// src/store/usePhotoStore.ts
// Zustand 전역 상태 — Map 기반으로 1000장+ 빠른 조회

import { create } from 'zustand';
import type { PhotoData, AnalysisStage, AspectRatio, Grade, FilterResult } from '../types';

interface Summary {
  totalUploaded: number;
  passedFilter: number;
  afterDedup: number;
  recommended: number; // S+A 등급
}

interface PhotoStore {
  // ── 상태 ──────────────────────────────────────────────
  photos: Map<string, PhotoData>;
  stage: AnalysisStage;
  progress: { current: number; total: number; label: string };
  selectedIds: Set<string>;
  cropRatio: AspectRatio;
  activeGrade: Grade | 'ALL';
  summary: Summary;

  // ── 사진 관리 ──────────────────────────────────────────
  addPhotos: (files: File[]) => void;
  updatePhoto: (id: string, updates: Partial<PhotoData>) => void;
  setFilterResult: (id: string, result: FilterResult) => void;
  setPhash: (id: string, phash: string, groupId: string, isGroupBest: boolean) => void;
  reset: () => void;

  // ── 파이프라인 상태 ────────────────────────────────────
  setStage: (stage: AnalysisStage) => void;
  updateProgress: (current: number, total: number, label: string) => void;

  // ── UI 상태 ────────────────────────────────────────────
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setCropRatio: (ratio: AspectRatio) => void;
  setActiveGrade: (grade: Grade | 'ALL') => void;

  // ── 파생 조회 ──────────────────────────────────────────
  getRecommended: () => PhotoData[];           // 분석 완료 + 그룹 대표
  getByGrade: (grade: Grade | 'ALL') => PhotoData[];
  getSelected: () => PhotoData[];
  recalcSummary: () => void;
}

const INITIAL_SUMMARY: Summary = {
  totalUploaded: 0,
  passedFilter: 0,
  afterDedup: 0,
  recommended: 0,
};

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: new Map(),
  stage: 'idle',
  progress: { current: 0, total: 0, label: '' },
  selectedIds: new Set(),
  cropRatio: '4:5',
  activeGrade: 'ALL',
  summary: { ...INITIAL_SUMMARY },

  // ── 사진 관리 ──────────────────────────────────────────
  addPhotos: (files) => {
    const photos = new Map(get().photos);
    files.forEach((file) => {
      const id = crypto.randomUUID();
      photos.set(id, {
        id,
        file,
        fileName: file.name,
        thumbnailUrl: URL.createObjectURL(file), // 나중에 revoke 필요
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

  updatePhoto: (id, updates) => {
    const photos = new Map(get().photos);
    const existing = photos.get(id);
    if (existing) photos.set(id, { ...existing, ...updates });
    set({ photos });
  },

  setFilterResult: (id, result) => {
    get().updatePhoto(id, { filterResult: result });
    // TODO: passedFilter 카운트 업데이트
  },

  setPhash: (id, phash, groupId, isGroupBest) => {
    get().updatePhoto(id, { phash, groupId, isGroupBest });
  },

  reset: () =>
    set({
      photos: new Map(),
      stage: 'idle',
      progress: { current: 0, total: 0, label: '' },
      selectedIds: new Set(),
      summary: { ...INITIAL_SUMMARY },
    }),

  // ── 파이프라인 상태 ────────────────────────────────────
  setStage: (stage) => set({ stage }),

  updateProgress: (current, total, label) =>
    set({ progress: { current, total, label } }),

  // ── UI 상태 ────────────────────────────────────────────
  toggleSelect: (id) => {
    const selectedIds = new Set(get().selectedIds);
    selectedIds.has(id) ? selectedIds.delete(id) : selectedIds.add(id);
    set({ selectedIds });
  },

  selectAll: () => {
    const ids = new Set(get().getRecommended().map((p) => p.id));
    set({ selectedIds: ids });
  },

  deselectAll: () => set({ selectedIds: new Set() }),

  setCropRatio: (ratio) => set({ cropRatio: ratio }),

  setActiveGrade: (grade) => set({ activeGrade: grade }),

  // ── 파생 조회 ──────────────────────────────────────────
  getRecommended: () => {
    return Array.from(get().photos.values())
      .filter((p) => p.analysis !== null && p.isGroupBest)
      .sort((a, b) => (b.analysis!.totalScore) - (a.analysis!.totalScore));
  },

  getByGrade: (grade) => {
    const all = get().getRecommended();
    if (grade === 'ALL') return all;
    return all.filter((p) => p.analysis?.grade === grade);
  },

  getSelected: () => {
    const { photos, selectedIds } = get();
    return Array.from(selectedIds)
      .map((id) => photos.get(id))
      .filter((p): p is PhotoData => p !== undefined);
  },

  recalcSummary: () => {
    const photos = Array.from(get().photos.values());
    const passedFilter = photos.filter((p) => p.filterResult?.passed).length;
    const afterDedup = photos.filter((p) => p.isGroupBest).length;
    const recommended = photos.filter(
      (p) => p.analysis && ['S', 'A'].includes(p.analysis.grade)
    ).length;
    set({ summary: { totalUploaded: photos.length, passedFilter, afterDedup, recommended } });
  },
}));
