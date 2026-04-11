import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Electron 패키징 시 file:// 프로토콜에서 상대 경로 필요
  base: './',
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@mediapipe/face_mesh', '@mediapipe/pose'],
  },
  build: {
    target: 'esnext',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
