const { app, BrowserWindow, ipcMain, Menu, shell, screen, Tray, nativeImage, dialog } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { restoreBatch } = require('./organizer-history');
const { canOrganizeSource } = require('./organize-scope');

let win;
let tray = null;
let appIsQuitting = false;
let lastDragCursor = null;
let dragTimer = null;
let settingsCache = null;
let lastBatch = null;
let organizeBusy = false;

const PANEL_WIDTH = 280;
const PET_PADDING = 38;
const PET_EXTRA_HEIGHT = 58;
const PANEL_HEIGHT = 420;
const MAX_PET_SIZE = 360;
const WIN_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const RISKY_EXTENSIONS = new Set([
  '.exe', '.app', '.dmg', '.pkg', '.msi', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.scr', '.com', '.jar',
  '.hta', '.wsf', '.wsh', '.reg', '.cpl', '.msc', '.pif', '.dll', '.lnk', '.url', '.webloc'
]);

const DEFAULT_RULES = {
  '图片': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.heic'],
  '截图': [],
  '视频': ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'],
  '音频': ['.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg'],
  'PDF文档': ['.pdf'],
  '文档': ['.doc', '.docx', '.txt', '.md', '.rtf', '.pages'],
  '表格': ['.xls', '.xlsx', '.csv', '.numbers'],
  '演示文稿': ['.ppt', '.pptx', '.key'],
  '压缩包': ['.zip', '.rar', '.7z', '.tar', '.gz'],
  '代码': ['.js', '.ts', '.tsx', '.jsx', '.html', '.css', '.json', '.py', '.java', '.go', '.rs', '.php', '.rb', '.swift'],
  '设计文件': ['.psd', '.ai', '.fig', '.sketch', '.xd', '.blend', '.c4d'],
  '快捷方式': ['.lnk', '.url', '.webloc']
};

const CATEGORY_ALIASES = {
  Images: '图片',
  Screenshots: '截图',
  Videos: '视频',
  Audio: '音频',
  PDFs: 'PDF文档',
  Documents: '文档',
  Spreadsheets: '表格',
  Presentations: '演示文稿',
  Archives: '压缩包',
  Code: '代码',
  Design: '设计文件',
  Shortcuts: '快捷方式',
  Folders: '文件夹',
  Others: '其他',
  EmptyFolders: '空文件夹'
};

