// src/engine/pipeline.ts
// 3단계 파이프라인 오케스트레이터 (메인 스레드에서 실행)

import { WorkerPool } from '../workers/WorkerPool';
import { usePhotoStore } from '../store/usePhotoStore';
import { clusterPhotos } from './phash';
import type {
  FilterWorkerInput,
  FilterResult,
  DedupWorkerInput,
  DedupWorkerOutput,
  AnalyzeWorkerInput,
  AnalyzeWorkerOutput,
} from '../types';

export async function runPipeline(): Promise<void> {
  const store = usePhotoStore.getState();
  const photos = Array.from(store.photos.values());

  if (photos.length === 0) return;

  // ────────────────────────────────────────────────────────
  // STAGE 1: 1차 필터 (블러 / 노출 / 피부색)
  // ────────────────────────────────────────────────────────
  store.setStage('filtering');
  const filterPool = new WorkerPool<FilterWorkerInput, FilterResult>(
    () => new Worker(new URL('../workers/filter.worker.ts', import.meta.url), { type: 'module' })
  );

  const filterInputs: FilterWorkerInput[] = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
    }))
  );

  const filterResults = await filterPool.execBatch(filterInputs, (done, total) =>
    store.updateProgress(done, total, `1단계: 불량 사진 제거 (${done}/${total})`)
  );

  filterResults.forEach((result, i) => {
    store.updatePhoto(photos[i].id, { filterResult: result });
  });
  filterPool.terminate();

  const passed = photos.filter((_, i) => filterResults[i].passed);
  store.recalcSummary();

  // ────────────────────────────────────────────────────────
  // STAGE 2: 중복 제거 (pHash 계산 + 클러스터링)
  // ────────────────────────────────────────────────────────
  store.setStage('deduping');
  const dedupPool = new WorkerPool<DedupWorkerInput, DedupWorkerOutput>(
    () => new Worker(new URL('../workers/dedup.worker.ts', import.meta.url), { type: 'module' })
  );

  const dedupInputs: DedupWorkerInput[] = await Promise.all(
    passed.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
      dateTime: p.exif?.dateTime?.getTime() ?? null,
    }))
  );

  const dedupResults = await dedupPool.execBatch(dedupInputs, (done, total) =>
    store.updateProgress(done, total, `2단계: 중복 사진 제거 (${done}/${total})`)
  );
  dedupPool.terminate();

  // pHash 저장
  const hashMap = new Map<string, string>();
  dedupResults.forEach((r) => {
    store.updatePhoto(r.id, { phash: r.phash });
    hashMap.set(r.id, r.phash);
  });

  // 클러스터링 — 그룹 내 sharpness 최고 사진이 대표
  const dedupData = passed.map((p) => ({
    id: p.id,
    phash: hashMap.get(p.id) ?? '',
    dateTime: p.exif?.dateTime?.getTime() ?? null,
  }));

  const groups = clusterPhotos(dedupData);

  groups.forEach((memberIds, groupId) => {
    // sharpness 최고인 사진을 대표로
    const members = memberIds.map((id) => store.photos.get(id)!).filter(Boolean);
    const best = members.reduce((acc, p) =>
      (p.filterResult?.sharpness ?? 0) > (acc.filterResult?.sharpness ?? 0) ? p : acc
    );
    members.forEach((p) => {
      store.updatePhoto(p.id, {
        groupId,
        isGroupBest: p.id === best.id,
      });
    });
  });

  store.recalcSummary();

  // ────────────────────────────────────────────────────────
  // STAGE 3: 정밀 분석 (MediaPipe + 구도/표정/조명/배경)
  // ────────────────────────────────────────────────────────
  store.setStage('analyzing');
  const groupBests = Array.from(store.photos.values()).filter((p) => p.isGroupBest);

  const analyzePool = new WorkerPool<AnalyzeWorkerInput, AnalyzeWorkerOutput>(
    () => new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' })
  );

  const analyzeInputs: AnalyzeWorkerInput[] = await Promise.all(
    groupBests.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
    }))
  );

  const analyzeResults = await analyzePool.execBatch(analyzeInputs, (done, total) =>
    store.updateProgress(done, total, `3단계: AI 정밀 분석 (${done}/${total})`)
  );
  analyzePool.terminate();

  analyzeResults.forEach((r) => {
    store.updatePhoto(r.id, { analysis: r.analysis });
  });

  store.recalcSummary();
  store.setStage('done');
}
