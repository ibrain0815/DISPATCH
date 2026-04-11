// src/components/UploadZone.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 사진 업로드 영역 — 폴더 드래그&드롭 또는 파일 선택 버튼
//
// 지원 형식: JPEG, PNG, HEIC, WebP
// 폴더 드롭 시: FileSystemEntry API로 하위 폴더 내 파일까지 재귀 수집
// 업로드 완료 후: 즉시 runPipeline() 을 호출해 3단계 분석 시작
//
// idle 상태에서만 렌더링 (분석 시작 후 사라짐)
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useRef } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import { runPipeline }   from '../engine/pipeline';

/** 허용할 이미지 MIME 타입 집합 */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

/**
 * 파일시스템 엔트리를 재귀 순회해 이미지 파일만 수집합니다
 *
 * 드래그&드롭으로 폴더를 올렸을 때 폴더 내부 하위 폴더까지 모두 탐색합니다.
 * FileSystemEntry API(Chrome/Edge 전용): 파일이면 file() 호출, 폴더면 readEntries() 재귀
 *
 * @param entry  드롭된 파일/폴더 엔트리
 * @returns      수집된 이미지 파일 배열
 */
async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    // 파일 엔트리 → File 객체로 변환 후 이미지 타입만 반환
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((file) => {
        resolve(IMAGE_TYPES.has(file.type) ? [file] : []);
      });
    });
  }

  if (entry.isDirectory) {
    // 디렉토리 엔트리 → 내부 항목 읽기 → 재귀 수집
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve);
    });
    const nested = await Promise.all(entries.map(collectFilesFromEntry));
    return nested.flat(); // 2D 배열을 1D로 평탄화
  }

  return []; // 알 수 없는 엔트리 타입
}

export function UploadZone() {
  const addPhotos  = usePhotoStore((s) => s.addPhotos);
  const stage      = usePhotoStore((s) => s.stage);
  const inputRef   = useRef<HTMLInputElement>(null); // 파일 선택 input 참조

  /** 파일 배열을 받아 스토어에 추가하고 분석 파이프라인을 시작합니다 */
  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      addPhotos(files);      // Zustand 스토어에 PhotoData 추가
      await runPipeline();   // 3단계 분석 즉시 시작
    },
    [addPhotos]
  );

  /** 드래그&드롭 이벤트 핸들러 — 폴더/파일 모두 처리 */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault(); // 브라우저 기본 동작(새 탭에서 파일 열기) 방지
      const items = Array.from(e.dataTransfer.items);
      const allFiles: File[] = [];

      for (const item of items) {
        const entry = item.webkitGetAsEntry(); // FileSystemEntry 획득
        if (entry) {
          allFiles.push(...(await collectFilesFromEntry(entry)));
        }
      }
      handleFiles(allFiles);
    },
    [handleFiles]
  );

  /** 파일 선택 input 변경 핸들러 */
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => IMAGE_TYPES.has(f.type));
      handleFiles(files);
    },
    [handleFiles]
  );

  // idle 상태가 아니면 렌더링하지 않음 (분석 시작 후 숨겨짐)
  if (stage !== 'idle') return null;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()} // 드롭 허용을 위해 dragover 기본동작 막기
      onClick={() => inputRef.current?.click()} // 영역 클릭 시 파일 선택 열기
      className="border-2 border-dashed border-gray-300 rounded-2xl p-16
                 text-center cursor-pointer select-none
                 hover:border-blue-400 hover:bg-blue-50 transition-colors"
    >
      <p className="text-4xl mb-4">📁</p>
      <p className="text-xl font-semibold text-gray-700">폴더를 여기에 드래그하세요</p>
      <p className="text-sm text-gray-400 mt-2">JPG · PNG · HEIC · WebP | 최대 5000장</p>
      <p className="text-sm text-blue-500 mt-4 underline">또는 클릭해서 파일 선택</p>

      {/* 숨겨진 파일 선택 input — 영역 클릭 시 ref.click()으로 열림 */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />
    </div>
  );
}