function normalizePathKey(filePath) {
  const resolved = path.resolve(String(filePath));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(child, parent) {
  const c = normalizePathKey(child);
  const p = normalizePathKey(parent);
  return c === p || c.startsWith(p + path.sep);
}

function toCategoryName(category) {
  return CATEGORY_ALIASES[category] || category;
}

function sanitizeName(name) {
  let s = String(name || '')
    .replace(/[\\/:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = 'unnamed';
  if (process.platform === 'win32' && WIN_RESERVED_NAME.test(s)) s = `_${s}`;
  s = s.replace(/[. ]+$/g, '');
  if (!s) s = 'unnamed';
  return s;
}

function sanitizeCategoryName(category) {
  const aliased = toCategoryName(category);
  const cleaned = String(aliased || '')
    .replace(/[\\/]/g, '_')
    .split(/[/\\]/)
    .filter(part => part && part !== '.' && part !== '..')
    .join('_');
  const safe = sanitizeName(cleaned).slice(0, 64);
  return safe || '其他';
}

function normalizeRules(rules) {
  const merged = { ...DEFAULT_RULES };
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return merged;
  for (const [key, value] of Object.entries(rules)) {
    if (!Array.isArray(value)) continue;
    const category = sanitizeCategoryName(key);
    merged[category] = value.map(ext => String(ext).toLowerCase());
  }
  return merged;
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getBatchPath() {
  return path.join(app.getPath('userData'), 'last-batch.json');
}

function defaultVaultPath() {
  return path.join(app.getPath('desktop'), '文件怪整理箱');
}

function getAllowedVaultRoots() {
  return [
    app.getPath('desktop'),
    app.getPath('documents'),
    app.getPath('downloads')
  ].map(p => path.resolve(p));
}

function isAllowedVaultPath(vaultPath) {
  if (!vaultPath || typeof vaultPath !== 'string') return false;
  const resolved = path.resolve(vaultPath.trim());
  if (!resolved || RISKY_EXTENSIONS.has(normalizeExt(resolved))) return false;
  // 禁止把整理箱设成允许根目录本身，避免与桌面内容缠在一起
  if (getAllowedVaultRoots().some(root => normalizePathKey(root) === normalizePathKey(resolved))) {
    return false;
  }
  return getAllowedVaultRoots().some(root => isPathInside(resolved, root));
}

function resolveSafeVaultPath(candidate) {
  if (isAllowedVaultPath(candidate)) return path.resolve(String(candidate).trim());
  return defaultVaultPath();
}

function defaultSettings() {
  return {
    vaultPath: defaultVaultPath(),
    alwaysOnTop: true,
    launchAtLogin: false,
    safeMode: true,
    moveFolders: true,
    addDatePrefix: false,
    petSize: 220,
    screenshotKeywords: ['screenshot', 'screen shot', '截屏', '截图', '屏幕快照', 'スクリーンショット'],
    rules: DEFAULT_RULES
  };
}

async function readJsonSafe(filePath, fallback) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

async function loadLastBatch() {
  try {
    const raw = await fsp.readFile(getBatchPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.items)) {
      lastBatch = null;
      return;
    }
    lastBatch = parsed;
  } catch {
    lastBatch = null;
  }
}

async function persistLastBatch(batch) {
  lastBatch = batch;
  try {
    if (!batch) {
      await fsp.unlink(getBatchPath()).catch(() => {});
      return;
    }
    await fsp.mkdir(path.dirname(getBatchPath()), { recursive: true });
    await fsp.writeFile(getBatchPath(), JSON.stringify(batch, null, 2), 'utf8');
  } catch {
    // 持久化失败不阻断整理流程
  }
}

async function loadSettings() {
  if (!settingsCache) {
    settingsCache = await readJsonSafe(getSettingsPath(), defaultSettings());
    if (settingsCache.moveFolders === undefined) settingsCache.moveFolders = true;
    settingsCache.vaultPath = resolveSafeVaultPath(settingsCache.vaultPath);
    settingsCache.rules = normalizeRules(settingsCache.rules);
    settingsCache.safeMode = settingsCache.safeMode !== false;
    settingsCache.petSize = clampPetSize(settingsCache.petSize);
  }
  return settingsCache;
}

async function saveSettings(next) {
  const patch = { ...next };
  if (patch.petSize !== undefined) patch.petSize = clampPetSize(patch.petSize);
  if (patch.rules !== undefined) patch.rules = normalizeRules(patch.rules);
  if (patch.vaultPath !== undefined) patch.vaultPath = resolveSafeVaultPath(patch.vaultPath);
  if (patch.safeMode !== undefined) patch.safeMode = Boolean(patch.safeMode);
  if (patch.moveFolders !== undefined) patch.moveFolders = Boolean(patch.moveFolders);
  if (patch.alwaysOnTop !== undefined) patch.alwaysOnTop = Boolean(patch.alwaysOnTop);
  if (patch.launchAtLogin !== undefined) patch.launchAtLogin = Boolean(patch.launchAtLogin);
  if (patch.addDatePrefix !== undefined) patch.addDatePrefix = Boolean(patch.addDatePrefix);

  settingsCache = { ...(await loadSettings()), ...patch };
  settingsCache.vaultPath = resolveSafeVaultPath(settingsCache.vaultPath);
  settingsCache.rules = normalizeRules(settingsCache.rules);

  await fsp.mkdir(path.dirname(getSettingsPath()), { recursive: true });
  await fsp.writeFile(getSettingsPath(), JSON.stringify(settingsCache, null, 2), 'utf8');
  app.setLoginItemSettings({ openAtLogin: Boolean(settingsCache.launchAtLogin) });
  if (win) win.setAlwaysOnTop(Boolean(settingsCache.alwaysOnTop), 'floating');
  return settingsCache;
}

async function chooseVaultPath() {
  const settings = await loadSettings();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '选择整理箱路径',
    defaultPath: settings.vaultPath,
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: result.filePaths[0] };
}

function getTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-app.png');
  try {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img.resize({ width: 32, height: 32 });
  } catch {}
  // 回退：SVG 图标
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#6d5cff"/><text x="16" y="22" font-size="18" text-anchor="middle" fill="#fff">怪</text></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

function showMainWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideMainWindow() {
  if (!win) return;
  win.hide();
}

function createTray() {
  if (tray) return;
  tray = new Tray(getTrayIcon());
  tray.setToolTip('文件怪桌宠');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示文件怪', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]));
  tray.on('double-click', () => showMainWindow());
}

function clampPetSize(size) {
  return Math.min(MAX_PET_SIZE, Math.max(160, Number(size) || 220));
}

function getWindowSize(petSize, expanded) {
  const size = clampPetSize(petSize);
  const collapsedW = size + PET_PADDING;
  const collapsedH = size + PET_EXTRA_HEIGHT;
  if (!expanded) return { width: collapsedW, height: collapsedH };
  return {
    width: size + PET_PADDING + PANEL_WIDTH + 14,
    height: Math.max(PANEL_HEIGHT + 8, size + PET_EXTRA_HEIGHT + 40)
  };
}

function createWindow() {
  const settings = settingsCache || defaultSettings();
  const initialSize = getWindowSize(settings.petSize, false);
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-app.png');
  win = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
    minWidth: 160 + PET_PADDING,
    minHeight: 160 + PET_EXTRA_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    icon: iconPath,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(false);

  win.webContents.on('did-finish-load', () => {
    win.setIgnoreMouseEvents(false);
  });

  win.on('close', event => {
    if (!appIsQuitting) {
      event.preventDefault();
      hideMainWindow();
    }
  });

  win.webContents.on('context-menu', event => {
    event.preventDefault();
  });
}

function showAppContextMenu() {
  if (!win) return;
  const template = [
    { label: '整理桌面', click: () => win.webContents.send('pet-menu-action', 'organize-desktop') },
    { label: '整理截图', click: () => win.webContents.send('pet-menu-action', 'organize-screenshots') },
    { type: 'separator' },
    { label: '打开整理箱', click: () => openVault() },
    { label: '打开回收站', click: () => openTrash() },
    { label: '撤销最近整理', click: () => win.webContents.send('pet-menu-action', 'undo-organize') },
    { type: 'separator' },
    {
      label: '总是置顶',
      type: 'checkbox',
      checked: win.isAlwaysOnTop(),
      click: async item => {
        await saveSettings({ alwaysOnTop: item.checked });
        win.webContents.send('pet-settings-changed', await loadSettings());
      }
    },
    {
      label: '开机自启动',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: async item => {
        await saveSettings({ launchAtLogin: item.checked });
        win.webContents.send('pet-settings-changed', await loadSettings());
      }
    },
    { type: 'separator' },
    { label: '打开/关闭设置面板', click: () => win.webContents.send('pet-menu-action', 'toggle-panel') },
    { label: '隐藏到托盘', click: () => hideMainWindow() },
    { label: '退出文件怪', click: () => app.quit() }
  ];
  Menu.buildFromTemplate(template).popup({ window: win });
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function normalizeExt(filePath) {
  return path.extname(filePath).toLowerCase();
}

async function exists(filePath) {
  try { await fsp.access(filePath); return true; } catch { return false; }
}

async function uniquePath(targetPath) {
  if (!(await exists(targetPath))) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  let i = 1;
  while (i < 10000) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
    i += 1;
  }
  throw new Error('无法生成唯一文件名');
}

function isScreenshot(filePath, settings) {
  const ext = normalizeExt(filePath);
  const imageExts = (settings.rules && settings.rules['图片']) || DEFAULT_RULES['图片'];
  if (!imageExts.map(e => String(e).toLowerCase()).includes(ext)) return false;
  const lower = path.basename(filePath).toLowerCase();
  const keywords = Array.isArray(settings.screenshotKeywords) ? settings.screenshotKeywords : defaultSettings().screenshotKeywords;
  return keywords.some(k => lower.includes(String(k).toLowerCase()));
}

function getCategory(filePath, isDirectory, settings) {
  if (isDirectory) return '文件夹';
  if (isScreenshot(filePath, settings)) return '截图';
  const ext = normalizeExt(filePath);
  const rules = normalizeRules(settings.rules || DEFAULT_RULES);
  for (const [category, extensions] of Object.entries(rules)) {
    if (category === '截图') continue;
    if (Array.isArray(extensions) && extensions.map(e => String(e).toLowerCase()).includes(ext)) {
      return sanitizeCategoryName(category);
    }
  }
  return '其他';
}

const SKIP_FOLDER_NAMES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '$recycle.bin',
  'system volume information',
  'windows',
  'program files',
  'program files (x86)',
  'programdata'
]);

