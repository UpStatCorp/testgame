// Desktop wrapper: serves the built game (dist/) through a custom secure protocol so ES modules,
// audio and pointer lock behave exactly like on a web server, then opens it in a native window.
const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// Prefer the discrete GPU on laptops and never throttle the game loop
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const distDir = path.join(__dirname, '..', 'dist');

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0b0d10',
    title: 'Эхо Северных Лесов',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://game/index.html');

  // F11 toggles fullscreen; the game itself uses Esc for its pause menu
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  // External links (none expected) open in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // No application menu: frees Ctrl+W / Ctrl+R etc. for the game (crouch + WASD)
  Menu.setApplicationMenu(null);
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(distDir, decodeURIComponent(pathname)));
    if (!file.startsWith(distDir)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
