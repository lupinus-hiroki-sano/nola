const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { randomUUID } = require('crypto');
const { pathToFileURL } = require('url');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const archiver = require('archiver');

let mainWindow;
let currentWorkDir = null;
let currentNolaPath = null;
let pendingFilePath = null;

// ─── File Association Registration (Windows) ──────────
function registerFileAssociation() {
  if (process.platform !== 'win32') return;

  let command;
  if (app.isPackaged) {
    command = `"${process.execPath}" "%1"`;
  } else {
    const projectDir = path.resolve(__dirname, '..');
    command = `"${process.execPath}" "${projectDir}" "%1"`;
  }

  // Icon path: use .ico in the assets folder
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');

  try {
    const regOpts = { stdio: 'ignore', windowsHide: true };
    execFileSync('reg', [
      'add', 'HKCU\\Software\\Classes\\.nola',
      '/ve', '/d', 'NOLA.Document', '/f',
    ], regOpts);
    execFileSync('reg', [
      'add', 'HKCU\\Software\\Classes\\NOLA.Document',
      '/ve', '/d', 'NOLA Document', '/f',
    ], regOpts);
    execFileSync('reg', [
      'add', 'HKCU\\Software\\Classes\\NOLA.Document\\DefaultIcon',
      '/ve', '/d', iconPath, '/f',
    ], regOpts);
    execFileSync('reg', [
      'add', 'HKCU\\Software\\Classes\\NOLA.Document\\shell\\open\\command',
      '/ve', '/d', command, '/f',
    ], regOpts);
    // Notify Explorer to refresh icon cache
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Shell32{[DllImport(\"shell32.dll\")]public static extern void SHChangeNotify(int wEventId,uint uFlags,IntPtr dwItem1,IntPtr dwItem2);}'; [Shell32]::SHChangeNotify(0x08000000,0,[IntPtr]::Zero,[IntPtr]::Zero)",
    ], regOpts);

    console.log('File association registered for .nola');
  } catch (err) {
    console.error('Failed to register file association:', err.message);
  }
}

// ─── Single Instance Lock ──────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = getFilePathFromArgs(commandLine);
    if (filePath) openDocFromPath(filePath);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (app.isReady() && mainWindow) {
      openDocFromPath(filePath);
    } else {
      pendingFilePath = filePath;
    }
  });

  // ─── App Ready ────────────────────────────────────────
  app.whenReady().then(() => {
    createWindow();
    setupIPC();
    setupMenu();
    registerFileAssociation();

    const fileToOpen =
      getFilePathFromArgs(process.argv) || pendingFilePath;

    createNewDoc();

    if (fileToOpen) {
      mainWindow.webContents.on('did-finish-load', () => {
        openDocFromPath(fileToOpen);
      });
    }
  });

  app.on('window-all-closed', () => {
    cleanupWorkDir();
    app.quit();
  });
}

// ─── File Path from Args ───────────────────────────────
function getFilePathFromArgs(args) {
  for (const arg of args.slice(1)) {
    if (arg.endsWith('.nola')) {
      const resolved = path.resolve(arg);
      if (fs.existsSync(resolved)) return resolved;
    }
  }
  return null;
}

// ─── Open file from path (file association) ────────────
function openDocFromPath(nolaPath) {
  try {
    cleanupWorkDir();
    currentWorkDir = extractNola(nolaPath);
    currentNolaPath = nolaPath;

    const assetsDir = path.join(currentWorkDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }

    const docJsonPath = path.join(currentWorkDir, 'doc.json');
    if (!fs.existsSync(docJsonPath)) {
      throw new Error('doc.json not found in .nola file');
    }

    const doc = JSON.parse(fs.readFileSync(docJsonPath, 'utf-8'));
    updateTitle();

    mainWindow.webContents.send('load-document', {
      doc: convertPathsForEditor(doc),
      fileName: path.basename(nolaPath),
    });
  } catch (err) {
    console.error('Failed to open file:', err);
    dialog.showErrorBox('Open Error', `Failed to open: ${err.message}`);
  }
}

