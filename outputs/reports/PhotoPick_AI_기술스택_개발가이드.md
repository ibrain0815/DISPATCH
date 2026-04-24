# PhotoPick AI — 기술 스택 & 개발 방법 가이드

> 1000장+ 대량 사진에서 인스타 베스트샷을 자동 선별하는 웹 앱을 만들기 위한 실전 개발 가이드

---

## 목차

1. [전체 기술 스택 맵](#1-전체-기술-스택-맵)
2. [개발 환경 세팅](#2-개발-환경-세팅)
3. [프론트엔드 개발](#3-프론트엔드-개발)
4. [AI/이미지 처리 엔진](#4-ai이미지-처리-엔진)
5. [Web Worker 병렬 처리](#5-web-worker-병렬-처리)
6. [각 분석 모듈 구현 방법](#6-각-분석-모듈-구현-방법)
7. [인스타 크롭 & 다운로드 구현](#7-인스타-크롭--다운로드-구현)
8. [성능 최적화 테크닉](#8-성능-최적화-테크닉)
9. [배포 방법](#9-배포-방법)
10. [학습 로드맵](#10-학습-로드맵)

---

## 1. 전체 기술 스택 맵

```
┌──────────────────────────────────────────────────────────────┐
│                        사용자 브라우저                         │
│                                                              │
│  ┌─── UI 레이어 ───────────────────────────────────────────┐ │
│  │  React 18 + TypeScript + Tailwind CSS + Zustand         │ │
│  │  · 업로드 UI, 결과 그리드, 크롭 미리보기, 차트          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                          ↕                                    │
│  ┌─── AI 엔진 레이어 (Web Worker에서 실행) ────────────────┐ │
│  │  MediaPipe Face Mesh (WASM) — 얼굴 468개 랜드마크       │ │
│  │  MediaPipe Pose (WASM) — 신체 33개 키포인트              │ │
│  │  TensorFlow.js (WebGL/WASM) — 행렬연산, 이미지분석      │ │
│  │  BodyPix (WASM) — 배경 분리                             │ │
│  └─────────────────────────────────────────────────────────┘ │
│                          ↕                                    │
│  ┌─── 유틸리티 레이어 ─────────────────────────────────────┐ │
│  │  exifr — EXIF 메타데이터 파싱                            │ │
│  │  phash-wasm — 퍼셉추얼 해시 (중복 감지)                  │ │
│  │  fflate — ZIP 압축 (배치 다운로드)                       │ │
│  │  OffscreenCanvas — Worker에서 이미지 처리                │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                          ↕ (정적 파일만)
┌──────────────────────────────────────────────────────────────┐
│  Vercel / Netlify — 정적 호스팅 (서버리스)                    │
│  Cloudflare CDN — WASM 모델 파일 캐싱                        │
└──────────────────────────────────────────────────────────────┘
```

### 스택 요약 (전체 11개 핵심 라이브러리)

| 카테고리 | 라이브러리 | 역할 | 크기 |
|---|---|---|---|
| **UI** | React 18 | 컴포넌트 기반 UI | ~45KB |
| **UI** | TypeScript | 타입 안전성 | 빌드타임만 |
| **UI** | Tailwind CSS | 유틸리티 CSS | ~10KB |
| **상태** | Zustand | 전역 상태 관리 (1000장 데이터) | ~1KB |
| **AI** | @mediapipe/face_mesh | 얼굴 랜드마크 검출 | ~4MB (WASM) |
| **AI** | @mediapipe/pose | 신체 키포인트 검출 | ~3MB (WASM) |
| **AI** | @tensorflow/tfjs | 텐서 연산 (Laplacian 등) | ~1.5MB |
| **AI** | @tensorflow-models/body-pix | 배경 분리 | ~2MB |
| **유틸** | exifr | EXIF 데이터 파싱 | ~40KB |
| **유틸** | phash-wasm | 퍼셉추얼 해시 | ~50KB |
| **유틸** | fflate | ZIP 압축/해제 | ~28KB |

---

## 2. 개발 환경 세팅

### 2.1 필수 도구 설치

```bash
# Node.js 20 LTS 설치 (nvm 사용 권장)
nvm install 20
nvm use 20

# 프로젝트 생성 (Vite + React + TypeScript)
npm create vite@latest photopick-ai -- --template react-ts

cd photopick-ai
```

### 2.2 핵심 패키지 설치

```bash
# UI & 상태관리
npm install zustand
npm install -D tailwindcss @tailwindcss/vite

# AI / 이미지 처리
npm install @mediapipe/face_mesh
npm install @mediapipe/pose
npm install @tensorflow/tfjs
npm install @tensorflow-models/body-pix

# 유틸리티
npm install exifr
npm install fflate
npm install recharts

# 개발 도구
npm install -D @types/node
```

> **phash-wasm 참고:** 이 라이브러리는 npm에 다양한 이름으로 존재한다. `blockhash-core`, `imghash` 등의 대안도 있으며, 직접 DCT 기반 pHash를 구현하는 것도 가능하다 (7장에서 코드 제공).

### 2.3 프로젝트 폴더 구조

```
photopick-ai/
├── public/
│   └── models/              ← MediaPipe WASM 모델 파일
│       ├── face_mesh/
│       └── pose/
├── src/
│   ├── components/          ← React UI 컴포넌트
│   │   ├── UploadZone.tsx       드래그 앤 드롭 업로드
│   │   ├── ProgressBar.tsx      분석 진행률
│   │   ├── PhotoGrid.tsx        추천 결과 그리드
│   │   ├── PhotoDetail.tsx      상세 분석 보기
│   │   ├── CropPreview.tsx      인스타 크롭 미리보기
│   │   └── ScoreChart.tsx       점수 레이더 차트
│   │
│   ├── workers/             ← Web Worker (AI 엔진)
│   │   ├── filter.worker.ts     1차 필터 (블러/노출/얼굴)
│   │   ├── dedup.worker.ts      2차 중복 제거 (pHash)
│   │   └── analyze.worker.ts    3차 정밀 분석
│   │
│   ├── engine/              ← 분석 알고리즘
│   │   ├── blur.ts              블러 감지 (Laplacian)
│   │   ├── exposure.ts          노출 분석 (히스토그램)
│   │   ├── face.ts              얼굴 검출 래퍼
│   │   ├── composition.ts       구도 분석 (삼분법 등)
│   │   ├── expression.ts        표정 분석 (EAR, 미소)
│   │   ├── lighting.ts          조명 분석
│   │   ├── background.ts        배경 분석
│   │   ├── phash.ts             퍼셉추얼 해시
│   │   └── scorer.ts            종합 점수 산출
│   │
│   ├── utils/               ← 유틸리티
│   │   ├── imageLoader.ts       이미지 로드/리사이즈
│   │   ├── exif.ts              EXIF 파싱 래퍼
│   │   ├── crop.ts              스마트 크롭 로직
│   │   └── zip.ts               ZIP 다운로드
│   │
│   ├── store/               ← Zustand 상태 관리
│   │   └── usePhotoStore.ts     사진 목록, 분석 결과, UI 상태
│   │
│   ├── types/               ← TypeScript 타입 정의
│   │   └── index.ts
│   │
│   ├── App.tsx
│   └── main.tsx
│
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

### 2.4 Vite 설정 (Web Worker + WASM 지원)

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',       // Web Worker ES 모듈 지원
  },
  optimizeDeps: {
    exclude: ['@mediapipe/face_mesh', '@mediapipe/pose'],
  },
  build: {
    target: 'esnext',   // WASM, Top-level await 지원
  },
});
```

---

## 3. 프론트엔드 개발

### 3.1 TypeScript 타입 정의

모든 데이터 구조를 먼저 정의한다. 이것이 프로젝트의 뼈대가 된다.

```typescript
// src/types/index.ts

/** 분석 파이프라인 단계 */
export type AnalysisStage = 'idle' | 'filtering' | 'deduping' | 'analyzing' | 'done';

/** 등급 */
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

/** 인스타 크롭 비율 */
export type AspectRatio = '1:1' | '4:5' | '1.91:1' | '9:16';

/** 개별 사진 데이터 */
export interface PhotoData {
  id: string;                    // 고유 ID (uuid)
  file: File;                    // 원본 파일 참조
  fileName: string;
  thumbnailUrl: string;          // 미리보기용 Object URL
  exif: ExifData | null;

  // 1차 필터 결과
  filterResult: {
    passed: boolean;
    sharpness: number;           // Laplacian 분산값
    brightness: number;          // 평균 밝기
    hasFace: boolean;
    faceSize: number;            // 사진 대비 얼굴 크기 비율
    rejectReason?: string;       // 탈락 사유
  } | null;

  // 2차 중복 제거
  phash: string | null;          // 64bit 퍼셉추얼 해시
  groupId: string | null;        // 유사 사진 그룹 ID
  isGroupBest: boolean;          // 그룹 내 베스트 여부

  // 3차 정밀 분석 결과
  analysis: DetailedAnalysis | null;
}

/** 정밀 분석 결과 */
export interface DetailedAnalysis {
  compositionScore: number;      // 구도 0~100
  expressionScore: number;       // 표정 0~100
  qualityScore: number;          // 화질 0~100
  lightingScore: number;         // 조명 0~100
  backgroundScore: number;       // 배경 0~100
  totalScore: number;            // 종합 0~100
  grade: Grade;
  penalties: Penalty[];          // 감점 요소 목록
  tips: string[];                // 개선 포인트
  faceData: FaceData;            // 얼굴 정보 (크롭용)
}

/** 얼굴 정보 */
export interface FaceData {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  yaw: number;                   // 좌우 회전각
  pitch: number;                 // 상하 회전각
  eyeAspectRatio: number;        // 눈 뜨임 정도
  smileScore: number;            // 미소 점수
}

/** 감점 요소 */
export interface Penalty {
  type: 'eyes_closed' | 'mouth_open' | 'double_chin' | 'half_blink' | 'tilted';
  score: number;                 // 감점 점수 (음수)
  description: string;
}

/** EXIF 데이터 */
export interface ExifData {
  dateTime: Date | null;
  camera: string;
  focalLength: number | null;
  iso: number | null;
  gps: { lat: number; lng: number } | null;
}
```

### 3.2 Zustand 상태 관리

1000장 이상의 데이터를 효율적으로 관리하기 위한 전역 스토어:

```typescript
// src/store/usePhotoStore.ts
import { create } from 'zustand';
import type { PhotoData, AnalysisStage, AspectRatio } from '../types';

interface PhotoStore {
  // 상태
  photos: Map<string, PhotoData>;  // Map이 배열보다 ID 조회가 빠름
  stage: AnalysisStage;
  progress: { current: number; total: number; stage: string };
  selectedIds: Set<string>;
  cropRatio: AspectRatio;

  // 파이프라인 결과 요약
  summary: {
    totalUploaded: number;
    passedFilter: number;
    afterDedup: number;
    recommended: number;
  };

  // 액션
  addPhotos: (files: File[]) => void;
  updatePhoto: (id: string, updates: Partial<PhotoData>) => void;
  setStage: (stage: AnalysisStage) => void;
  updateProgress: (current: number, total: number, stage: string) => void;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setCropRatio: (ratio: AspectRatio) => void;

  // 계산된 값
  getRecommended: () => PhotoData[];
  getByGrade: (grade: string) => PhotoData[];
}

export const usePhotoStore = create<PhotoStore>((set, get) => ({
  photos: new Map(),
  stage: 'idle',
  progress: { current: 0, total: 0, stage: '' },
  selectedIds: new Set(),
  cropRatio: '4:5',
  summary: { totalUploaded: 0, passedFilter: 0, afterDedup: 0, recommended: 0 },

  addPhotos: (files) => {
    const photos = new Map(get().photos);
    files.forEach(file => {
      const id = crypto.randomUUID();
      photos.set(id, {
        id, file, fileName: file.name,
        thumbnailUrl: '',
        exif: null, filterResult: null,
        phash: null, groupId: null, isGroupBest: false,
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

  setStage: (stage) => set({ stage }),
  updateProgress: (current, total, stage) => set({ progress: { current, total, stage } }),
  toggleSelect: (id) => {
    const selected = new Set(get().selectedIds);
    selected.has(id) ? selected.delete(id) : selected.add(id);
    set({ selectedIds: selected });
  },
  selectAll: () => {
    const ids = new Set(get().getRecommended().map(p => p.id));
    set({ selectedIds: ids });
  },
  deselectAll: () => set({ selectedIds: new Set() }),
  setCropRatio: (ratio) => set({ cropRatio: ratio }),

  getRecommended: () => {
    const photos = Array.from(get().photos.values());
    return photos
      .filter(p => p.analysis && p.isGroupBest)
      .sort((a, b) => (b.analysis?.totalScore ?? 0) - (a.analysis?.totalScore ?? 0));
  },

  getByGrade: (grade) => {
    return get().getRecommended().filter(p => p.analysis?.grade === grade);
  },
}));
```

### 3.3 업로드 컴포넌트 (폴더 드래그 앤 드롭)

```typescript
// src/components/UploadZone.tsx
import { useCallback } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';

export function UploadZone() {
  const addPhotos = usePhotoStore(s => s.addPhotos);
  const stage = usePhotoStore(s => s.stage);

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const items = e.dataTransfer.items;
    const files: File[] = [];

    // 폴더 내 파일 재귀 수집
    const readEntries = async (entry: FileSystemDirectoryEntry): Promise<File[]> => {
      const reader = entry.createReader();
      const entries = await new Promise<FileSystemEntry[]>((resolve) => {
        reader.readEntries(resolve);
      });

      const results: File[] = [];
      for (const e of entries) {
        if (e.isFile) {
          const file = await new Promise<File>((resolve) => {
            (e as FileSystemFileEntry).file(resolve);
          });
          if (IMAGE_TYPES.includes(file.type)) results.push(file);
        } else if (e.isDirectory) {
          results.push(...await readEntries(e as FileSystemDirectoryEntry));
        }
      }
      return results;
    };

    // 드래그된 아이템 처리
    (async () => {
      for (const item of Array.from(items)) {
        const entry = item.webkitGetAsEntry();
        if (entry?.isDirectory) {
          files.push(...await readEntries(entry as FileSystemDirectoryEntry));
        } else if (entry?.isFile) {
          const file = item.getAsFile();
          if (file && IMAGE_TYPES.includes(file.type)) files.push(file);
        }
      }
      if (files.length > 0) addPhotos(files);
    })();
  }, [addPhotos]);

  if (stage !== 'idle') return null;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      className="border-2 border-dashed border-gray-300 rounded-2xl p-16
                 text-center cursor-pointer hover:border-blue-400
                 hover:bg-blue-50 transition-colors"
    >
      <p className="text-2xl mb-2">📁 폴더를 여기에 드래그하세요</p>
      <p className="text-gray-500">JPG, PNG, HEIC | 최대 5000장</p>
    </div>
  );
}
```

---

## 4. AI/이미지 처리 엔진

### 4.1 이미지 로드 & 리사이즈 유틸리티

모든 분석의 기초가 되는 이미지 로딩. 메모리 관리를 위해 단계별로 다른 해상도를 사용한다.

```typescript
// src/utils/imageLoader.ts

/** 이미지를 지정 크기로 리사이즈하여 ImageData로 반환 */
export async function loadAndResize(
  file: File,
  maxWidth: number,
  maxHeight: number
): Promise<{ imageData: ImageData; originalWidth: number; originalHeight: number }> {
  // 1. File → ImageBitmap (메모리 효율적)
  const bitmap = await createImageBitmap(file);
  const { width: ow, height: oh } = bitmap;

  // 2. 비율 유지 리사이즈
  const scale = Math.min(maxWidth / ow, maxHeight / oh, 1);
  const w = Math.round(ow * scale);
  const h = Math.round(oh * scale);

  // 3. OffscreenCanvas로 렌더링 (Worker에서도 사용 가능)
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close(); // 메모리 해제

  return {
    imageData: ctx.getImageData(0, 0, w, h),
    originalWidth: ow,
    originalHeight: oh,
  };
}

/** ImageData에서 그레이스케일 배열 추출 */
export function toGrayscale(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    const j = i * 4;
    gray[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return gray;
}

/** 히스토그램 계산 */
export function computeHistogram(gray: Float32Array): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.round(gray[i])]++;
  }
  return hist;
}
```

### 4.2 EXIF 파싱

```typescript
// src/utils/exif.ts
import exifr from 'exifr';
import type { ExifData } from '../types';

export async function parseExif(file: File): Promise<ExifData | null> {
  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'Make', 'Model', 'FocalLength', 'ISO', 'GPSLatitude', 'GPSLongitude'],
    });
    if (!data) return null;

    return {
      dateTime: data.DateTimeOriginal ? new Date(data.DateTimeOriginal) : null,
      camera: [data.Make, data.Model].filter(Boolean).join(' '),
      focalLength: data.FocalLength ?? null,
      iso: data.ISO ?? null,
      gps: data.GPSLatitude && data.GPSLongitude
        ? { lat: data.GPSLatitude, lng: data.GPSLongitude }
        : null,
    };
  } catch {
    return null;
  }
}
```

---

## 5. Web Worker 병렬 처리

### 5.1 Worker 아키텍처

이 프로젝트의 성능 핵심은 Web Worker다. 메인 스레드는 UI만 담당하고, 무거운 AI 연산은 전부 Worker에서 실행한다.

```
메인 스레드 (React UI)
  │
  ├── postMessage(files) ──→  filter.worker.ts (1차 필터)
  │   ← onmessage(결과)        · 블러 감지
  │                             · 노출 체크
  │                             · 얼굴 유무
  │
  ├── postMessage(hashes) ──→  dedup.worker.ts (2차 중복제거)
  │   ← onmessage(그룹)        · pHash 계산
  │                             · 시간 그룹핑
  │                             · 클러스터링
  │
  └── postMessage(photos) ──→  analyze.worker.ts (3차 정밀분석)
      ← onmessage(점수)        · 구도 분석
                                · 표정 분석
                                · 조명/배경 분석
```

### 5.2 Worker 풀 매니저

코어 수에 맞게 Worker를 자동 생성하고 작업을 분배하는 매니저:

```typescript
// src/workers/WorkerPool.ts

export class WorkerPool<TInput, TOutput> {
  private workers: Worker[] = [];
  private queue: Array<{
    data: TInput;
    resolve: (result: TOutput) => void;
    reject: (error: Error) => void;
  }> = [];
  private activeWorkers = 0;

  constructor(
    private createWorker: () => Worker,
    private poolSize: number = navigator.hardwareConcurrency || 4
  ) {
    // Worker 인스턴스 미리 생성
    for (let i = 0; i < this.poolSize; i++) {
      const worker = this.createWorker();
      this.workers.push(worker);
    }
  }

  /** 단일 작업 실행 */
  exec(data: TInput): Promise<TOutput> {
    return new Promise((resolve, reject) => {
      this.queue.push({ data, resolve, reject });
      this.processQueue();
    });
  }

  /** 배치 실행 + 진행률 콜백 */
  async execBatch(
    items: TInput[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<TOutput[]> {
    let completed = 0;
    const results = await Promise.all(
      items.map(item =>
        this.exec(item).then(result => {
          completed++;
          onProgress?.(completed, items.length);
          return result;
        })
      )
    );
    return results;
  }

  private processQueue() {
    while (this.queue.length > 0 && this.activeWorkers < this.poolSize) {
      const task = this.queue.shift()!;
      const workerIndex = this.activeWorkers;
      this.activeWorkers++;

      const worker = this.workers[workerIndex];
      worker.onmessage = (e: MessageEvent<TOutput>) => {
        this.activeWorkers--;
        task.resolve(e.data);
        this.processQueue();
      };
      worker.onerror = (e) => {
        this.activeWorkers--;
        task.reject(new Error(e.message));
        this.processQueue();
      };
      worker.postMessage(task.data);
    }
  }

  /** 모든 Worker 종료 */
  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
  }
}
```

### 5.3 1차 필터 Worker 구현

```typescript
// src/workers/filter.worker.ts

import { loadAndResize, toGrayscale, computeHistogram } from '../utils/imageLoader';

// Laplacian 커널을 이용한 블러 감지
function computeLaplacianVariance(gray: Float32Array, width: number, height: number): number {
  // Laplacian 커널: [0,1,0], [1,-4,1], [0,1,0]
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        gray[idx - width] +
        gray[idx - 1] + gray[idx + 1] +
        gray[idx + width] -
        4 * gray[idx];

      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  const mean = sum / count;
  return sumSq / count - mean * mean; // 분산
}

self.onmessage = async (e: MessageEvent<{ fileBuffer: ArrayBuffer; fileName: string }>) => {
  const { fileBuffer, fileName } = e.data;
  const file = new File([fileBuffer], fileName);

  try {
    // 320×240으로 리사이즈 (빠른 처리)
    const { imageData } = await loadAndResize(file, 320, 240);
    const gray = toGrayscale(imageData);
    const histogram = computeHistogram(gray);

    // 1. 블러 감지
    const sharpness = computeLaplacianVariance(gray, imageData.width, imageData.height);

    // 2. 노출 체크
    const totalPixels = gray.length;
    let brightnessSum = 0;
    for (let i = 0; i < gray.length; i++) brightnessSum += gray[i];
    const brightness = brightnessSum / totalPixels;

    // 3. 얼굴 유무 (간이 체크 — 피부색 비율)
    const { data } = imageData;
    let skinPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // 간단한 피부색 범위 (RGB)
      if (r > 95 && g > 40 && b > 20 && r > g && r > b &&
          Math.abs(r - g) > 15 && r - b > 15) {
        skinPixels++;
      }
    }
    const skinRatio = skinPixels / totalPixels;

    // 합격 판정
    const passed = sharpness >= 50 && brightness >= 40 && brightness <= 230 && skinRatio > 0.05;

    let rejectReason: string | undefined;
    if (sharpness < 50) rejectReason = '흔들린 사진';
    else if (brightness < 40) rejectReason = '너무 어두움';
    else if (brightness > 230) rejectReason = '너무 밝음 (화이트아웃)';
    else if (skinRatio <= 0.05) rejectReason = '인물 없음';

    self.postMessage({
      passed,
      sharpness,
      brightness,
      hasFace: skinRatio > 0.05,
      faceSize: skinRatio,
      rejectReason,
    });
  } catch (err) {
    self.postMessage({
      passed: false,
      sharpness: 0,
      brightness: 0,
      hasFace: false,
      faceSize: 0,
      rejectReason: '파일 읽기 실패',
    });
  }
};
```

### 5.4 메인 스레드에서 파이프라인 실행

```typescript
// src/engine/pipeline.ts
import { WorkerPool } from '../workers/WorkerPool';
import { usePhotoStore } from '../store/usePhotoStore';

export async function runPipeline() {
  const store = usePhotoStore.getState();
  const photos = Array.from(store.photos.values());

  // ─── 1단계: 1차 필터 ───
  store.setStage('filtering');
  const filterPool = new WorkerPool<any, any>(
    () => new Worker(new URL('../workers/filter.worker.ts', import.meta.url), { type: 'module' })
  );

  const filterInputs = await Promise.all(
    photos.map(async (p) => ({
      fileBuffer: await p.file.arrayBuffer(),
      fileName: p.fileName,
      id: p.id,
    }))
  );

  const filterResults = await filterPool.execBatch(
    filterInputs,
    (done, total) => store.updateProgress(done, total, '1차 필터: 불량 사진 제거')
  );

  // 결과 저장 & 통과한 사진만 추림
  filterResults.forEach((result, i) => {
    store.updatePhoto(photos[i].id, { filterResult: result });
  });
  filterPool.terminate();

  const passed = photos.filter((_, i) => filterResults[i].passed);
  store.summary.passedFilter = passed.length;

  // ─── 2단계: 중복 제거 ───
  store.setStage('deduping');
  // ... (dedup.worker.ts 호출)

  // ─── 3단계: 정밀 분석 ───
  store.setStage('analyzing');
  // ... (analyze.worker.ts 호출)

  store.setStage('done');
}
```

---

## 6. 각 분석 모듈 구현 방법

### 6.1 구도 분석 — 삼분법

```typescript
// src/engine/composition.ts

interface Point { x: number; y: number; }

/** 삼분법 점수 (0~100) */
export function ruleOfThirds(
  faceCenter: Point,
  imageWidth: number,
  imageHeight: number
): number {
  // 4개 Power Points
  const thirdX = imageWidth / 3;
  const thirdY = imageHeight / 3;
  const powerPoints: Point[] = [
    { x: thirdX, y: thirdY },
    { x: thirdX * 2, y: thirdY },
    { x: thirdX, y: thirdY * 2 },
    { x: thirdX * 2, y: thirdY * 2 },
  ];

  // 가장 가까운 교차점까지 거리
  const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
  const minDist = Math.min(
    ...powerPoints.map(p =>
      Math.sqrt((faceCenter.x - p.x) ** 2 + (faceCenter.y - p.y) ** 2)
    )
  );

  const normalized = minDist / diagonal;
  return Math.max(0, Math.round(100 - normalized * 200));
}

/** 시선 방향 여백 점수 (0~100) */
export function gazeDirection(
  faceCenter: Point,
  yaw: number,          // 양수 = 오른쪽 봄, 음수 = 왼쪽 봄
  imageWidth: number
): number {
  // 시선 앞 여백 비율 계산
  let gazeSpace: number;
  if (yaw > 5) {
    // 오른쪽을 봄 → 오른쪽 여백이 넓어야 함
    gazeSpace = (imageWidth - faceCenter.x) / imageWidth;
  } else if (yaw < -5) {
    // 왼쪽을 봄 → 왼쪽 여백이 넓어야 함
    gazeSpace = faceCenter.x / imageWidth;
  } else {
    // 정면 → 중앙에 있으면 OK
    gazeSpace = 0.5;
  }

  // 40~60% 여백이 최적
  const deviation = Math.abs(gazeSpace - 0.5);
  return Math.max(0, Math.round(100 - deviation * 200));
}

/** 헤드룸 점수 (0~100) */
export function headroom(
  faceBBox: { y: number; height: number },
  imageHeight: number
): number {
  const topSpace = faceBBox.y / imageHeight;

  // 5~15%가 최적
  if (topSpace >= 0.05 && topSpace <= 0.15) return 100;
  if (topSpace < 0.02 || topSpace > 0.30) return 0;

  // 최적 범위에서 벗어난 정도에 따라 감점
  const optimalCenter = 0.10;
  const deviation = Math.abs(topSpace - optimalCenter);
  return Math.max(0, Math.round(100 - deviation * 500));
}

/** 수평 기울기 점수 (0~100) */
export function tiltScore(
  leftEye: Point,
  rightEye: Point
): number {
  const deltaY = rightEye.y - leftEye.y;
  const deltaX = rightEye.x - leftEye.x;
  const angleDeg = Math.abs(Math.atan2(deltaY, deltaX) * (180 / Math.PI));

  // 0도가 완벽한 수평 (±2도 허용)
  if (angleDeg <= 2) return 100;
  if (angleDeg >= 15) return 0;
  return Math.max(0, Math.round(100 - (angleDeg - 2) * (100 / 13)));
}
```

### 6.2 표정 분석 — 눈 뜨임 & 미소

```typescript
// src/engine/expression.ts

import type { Penalty } from '../types';

/** EAR (Eye Aspect Ratio) 계산
 *  landmarks: MediaPipe Face Mesh의 눈 관련 랜드마크 인덱스
 *  왼눈: [33, 160, 158, 133, 153, 144]
 *  오른눈: [362, 385, 387, 263, 373, 380]
 */
export function calculateEAR(
  landmarks: Array<{ x: number; y: number; z: number }>,
  eyeIndices: number[]
): number {
  const [p1, p2, p3, p4, p5, p6] = eyeIndices.map(i => landmarks[i]);

  // 수직 거리 2개
  const v1 = Math.sqrt((p2.x - p6.x) ** 2 + (p2.y - p6.y) ** 2);
  const v2 = Math.sqrt((p3.x - p5.x) ** 2 + (p3.y - p5.y) ** 2);
  // 수평 거리 1개
  const h = Math.sqrt((p1.x - p4.x) ** 2 + (p1.y - p4.y) ** 2);

  return (v1 + v2) / (2.0 * h);
}

/** 미소 점수 계산
 *  입꼬리(61, 291)와 입 중앙(13, 14) 랜드마크 활용
 */
export function smileScore(
  landmarks: Array<{ x: number; y: number; z: number }>
): number {
  // 입꼬리 좌우
  const leftCorner = landmarks[61];
  const rightCorner = landmarks[291];

  // 윗입술 중앙, 아랫입술 중앙
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];

  // 입꼬리가 윗입술 중앙보다 위에 있으면 미소
  const cornerAvgY = (leftCorner.y + rightCorner.y) / 2;
  const smileRatio = (upperLip.y - cornerAvgY) / (lowerLip.y - upperLip.y + 0.001);

  // 0~1로 정규화 → 0~100
  return Math.min(100, Math.max(0, Math.round(smileRatio * 200)));
}

/** 표정 종합 평가 */
export function evaluateExpression(
  landmarks: Array<{ x: number; y: number; z: number }>
): { score: number; penalties: Penalty[] } {
  const leftEyeIndices = [33, 160, 158, 133, 153, 144];
  const rightEyeIndices = [362, 385, 387, 263, 373, 380];

  const leftEAR = calculateEAR(landmarks, leftEyeIndices);
  const rightEAR = calculateEAR(landmarks, rightEyeIndices);
  const avgEAR = (leftEAR + rightEAR) / 2;

  const smile = smileScore(landmarks);

  const penalties: Penalty[] = [];
  let score = 50; // 기본점

  // 눈 뜨임
  if (avgEAR > 0.25) {
    score += 20;
  } else if (avgEAR < 0.15) {
    score -= 40;
    penalties.push({ type: 'eyes_closed', score: -40, description: '눈 감김' });
  }

  // 반눈 (한쪽만 감김)
  if (Math.abs(leftEAR - rightEAR) > 0.08 && Math.min(leftEAR, rightEAR) < 0.18) {
    score -= 25;
    penalties.push({ type: 'half_blink', score: -25, description: '한쪽 눈 감김' });
  }

  // 미소
  score += smile * 0.3;

  // 입 크게 벌림 (하품)
  const mouthOpen = landmarks[14].y - landmarks[13].y;
  const faceHeight = landmarks[152].y - landmarks[10].y;
  if (mouthOpen / faceHeight > 0.15) {
    score -= 30;
    penalties.push({ type: 'mouth_open', score: -30, description: '입 크게 벌림' });
  }

  return { score: Math.min(100, Math.max(0, Math.round(score))), penalties };
}
```

### 6.3 퍼셉추얼 해시 (pHash) — 직접 구현

```typescript
// src/engine/phash.ts

/** DCT 기반 퍼셉추얼 해시 계산
 *  32×32로 리사이즈 → DCT → 상위 8×8 계수 → 중앙값 기준 이진화
 */
export function computePHash(imageData: ImageData): string {
  const SIZE = 32;
  const SMALL = 8;

  // 그레이스케일 32×32 배열
  const gray = new Float64Array(SIZE * SIZE);
  const { data, width, height } = imageData;

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 가장 가까운 원본 픽셀 (nearest neighbor)
      const srcX = Math.floor((x / SIZE) * width);
      const srcY = Math.floor((y / SIZE) * height);
      const idx = (srcY * width + srcX) * 4;
      gray[y * SIZE + x] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
  }

  // 간이 DCT (8×8 저주파 영역만)
  const dct = new Float64Array(SMALL * SMALL);
  for (let u = 0; u < SMALL; u++) {
    for (let v = 0; v < SMALL; v++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          sum += gray[y * SIZE + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * SIZE));
        }
      }
      dct[u * SMALL + v] = sum;
    }
  }

  // DC 성분 제외, 중앙값 계산
  const values = Array.from(dct.slice(1)); // DC 제거
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];

  // 이진 해시 생성
  let hash = '';
  for (let i = 1; i < dct.length; i++) {
    hash += dct[i] > median ? '1' : '0';
  }

  return hash;
}

/** 해밍 거리 (두 해시의 차이) */
export function hammingDistance(hash1: string, hash2: string): number {
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) distance++;
  }
  return distance;
}

/** 유사 사진 그룹핑 */
export function groupByHash(
  photos: Array<{ id: string; hash: string; timestamp: number | null; sharpness: number }>
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  const assigned = new Set<string>();

  // 시간순 정렬
  const sorted = [...photos].sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

  for (const photo of sorted) {
    if (assigned.has(photo.id)) continue;

    const group = [photo.id];
    assigned.add(photo.id);

    for (const other of sorted) {
      if (assigned.has(other.id)) continue;

      // 시간 차이 3초 이내 + 해밍 거리 12 이하
      const timeDiff = Math.abs((photo.timestamp ?? 0) - (other.timestamp ?? 0));
      const hashDist = hammingDistance(photo.hash, other.hash);

      if ((timeDiff < 3000 || !photo.timestamp) && hashDist < 12) {
        group.push(other.id);
        assigned.add(other.id);
      }
    }

    const groupId = crypto.randomUUID();
    groups.set(groupId, group);
  }

  return groups;
}
```

---

## 7. 인스타 크롭 & 다운로드 구현

### 7.1 스마트 크롭

```typescript
// src/utils/crop.ts
import type { FaceData, AspectRatio } from '../types';

const RATIOS: Record<AspectRatio, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '1.91:1': 1.91,
  '9:16': 9 / 16,
};

interface CropRect { x: number; y: number; width: number; height: number; }

export function smartCrop(
  imageWidth: number,
  imageHeight: number,
  face: FaceData,
  ratio: AspectRatio
): CropRect {
  const targetRatio = RATIOS[ratio];

  // 크롭 영역 크기 결정 (가능한 크게)
  let cropW: number, cropH: number;
  if (imageWidth / imageHeight > targetRatio) {
    cropH = imageHeight;
    cropW = cropH * targetRatio;
  } else {
    cropW = imageWidth;
    cropH = cropW / targetRatio;
  }

  // 얼굴 중심 기준 + 헤드룸 보정
  let centerX = face.centerX * imageWidth;
  let centerY = face.centerY * imageHeight - face.height * imageHeight * 0.1;

  // 시선 방향 보정
  if (face.yaw > 10) {
    centerX -= imageWidth * 0.03; // 시선 앞에 공간 확보
  } else if (face.yaw < -10) {
    centerX += imageWidth * 0.03;
  }

  // 크롭 영역 좌상단 좌표
  let x = centerX - cropW / 2;
  let y = centerY - cropH / 3; // 얼굴을 상단 1/3에 배치

  // 이미지 범위 내로 클램핑
  x = Math.max(0, Math.min(x, imageWidth - cropW));
  y = Math.max(0, Math.min(y, imageHeight - cropH));

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(cropW),
    height: Math.round(cropH),
  };
}

/** 크롭 실행 → Blob 반환 */
export async function executeCrop(
  file: File,
  crop: CropRect,
  outputSize: number = 1080
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = outputSize / Math.max(crop.width, crop.height);
  const w = Math.round(crop.width * (crop.width > crop.height ? 1 : crop.height / crop.width) * scale);
  const h = Math.round(crop.height * (crop.height > crop.width ? 1 : crop.width / crop.height) * scale);

  const canvas = new OffscreenCanvas(
    Math.round(crop.width * scale),
    Math.round(crop.height * scale)
  );
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height,
                0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}
```

### 7.2 ZIP 배치 다운로드

```typescript
// src/utils/zip.ts
import { zipSync, strToU8 } from 'fflate';

export async function downloadAsZip(
  files: Array<{ name: string; blob: Blob }>,
  zipName: string = 'photopick_insta.zip'
) {
  // Blob → Uint8Array 변환
  const entries: Record<string, Uint8Array> = {};

  for (const file of files) {
    const buffer = await file.blob.arrayBuffer();
    entries[file.name] = new Uint8Array(buffer);
  }

  // ZIP 압축
  const zipped = zipSync(entries, { level: 0 }); // 이미 JPEG이므로 압축 불필요

  // 다운로드 트리거
  const blob = new Blob([zipped], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipName;
  a.click();
  URL.revokeObjectURL(url);
}
```

---

## 8. 성능 최적화 테크닉

### 8.1 이미지 로딩 최적화

| 기법 | 설명 | 효과 |
|---|---|---|
| **Lazy Loading** | 한 번에 50장씩만 로드, 분석 후 다음 50장 | 메모리 80% 절감 |
| **createImageBitmap** | `new Image()` 대신 사용, 디코딩이 별도 스레드 | 메인 스레드 블로킹 방지 |
| **bitmap.close()** | 사용 후 즉시 해제 | 메모리 누수 방지 |
| **Object URL 관리** | 썸네일 URL은 화면에 보이는 것만 유지 | 메모리 절감 |

### 8.2 분석 속도 최적화

| 기법 | 설명 | 효과 |
|---|---|---|
| **3단계 파이프라인** | 1차에서 50% 탈락 → 정밀 분석 대상 감소 | 전체 시간 60% 단축 |
| **Web Worker 풀** | CPU 코어 수만큼 병렬 처리 | 4~8배 속도 향상 |
| **단계별 리사이즈** | 1차: 320×240, 3차: 640×480 | 연산량 대폭 감소 |
| **모델 사전 로딩** | 페이지 로드 시 WASM 모델 미리 다운로드 | 첫 분석 대기시간 제거 |
| **결과 캐싱** | 같은 사진 재분석 방지 (해시 기반) | 반복 작업 시 즉시 |

### 8.3 렌더링 최적화

```typescript
// 가상화 스크롤 — 1000장 그리드를 화면에 보이는 것만 렌더링
// react-window 또는 @tanstack/react-virtual 사용

import { useVirtualizer } from '@tanstack/react-virtual';

function PhotoGrid({ photos }: { photos: PhotoData[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const COLUMNS = 4;
  const rows = Math.ceil(photos.length / COLUMNS);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 250,       // 행 높이 추정값
    overscan: 3,                   // 화면 밖 3행 미리 렌더
  });

  return (
    <div ref={parentRef} style={{ height: '80vh', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(row => (
          <div key={row.key} className="flex gap-2"
               style={{ transform: `translateY(${row.start}px)` }}>
            {photos.slice(row.index * COLUMNS, (row.index + 1) * COLUMNS).map(photo => (
              <PhotoThumbnail key={photo.id} photo={photo} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 9. 배포 방법

### 9.1 Vercel 배포 (가장 간단)

```bash
# 1. GitHub에 코드 푸시
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/your-repo/photopick-ai.git
git push -u origin main

# 2. Vercel CLI 배포
npm i -g vercel
vercel
# → 프레임워크: Vite 자동 감지
# → 빌드 커맨드: npm run build
# → 출력 디렉토리: dist
```

### 9.2 빌드 최적화 설정

```typescript
// vite.config.ts (프로덕션 최적화)
export default defineConfig({
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks: {
          // AI 모델을 별도 청크로 분리 (lazy load)
          'mediapipe': ['@mediapipe/face_mesh', '@mediapipe/pose'],
          'tensorflow': ['@tensorflow/tfjs', '@tensorflow-models/body-pix'],
        },
      },
    },
  },
});
```

### 9.3 WASM 모델 파일 호스팅

MediaPipe WASM 파일은 크기가 크므로 CDN에서 제공:

```typescript
// MediaPipe 초기화 시 CDN 경로 지정
const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
});
```

### 9.4 PWA 설정 (오프라인 지원)

```bash
npm install -D vite-plugin-pwa
```

```typescript
// vite.config.ts
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB (WASM 포함)
      },
      manifest: {
        name: 'PhotoPick AI',
        short_name: 'PhotoPick',
        theme_color: '#1B4F72',
      },
    }),
  ],
});
```

---

## 10. 학습 로드맵

이 프로젝트에 필요한 기술을 순서대로 학습하는 권장 경로:

### 10.1 기초 (1~2주)

| 순서 | 주제 | 학습 자료 | 목표 |
|---|---|---|---|
| 1 | TypeScript 기초 | typescript-exercises.github.io | 타입 정의, 제네릭 이해 |
| 2 | React 18 기초 | react.dev 공식 튜토리얼 | Hooks, 컴포넌트, 상태관리 |
| 3 | Tailwind CSS | tailwindcss.com/docs | 유틸리티 클래스 숙지 |
| 4 | Vite 프로젝트 세팅 | vitejs.dev/guide | 프로젝트 생성, 빌드 설정 |

### 10.2 핵심 기술 (3~4주)

| 순서 | 주제 | 학습 자료 | 목표 |
|---|---|---|---|
| 5 | Canvas API | MDN Canvas Tutorial | drawImage, getImageData 이해 |
| 6 | Web Worker | MDN Web Workers API | Worker 생성, postMessage 통신 |
| 7 | MediaPipe Face Mesh | google.github.io/mediapipe | 얼굴 랜드마크 검출 실습 |
| 8 | TensorFlow.js 기초 | tensorflow.org/js/tutorials | 텐서 연산, 모델 로딩 |

### 10.3 심화 (5~6주)

| 순서 | 주제 | 학습 자료 | 목표 |
|---|---|---|---|
| 9 | OffscreenCanvas | MDN OffscreenCanvas | Worker에서 이미지 처리 |
| 10 | 이미지 처리 알고리즘 | "Digital Image Processing" 개론 | Laplacian, 히스토그램, DCT |
| 11 | 성능 프로파일링 | Chrome DevTools Performance 탭 | 병목 지점 분석, 메모리 관리 |
| 12 | Vercel 배포 + PWA | vercel.com/docs, web.dev/pwa | 프로덕션 배포 실습 |

### 10.4 추천 학습 순서 요약

```
[TypeScript + React 기초]
        ↓
[Canvas API + 이미지 처리 기초]
        ↓
[Web Worker 병렬 처리]
        ↓
[MediaPipe 얼굴 검출]
        ↓
[구도/표정/화질 분석 알고리즘 구현]
        ↓
[인스타 크롭 + ZIP 다운로드]
        ↓
[성능 최적화 + 배포]
```

각 단계에서 작은 데모를 만들어 확인하면서 진행하는 것이 가장 효과적이다. 예를 들어 MediaPipe를 배울 때 "웹캠으로 얼굴 랜드마크 표시하기" 데모를 먼저 만들어보면 이후 분석 모듈 구현이 훨씬 수월해진다.
