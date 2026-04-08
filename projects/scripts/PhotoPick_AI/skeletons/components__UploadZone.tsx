// src/components/UploadZone.tsx
// 폴더 드래그 앤 드롭 + 파일 선택 업로드

import { useCallback, useRef } from 'react';
import { usePhotoStore } from '../store/usePhotoStore';
import { runPipeline } from '../engine/pipeline';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);

/** 폴더 내 파일 재귀 수집 */
async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file((file) => {
        resolve(IMAGE_TYPES.has(file.type) ? [file] : []);
      });
    });
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(resolve);
    });
    const nested = await Promise.all(entries.map(collectFilesFromEntry));
    return nested.flat();
  }

  return [];
}

export function UploadZone() {
  const { addPhotos, stage } = usePhotoStore((s) => ({ addPhotos: s.addPhotos, stage: s.stage }));
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      addPhotos(files);
      await runPipeline();
    },
    [addPhotos]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const items = Array.from(e.dataTransfer.items);
      const allFiles: File[] = [];

      for (const item of items) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
          allFiles.push(...(await collectFilesFromEntry(entry)));
        }
      }
      handleFiles(allFiles);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []).filter((f) => IMAGE_TYPES.has(f.type));
      handleFiles(files);
    },
    [handleFiles]
  );

  if (stage !== 'idle') return null;

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onClick={() => inputRef.current?.click()}
      className="border-2 border-dashed border-gray-300 rounded-2xl p-16
                 text-center cursor-pointer select-none
                 hover:border-blue-400 hover:bg-blue-50 transition-colors"
    >
      <p className="text-4xl mb-4">📁</p>
      <p className="text-xl font-semibold text-gray-700">폴더를 여기에 드래그하세요</p>
      <p className="text-sm text-gray-400 mt-2">JPG · PNG · HEIC · WebP | 최대 5000장</p>
      <p className="text-sm text-blue-500 mt-4 underline">또는 클릭해서 파일 선택</p>
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