function getDesktopRoot() {
  return path.resolve(app.getPath('desktop'));
}

function isUnderDesktop(filePath) {
  return isPathInside(filePath, getDesktopRoot());
}

function shouldSkip(filePath, stat, settings, options = {}) {
  const name = path.basename(filePath);
  if (!name || name.startsWith('.')) return '隐藏文件已跳过';
  if (stat.isSymbolicLink()) return '符号链接/联接已跳过';

  const resolved = path.resolve(filePath);
  const vault = path.resolve(settings.vaultPath);
  if (isPathInside(resolved, vault)) return '整理箱内部文件已跳过';
  if (!canOrganizeSource(resolved, { desktopRoot: getDesktopRoot(), vaultPath: vault, allowOutsideDesktop: Boolean(options.allowOutsideDesktop) })) return '仅允许整理桌面上的文件';
  if (settings.safeMode && RISKY_EXTENSIONS.has(normalizeExt(filePath))) return '安全模式跳过可执行/脚本/快捷方式';
  if (stat.isDirectory()) {
    if (!settings.moveFolders) return '文件夹移动已关闭（请在设置中开启“移动文件夹”）';
    if (SKIP_FOLDER_NAMES.has(name.toLowerCase())) return '系统/敏感文件夹已跳过';
  }
  return '';
}

