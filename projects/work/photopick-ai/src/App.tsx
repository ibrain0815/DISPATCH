import './index.css';
import { UploadZone } from './components/UploadZone';
import { ProgressBar } from './components/ProgressBar';
import { PhotoGrid } from './components/PhotoGrid';
import { CropPreview } from './components/CropPreview';
import { usePhotoStore } from './store/usePhotoStore';

function App() {
  const stage = usePhotoStore((s) => s.stage);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📸</span>
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-none">PhotoPick AI</h1>
              <p className="text-xs text-gray-400 mt-0.5">1000장+ 사진에서 인스타 베스트샷 자동 선별</p>
            </div>
          </div>
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
      </header>

      {/* 메인 */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* 업로드 */}
        <UploadZone />

        {/* 진행률 */}
        <ProgressBar />

        {/* 결과 그리드 */}
        <PhotoGrid />
      </main>

      {/* 크롭 & 다운로드 바 (결과 있을 때만) */}
      <CropPreview />
    </div>
  );
}

export default App;
