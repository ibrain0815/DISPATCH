const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'PhotoPick AI',
    icon: path.join(__dirname, app.isPackaged ? '../public/icon.png' : 'public/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Web Worker + OffscreenCanvas 허용
      webSecurity: true,
    },
    // 타이틀바 스타일
    backgroundColor: '#f9fafb',
    show: false,
  });

  // 준비 완료 후 표시 (흰 화면 방지)
  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadURL(
      pathToFileURL(path.join(__dirname, '../dist/index.html')).href
    );
  }

  // 외부 링크는 기본 브라우저로 열기
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