async function isEmptyDirectory(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath);
    return entries.length === 0;
  } catch (err) {
    // 目录不存在或不可读 → 不能断定为空，归入"非空"更安全
    return false;
  }
}

function assertInsideVault(targetPath, vaultPath) {
  const vault = path.resolve(vaultPath);
  const target = path.resolve(targetPath);
  if (!isPathInside(target, vault)) {
    throw new Error('目标路径逃出整理箱，已拒绝');
  }
}

async function countFilesRecursive(dirPath) {
  let files = 0;
  let dirs = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      dirs += 1;
      const sub = await countFilesRecursive(full);
      files += sub.files;
      dirs += sub.dirs;
    } else {
      files += 1;
    }
  }
  return { files, dirs };
}

async function moveItem(source, target) {
  try {
    await fsp.rename(source, target);
    return;
  } catch (err) {
    if (!err || err.code !== 'EXDEV') throw err;
  }

  let copied = false;
  try {
    const stat = await fsp.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('拒绝移动符号链接');
    if (stat.isDirectory()) {
      await fsp.cp(source, target, { recursive: true, errorOnExist: true });
      copied = true;
      const [srcCount, dstCount] = await Promise.all([
        countFilesRecursive(source),
        countFilesRecursive(target)
      ]);
      if (srcCount.files + srcCount.dirs !== dstCount.files + dstCount.dirs) throw new Error('跨盘复制校验失败：文件/目录数量不一致');
      await fsp.rm(source, { recursive: true, force: false });
    } else {
      await fsp.copyFile(source, target);
      copied = true;
      const [ss, ts] = await Promise.all([fsp.stat(source), fsp.stat(target)]);
      if (ss.size !== ts.size) throw new Error('跨盘复制校验失败：文件大小不一致');
      await fsp.unlink(source);
    }
  } catch (copyErr) {
    if (copied) await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
    throw copyErr;
  }
}

async function withOrganizeLock(fn) {
  if (organizeBusy) {
    return {
      ok: false,
      moved: [],
      deleted: [],
      skipped: [],
      errors: [{ source: '', message: '正在整理中，请稍候' }],
      message: '正在整理中，请稍候'
    };
  }
  organizeBusy = true;
  try {
    return await fn();
  } finally {
    organizeBusy = false;
  }
}

