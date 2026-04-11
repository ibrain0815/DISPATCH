// src/App.tsx
// ─────────────────────────────────────────────────────────────────────────────
// 최상위 레이아웃 컴포넌트
//
// 구조:
//   헤더 (로고 + '새로 시작' 버튼)
//   └─ 메인
//       ├─ UploadZone   — 사진 드래그&드롭 / 파일 선택 (idle 상태에서만 표시)
//       ├─ ProgressBar  — 파이프라인 진행률 (분석 중 / 완료 요약)
//       └─ PhotoGrid    — 결과 그리드 + 등급 탭 필터 (done 상태에서만 표시)
//   하단 고정바 (CropPreview — 크롭 미리보기 + 비율 선택 + ZIP 다운로드)
// ─────────────────────────────────────────────────────────────────────────────

import './index.css';
import { useState } from 'react';
import { UploadZone }   from './components/UploadZone';
import { ProgressBar }  from './components/ProgressBar';
import { PhotoGrid }    from './components/PhotoGrid';
import { CropPreview }  from './components/CropPreview';
import { HelpModal }    from './components/HelpModal';
import { usePhotoStore } from './store/usePhotoStore';

function App() {
  // 현재 파이프라인 단계 구독 (헤더의 '새로 시작' 버튼 표시 여부 제어)
  const stage = usePhotoStore((s) => s.stage);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── 헤더 ── */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          {/* 로고 + 앱 이름 */}
          <div className="flex items-center gap-3">
            <span className="text-2xl">📸</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-none">PhotoPick AI</h1>
              <p className="text-xs text-gray-400 mt-0.5">1000장+ 사진에서 인스타 베스트샷 자동 선별</p>
            </div>
          </div>

          {/* 우측 버튼 그룹 */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHelp(true)}
              className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200
                         rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors"
            >
              도움말
            </button>
            {stage === 'done' && (
              <button
                onClick={() => usePhotoStore.getState().reset()}
                className="text-sm text-gray-500 hover:text-gray-700 border border-gray-200
                           rounded-lg px-3 py-1.5 hover:border-gray-300 transition-colors"
              >
                새로 시작
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── 메인 콘텐츠 ── */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 업로드 드롭존 — idle 상태에서만 렌더링 */}
        <UploadZone />

        {/* 파이프라인 진행률 + 완료 요약 — idle 제외 상태에서 렌더링 */}
        <ProgressBar />

        {/* 분석 결과 사진 그리드 — done 상태에서만 렌더링 */}
        <PhotoGrid />
      </main>

      {/* ── 하단 고정 크롭/다운로드 바 — done 상태에서만 렌더링 ── */}
      <CropPreview />

      {/* ── 도움말 모달 ── */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

    </div>
  );
}

export default App;
