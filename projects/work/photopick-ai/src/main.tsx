// src/main.tsx
// ─────────────────────────────────────────────────────────────────────────────
// React 앱 진입점 — DOM에 루트 컴포넌트를 마운트합니다
//
// StrictMode: 개발 모드에서 컴포넌트를 두 번 렌더링해 부작용을 조기 발견합니다.
//             프로덕션 빌드에서는 아무 영향 없습니다.
// ─────────────────────────────────────────────────────────────────────────────

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