// ─── Window ────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'NOLA - Untitled',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow file:// URLs for workDir images
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// ─── Document Management ───────────────────────────────
function createNewDoc() {
  cleanupWorkDir();

  const docId = randomUUID();
  currentWorkDir = path.join(os.tmpdir(), 'nola', docId);
  fs.mkdirSync(path.join(currentWorkDir, 'assets'), { recursive: true });
  currentNolaPath = null;

  const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
  fs.writeFileSync(
    path.join(currentWorkDir, 'doc.json'),
    JSON.stringify(emptyDoc, null, 2),
  );

  updateTitle();
  return emptyDoc;
}

function cleanupWorkDir() {
  if (currentWorkDir && fs.existsSync(currentWorkDir)) {
    try {
      fs.rmSync(currentWorkDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Failed to cleanup workDir:', e);
    }
  }
}

function updateTitle() {
  if (!mainWindow) return;
  const name = currentNolaPath ? path.basename(currentNolaPath) : 'Untitled';
  mainWindow.setTitle(`NOLA - ${name}`);
}

// ─── Path Conversion (file:// URLs) ────────────────────
function toFileUrl(relPath) {
  return pathToFileURL(path.join(currentWorkDir, relPath)).href;
}

function getWorkDirPrefix() {
  const base = pathToFileURL(currentWorkDir).href;
  return base.endsWith('/') ? base : base + '/';
}

function convertPathsForEditor(doc) {
  const str = JSON.stringify(doc, (key, value) => {
    if (key === 'src' && typeof value === 'string' && value.startsWith('assets/')) {
      return toFileUrl(value);
    }
    return value;
  });
  return JSON.parse(str);
}

function convertPathsForStorage(doc) {
  const prefix = getWorkDirPrefix();
  const str = JSON.stringify(doc, (key, value) => {
    if (key === 'src' && typeof value === 'string') {
      if (value.startsWith(prefix)) {
        return decodeURIComponent(value.slice(prefix.length));
      }
      // Fallback: extract assets/... from any file:// URL pointing to workDir
      const match = value.match(/\/assets\/[^"]+$/);
      if (match) {
        return 'assets/' + decodeURIComponent(match[0].slice('/assets/'.length));
      }
    }
    return value;
  });
  return JSON.parse(str);
}

// ─── Markdown Generation ───────────────────────────────
function toRelativeSrc(src) {
  if (!src) return '';
  // Strip file:// URL to relative path
  const match = src.match(/(assets\/[^\s"]+)/);
  return match ? match[1] : src;
}

function generateMarkdown(doc) {
  function processNode(node) {
    if (!node) return '';

    switch (node.type) {
      case 'doc':
        return (node.content || []).map(processNode).join('');

      case 'heading': {
        const level = node.attrs?.level || 1;
        const text = (node.content || []).map(processInline).join('');
        return '#'.repeat(level) + ' ' + text + '\n\n';
      }

      case 'paragraph': {
        const text = (node.content || []).map(processInline).join('');
        return text + '\n\n';
      }

      case 'bulletList':
        return (
          (node.content || [])
            .map((item) => processListItem(item, '- '))
            .join('') + '\n'
        );

      case 'orderedList':
        return (
          (node.content || [])
            .map((item, i) => processListItem(item, `${i + 1}. `))
            .join('') + '\n'
        );

      case 'listItem':
        return (node.content || []).map(processNode).join('');

      case 'image': {
        const alt = node.attrs?.alt || 'image';
        return `![${alt}](${toRelativeSrc(node.attrs?.src)})\n\n`;
      }

      default:
        return (node.content || []).map(processNode).join('');
    }
  }

  function processListItem(item, prefix) {
    const content = (item.content || [])
      .map((child) => {
        if (child.type === 'paragraph') {
          return (child.content || []).map(processInline).join('');
        }
        return processNode(child);
      })
      .join('');
    return prefix + content + '\n';
  }

  function processInline(node) {
    if (node.type === 'text') {
      let text = node.text || '';
      for (const mark of node.marks || []) {
        if (mark.type === 'bold') text = `**${text}**`;
        if (mark.type === 'italic') text = `*${text}*`;
      }
      return text;
    }
    if (node.type === 'image') {
      return `![image](${toRelativeSrc(node.attrs?.src)})`;
    }
    return '';
  }

  return processNode(doc).trim() + '\n';
}

// ─── ZIP Operations ────────────────────────────────────
function zipWorkDir(outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(output);
    archive.directory(currentWorkDir, false);
    archive.finalize();
  });
}

function extractNola(nolaPath) {
  const zip = new AdmZip(nolaPath);
  const docId = randomUUID();
  const workDir = path.join(os.tmpdir(), 'nola', docId);
  fs.mkdirSync(workDir, { recursive: true });
  zip.extractAllTo(workDir, true);
  return workDir;
}

// ─── Save Helpers ──────────────────────────────────────
async function saveNolaTo(editorJson, outPath) {
  try {
    const storageDoc = convertPathsForStorage(editorJson);
    fs.writeFileSync(
      path.join(currentWorkDir, 'doc.json'),
      JSON.stringify(storageDoc, null, 2),
    );

    const md = generateMarkdown(storageDoc);
    fs.writeFileSync(path.join(currentWorkDir, 'doc.md'), md, 'utf-8');

    const meta = {
      appVersion: '0.1.0',
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: path.basename(outPath, '.nola'),
    };
    const metaPath = path.join(currentWorkDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (existing.createdAt) meta.createdAt = existing.createdAt;
      } catch (_) {}
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    await zipWorkDir(outPath);
    currentNolaPath = outPath;
    updateTitle();

    return { success: true, fileName: path.basename(outPath) };
  } catch (err) {
    console.error('Failed to save .nola:', err);
    dialog.showErrorBox('Save Error', `Failed to save: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function saveNolaAs(editorJson) {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'NOLA Document', extensions: ['nola'] }],
    defaultPath: currentNolaPath || 'Untitled.nola',
  });
  if (result.canceled || !result.filePath) return null;
  return await saveNolaTo(editorJson, result.filePath);
}

// ─── IPC Handlers ──────────────────────────────────────
function setupIPC() {
  ipcMain.handle('new-doc', async () => {
    const doc = createNewDoc();
    return { doc: convertPathsForEditor(doc) };
  });

  ipcMain.handle('open-doc', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'NOLA Document', extensions: ['nola'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const nolaPath = result.filePaths[0];
    try {
      cleanupWorkDir();
      currentWorkDir = extractNola(nolaPath);
      currentNolaPath = nolaPath;

      const assetsDir = path.join(currentWorkDir, 'assets');
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
      }

      const docJsonPath = path.join(currentWorkDir, 'doc.json');
      if (!fs.existsSync(docJsonPath)) return null;

      const doc = JSON.parse(fs.readFileSync(docJsonPath, 'utf-8'));
      updateTitle();
      return { doc: convertPathsForEditor(doc), fileName: path.basename(nolaPath) };
    } catch (err) {
      console.error('Failed to open .nola:', err);
      dialog.showErrorBox('Open Error', `Failed to open: ${err.message}`);
      return null;
    }
  });

  ipcMain.handle('save-image', async (_event, bytes, ext) => {
    if (!currentWorkDir) return null;

    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(2, 8);
    const fileName = `img_${timestamp}_${rand}.${ext}`;
    const relativePath = `assets/${fileName}`;
    const fullPath = path.join(currentWorkDir, relativePath);

    try {
      fs.writeFileSync(fullPath, Buffer.from(bytes));
      // Return file:// URL that the browser can load directly
      return pathToFileURL(fullPath).href;
    } catch (err) {
      console.error('Failed to save image:', err);
      return null;
    }
  });

  ipcMain.handle('save-doc-json', async (_event, editorJson) => {
    if (!currentWorkDir) return false;
    try {
      const storageDoc = convertPathsForStorage(editorJson);
      fs.writeFileSync(
        path.join(currentWorkDir, 'doc.json'),
        JSON.stringify(storageDoc, null, 2),
      );
      return true;
    } catch (err) {
      console.error('Failed to save doc.json:', err);
      return false;
    }
  });

  ipcMain.handle('save-nola', async (_event, editorJson) => {
    if (!currentNolaPath) {
      return await saveNolaAs(editorJson);
    }
    return await saveNolaTo(editorJson, currentNolaPath);
  });

  ipcMain.handle('save-nola-as', async (_event, editorJson) => {
    return await saveNolaAs(editorJson);
  });
}

// ─── Menu ──────────────────────────────────────────────
function setupMenu() {
  const isMac = process.platform === 'darwin';
  const send = (action) => mainWindow.webContents.send('menu-action', action);

  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
        { label: 'Open...', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('save-as') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', click: () => send('undo') },
        { label: 'Redo', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { label: 'Paste', click: () => mainWindow.webContents.paste() },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
