// src/engine/pipeline.ts
// ─────────────────────────────────────────────────────────────────────────────
// 3단계 분석 파이프라인 오케스트레이터 (메인 스레드에서 실행)
//
// 전체 흐름:
//   STAGE 1 (filtering)  : 블러·노출·인물 없는 사진을 WorkerPool로 병렬 제거
//   STAGE 2 (deduping)   : pHash로 유사 사진을 클러스터링, 그룹당 최선 1장 선택
//   STAGE 3 (analyzing)  : 그룹 대표 사진만 정밀 분석 → 절대 점수 + 등급 부여
//
// 주의: 비동기 파이프라인에서 Zustand 스토어의 최신 상태를 읽으려면
//       getStore() 헬퍼를 매 단계마다 호출해야 합니다 (캐싱 금지).
// ─────────────────────────────────────────────────────────────────────────────

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

// 매 단계마다 최신 Zustand 상태를 가져오는 헬퍼
// (직접 getState()를 호출하면 오래된 클로저 참조 문제를 피할 수 있음)
const getStore = () => usePhotoStore.getState();

/** 전체 분석 파이프라인 실행 (업로드 직후 UploadZone에서 호출) */
export async function runPipeline(): Promise<void> {
  const photos = Array.from(getStore().photos.values());
  if (photos.length === 0) return; // 사진이 없으면 즉시 종료

  // ════════════════════════════════════════════════════════
  // STAGE 1: 1차 필터 — 불량 사진 제거
  //   대상: 전체 업로드 사진
  //   판정: 블러(Laplacian ≥50) + 노출 정상 + 인물 있음
  //   Worker 해상도: 320×240 (빠른 처리 우선)
  // ════════════════════════════════════════════════════════
  getStore().setStage('filtering');

  // CPU 코어 수만큼 filter.worker 를 동시에 실행하는 풀 생성
  const filterPool = new WorkerPool<FilterWorkerInput, FilterResult>(
    () => new Worker(new URL('../workers/filter.worker.ts', import.meta.url), { type: 'module' })
  );

  // 각 사진의 File → ArrayBuffer 변환 (Worker로 Transferable 전송)
  const filterInputs: FilterWorkerInput[] = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
    }))
  );

  // 병렬 실행 — 완료할 때마다 진행률 UI 업데이트
  const filterResults = await filterPool.execBatch(filterInputs, (done, total) =>
    getStore().updateProgress(done, total, `1단계: 불량 사진 제거 (${done}/${total})`)
  );
  filterPool.terminate(); // Worker 메모리 해제

  // 각 사진에 필터 결과 저장
  filterResults.forEach((result, i) => {
    getStore().updatePhoto(photos[i].id, { filterResult: result });
  });
  getStore().recalcSummary();

  // 통과한 사진만 추려 다음 단계로 진행
  const passed = photos.filter((_, i) => filterResults[i].passed);
  if (passed.length === 0) {
    getStore().setStage('done'); // 아무것도 통과 못하면 조기 종료
    return;
  }

  // ════════════════════════════════════════════════════════
  // STAGE 2: 중복 제거 — pHash 계산 + 클러스터링
  //   각 사진의 퍼셉추얼 해시(pHash)를 계산한 후,
  //   해밍 거리 ≤10 이거나 촬영 시각 차이 ≤30초인 사진끼리 같은 그룹으로 묶습니다.
  //   각 그룹에서 Laplacian 분산(선명도)이 가장 높은 1장만 isGroupBest=true 로 설정합니다.
  //   Worker 해상도: 32×32 (pHash는 저해상도로 충분)
  // ════════════════════════════════════════════════════════
  getStore().setStage('deduping');

  const dedupPool = new WorkerPool<DedupWorkerInput, DedupWorkerOutput>(
    () => new Worker(new URL('../workers/dedup.worker.ts', import.meta.url), { type: 'module' })
  );

  const dedupInputs: DedupWorkerInput[] = await Promise.all(
    passed.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
      dateTime: p.exif?.dateTime?.getTime() ?? null, // 촬영 시각 (시간 유사도 비교용)
    }))
  );

  const dedupResults = await dedupPool.execBatch(dedupInputs, (done, total) =>
    getStore().updateProgress(done, total, `2단계: 중복 사진 제거 (${done}/${total})`)
  );
  dedupPool.terminate();

  // 각 사진에 pHash 저장 + id→hash 맵 구성
  const hashMap = new Map<string, string>();
  dedupResults.forEach((r) => {
    getStore().updatePhoto(r.id, { phash: r.phash });
    hashMap.set(r.id, r.phash);
  });

  // clusterPhotos: pHash 해밍 거리 + 시간 유사도 기반 그룹 클러스터링
  const dedupData = passed.map((p) => ({
    id: p.id,
    phash: hashMap.get(p.id) ?? '',
    dateTime: p.exif?.dateTime?.getTime() ?? null,
  }));
  const groups = clusterPhotos(dedupData);

  // 각 그룹에서 선명도(sharpness) 최고 사진 1장을 isGroupBest=true 로 표시
  groups.forEach((memberIds, groupId) => {
    const currentPhotos = getStore().photos; // 최신 상태 재조회 (중요!)
    const members = memberIds.map((id) => currentPhotos.get(id)!).filter(Boolean);
    const best = members.reduce((acc, p) =>
      (p.filterResult?.sharpness ?? 0) > (acc.filterResult?.sharpness ?? 0) ? p : acc
    );
    members.forEach((p) => {
      getStore().updatePhoto(p.id, {
        groupId,
        isGroupBest: p.id === best.id, // 그룹 대표만 true
      });
    });
  });

  getStore().recalcSummary();

  // ════════════════════════════════════════════════════════
  // STAGE 3: 정밀 분석 — 필터 통과 전체 사진에 5가지 지표 점수 부여
  //   대상: 필터(Stage 1)를 통과한 모든 사진
  //         (그룹 대표뿐 아니라 중복 그룹 내 모든 사진도 분석)
  //   지표: 화질(30%) + 표정(25%) + 구도(20%) + 조명(15%) + 배경(10%)
  //   Worker 해상도: 640×640
  //
  //   ※ 분석 완료 후 그룹별로 totalScore 가 가장 높은 사진을 isGroupBest=true 로
  //     재결정합니다. 선명도(sharpness)만으로 뽑은 임시 대표를 실제 점수로 교체.
  // ════════════════════════════════════════════════════════
  getStore().setStage('analyzing');

  const analyzePool = new WorkerPool<AnalyzeWorkerInput, AnalyzeWorkerOutput>(
    () => new Worker(new URL('../workers/analyze.worker.ts', import.meta.url), { type: 'module' })
  );

  // 필터 통과 전체 사진을 분석 대상으로 삼습니다 (groupBests 제한 없음)
  const analyzeInputs: AnalyzeWorkerInput[] = await Promise.all(
    passed.map(async (p) => ({
      id: p.id,
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
    }))
  );

  const analyzeResults = await analyzePool.execBatch(analyzeInputs, (done, total) =>
    getStore().updateProgress(done, total, `3단계: AI 정밀 분석 (${done}/${total})`)
  );
  analyzePool.terminate();

  // 분석 결과를 각 사진에 저장 (grade, totalScore, faceData 등)
  analyzeResults.forEach((r) => {
    getStore().updatePhoto(r.id, { analysis: r.analysis });
  });

  // ── isGroupBest 재결정: 그룹 내 totalScore 최고 사진으로 교체 ────────────
  // Stage 2에서 sharpness 기준으로 임시 결정했던 그룹 대표를
  // 실제 AI 분석 점수(totalScore) 기준으로 다시 결정합니다.
  // 예: 약간 덜 선명하지만 눈을 잘 뜨고 구도가 좋은 사진이 대표가 됩니다.
  const groupMap = new Map<string, string[]>(); // groupId → 멤버 id 목록
  Array.from(getStore().photos.values())
    .filter((p) => p.groupId !== undefined)
    .forEach((p) => {
      const gid = p.groupId!;
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid)!.push(p.id);
    });

  groupMap.forEach((memberIds) => {
    const currentPhotos = getStore().photos;
    const members = memberIds.map((id) => currentPhotos.get(id)!).filter(Boolean);

    // totalScore 기준 최고 사진 선택 (분석 결과 없는 사진은 0점으로 처리)
    const best = members.reduce((acc, p) =>
      (p.analysis?.totalScore ?? 0) > (acc.analysis?.totalScore ?? 0) ? p : acc
    );

    // 그룹 내 모든 사진의 isGroupBest 갱신
    members.forEach((p) => {
      getStore().updatePhoto(p.id, { isGroupBest: p.id === best.id });
    });
  });

  getStore().recalcSummary();
  getStore().setStage('done'); // 파이프라인 완료 → UI에 결과 표시
}
