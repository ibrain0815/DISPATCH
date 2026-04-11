// preload.js — 보안 샌드박스 경계
// 현재는 별도 Node API 노출 없음 (순수 웹앱으로 동작)
window.addEventListener('DOMContentLoaded', () => {
  // 앱 버전 전달 (선택사항)
  const { ipcRenderer } = require('electron');
  document.title = 'PhotoPick AI';
});