async function confirmDangerousAction(message, detail) {
  const result = await dialog.showMessageBox(win || undefined, {
    type: 'warning',
    buttons: ['取消', '开始整理'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '文件怪',
    message,
    detail
  });
  return result.response === 1;
}

async function organizePaths(inputPaths, options = {}) {
  return withOrganizeLock(async () => {
    const settings = await loadSettings();
    const vaultPath = resolveSafeVaultPath(settings.vaultPath);
    settings.vaultPath = vaultPath;
    await ensureDir(vaultPath);
    const result = { ok: true, moved: [], deleted: [], skipped: [], errors: [] };

    for (const rawPath of inputPaths || []) {
      try {
        const source = path.resolve(String(rawPath));
        if (!(await exists(source))) {
          result.skipped.push({ source, reason: '文件不存在' });
          continue;
        }

        const stat = await fsp.lstat(source);
        const reason = shouldSkip(source, stat, settings, options);
        if (reason) {
          result.skipped.push({ source, reason });
          continue;
        }

        const isEmptyDir = stat.isDirectory() && await isEmptyDirectory(source);
        const category = isEmptyDir ? '空文件夹' : getCategory(source, stat.isDirectory(), settings);
        const safeCategory = sanitizeCategoryName(category);
        const destDir = path.resolve(path.join(vaultPath, safeCategory));
        assertInsideVault(destDir, vaultPath);
        await ensureDir(destDir);

        const datePrefix = settings.addDatePrefix ? `${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}_` : '';
        const targetName = sanitizeName(`${datePrefix}${path.basename(source)}`);
        const target = await uniquePath(path.join(destDir, targetName));
        assertInsideVault(target, vaultPath);

        await moveItem(source, target);
        result.moved.push({ source, target, category: safeCategory });
      } catch (err) {
        result.ok = false;
        result.errors.push({ source: rawPath, message: err.message });
      }
    }

    if (result.moved.length > 0) {
      await persistLastBatch({
        time: Date.now(),
        reason: options.reason || 'organize',
        items: result.moved
      });
    }
    return result;
  });
}

async function organizeDesktop() {
  const confirmed = await confirmDangerousAction(
    '整理整个桌面？',
    '桌面上的文件和文件夹将被移动到整理箱。空文件夹会移入「空文件夹」分类，不会直接删除。此操作可在本机撤销一次。'
  );
  if (!confirmed) return { ok: false, moved: [], deleted: [], skipped: [], errors: [], message: '已取消整理' };

  const settings = await loadSettings();
  const desktop = getDesktopRoot();
  const vaultKey = normalizePathKey(settings.vaultPath);
  const names = await fsp.readdir(desktop);
  const list = names
    .map(name => path.join(desktop, name))
    .filter(p => normalizePathKey(p) !== vaultKey);
  return organizePaths(list, { reason: 'desktop' });
}

async function organizeScreenshots() {
  const confirmed = await confirmDangerousAction(
    '整理桌面截图？',
    '匹配截图关键词的图片将被移入整理箱的「截图」分类。'
  );
  if (!confirmed) return { ok: false, moved: [], deleted: [], skipped: [], errors: [], message: '已取消整理' };

  const desktop = getDesktopRoot();
  const settings = await loadSettings();
  const names = await fsp.readdir(desktop);
  const list = [];
  for (const name of names) {
    const full = path.join(desktop, name);
    try {
      const stat = await fsp.lstat(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isFile() && isScreenshot(full, settings)) list.push(full);
    } catch {}
  }
  return organizePaths(list, { reason: 'screenshots' });
}

async function undoLastBatch() {
  return withOrganizeLock(async () => {
    if (!lastBatch || !lastBatch.items || !lastBatch.items.length) {
      return { ok: false, message: '没有可撤销的整理记录' };
    }

    const undo = await restoreBatch(lastBatch.items, {
      exists,
      uniquePath,
      ensureDir,
      moveItem
    });

    if (undo.remainingItems.length > 0) {
      await persistLastBatch({ ...lastBatch, items: undo.remainingItems });
    } else {
      await persistLastBatch(null);
    }

    return {
      ok: undo.errors.length === 0,
      restored: undo.restored,
      errors: undo.errors
    };
  });
}

async function openVault() {
  const settings = await loadSettings();
  const vaultPath = resolveSafeVaultPath(settings.vaultPath);
  settings.vaultPath = vaultPath;
  await ensureDir(vaultPath);

  let stat;
  try {
    stat = await fsp.lstat(vaultPath);
  } catch {
    return { ok: false, message: '整理箱路径无效' };
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { ok: false, message: '整理箱必须是普通目录' };
  }
  if (RISKY_EXTENSIONS.has(normalizeExt(vaultPath))) {
    return { ok: false, message: '拒绝打开可疑路径' };
  }

  const openError = await shell.openPath(vaultPath);
  if (openError) return { ok: false, message: openError, path: vaultPath };
  return { ok: true, path: vaultPath };
}

async function openTrash() {
  const settings = await loadSettings();
  const vaultPath = resolveSafeVaultPath(settings.vaultPath);
  settings.vaultPath = vaultPath;
  const trashPath = path.join(vaultPath, '_回收站');
  assertInsideVault(trashPath, vaultPath);
  await ensureDir(trashPath);

  const openError = await shell.openPath(trashPath);
  if (openError) return { ok: false, message: openError, path: trashPath };
  return { ok: true, path: trashPath };
}

function clampWindowPosition(x, y, width, height) {
  const display = screen.getDisplayNearestPoint({ x: Math.round(x + width / 2), y: Math.round(y + height / 2) });
  const area = display.workArea;
  const minVisible = 96;
  const clampedX = Math.min(Math.max(x, area.x - width + minVisible), area.x + area.width - minVisible);
  const clampedY = Math.min(Math.max(y, area.y - height + minVisible), area.y + area.height - minVisible);
  return { x: Math.round(clampedX), y: Math.round(clampedY) };
}

function resizeWindow(petSize, expanded) {
  if (!win) return;
  const bounds = win.getBounds();
  const { width, height } = getWindowSize(petSize, Boolean(expanded));
  win.setResizable(false);
  win.setMinimumSize(width, height);
  win.setMaximumSize(width, height);
  win.setBounds({ x: bounds.x, y: bounds.y, width, height }, false);
  win.webContents.send('window:resized');
}

function registerIpc() {
  ipcMain.handle('settings:get', async () => loadSettings());
  ipcMain.handle('settings:save', async (_event, next) => saveSettings(next || {}));
  ipcMain.handle('settings:choose-vault', async () => chooseVaultPath());
  ipcMain.handle('organize:paths', async (_event, paths) => organizePaths(paths, { reason: 'drop', allowOutsideDesktop: true }));
  ipcMain.handle('organize:desktop', async () => organizeDesktop());
  ipcMain.handle('organize:screenshots', async () => organizeScreenshots());
  ipcMain.handle('organize:undo', async () => undoLastBatch());
  ipcMain.handle('vault:open', async () => openVault());
  ipcMain.handle('trash:open', async () => openTrash());
  ipcMain.handle('window:apply-pet-size', async (_event, petSize, expanded) => {
    resizeWindow(petSize, expanded);
  });
  ipcMain.handle('window:toggle-panel-size', async (_event, expanded, petSize) => {
    if (!win) return;
    const settings = await loadSettings();
    const size = petSize !== undefined ? clampPetSize(petSize) : settings.petSize;
    resizeWindow(size, Boolean(expanded));
    win.setIgnoreMouseEvents(false);
  });
  ipcMain.on('window:set-passthrough', (_event, passthrough) => {
    if (!win) return;
    win.setIgnoreMouseEvents(Boolean(passthrough), { forward: true });
  });
  ipcMain.on('window:drag-start', () => {
    if (!win) return;
    lastDragCursor = screen.getCursorScreenPoint();
    if (dragTimer) clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      if (!win || !lastDragCursor) return;
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - lastDragCursor.x;
      const dy = cursor.y - lastDragCursor.y;
      lastDragCursor = cursor;
      if (!dx && !dy) return;
      const bounds = win.getBounds();
      const next = clampWindowPosition(bounds.x + dx, bounds.y + dy, bounds.width, bounds.height);
      win.setBounds({ x: next.x, y: next.y, width: bounds.width, height: bounds.height }, false);
    }, 16);
  });
  ipcMain.on('window:drag-end', () => {
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = null;
    }
    lastDragCursor = null;
  });
  ipcMain.on('window:show-context-menu', () => {
    showAppContextMenu();
  });
  ipcMain.on('window:minimize', () => hideMainWindow());
  ipcMain.on('app:quit', () => app.quit());
}

app.whenReady().then(async () => {
  registerIpc();
  const defaults = defaultSettings();
  const loaded = await loadSettings();
  let shouldPersist = false;

  // 仅迁移旧配置缺失字段，不再每次启动强行改写用户选择
  if (loaded.moveFolders === undefined) {
    loaded.moveFolders = true;
    shouldPersist = true;
  }
  const safeVault = resolveSafeVaultPath(loaded.vaultPath);
  if (normalizePathKey(safeVault) !== normalizePathKey(loaded.vaultPath || '')) {
    loaded.vaultPath = safeVault;
    shouldPersist = true;
  }
  loaded.rules = normalizeRules(loaded.rules);
  settingsCache = { ...defaults, ...loaded, vaultPath: safeVault, rules: loaded.rules };

  if (shouldPersist) await saveSettings(settingsCache);
  await loadLastBatch();
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  appIsQuitting = true;
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
});

app.on('window-all-closed', event => {
  event.preventDefault();
});
