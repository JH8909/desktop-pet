const petSprite = document.getElementById('petSprite');
const appShell = document.getElementById('app');
const petStage = document.getElementById('petStage');
const petInteractive = document.getElementById('petInteractive');
const speech = document.getElementById('speech');
const statusText = document.getElementById('statusText');
const actionState = window.fileMonsterActionState.createActionState();
const operationResult = window.fileMonsterOperationResult;
const inputPolicy = window.fileMonsterInputPolicy;

const ui = {
  btnOrganize: document.getElementById('btnOrganize'),
  btnScreenshots: document.getElementById('btnScreenshots'),
  btnOpenVault: document.getElementById('btnOpenVault'),
  btnOpenTrash: document.getElementById('btnOpenTrash'),
  btnUndo: document.getElementById('btnUndo'),
  btnBrowseVault: document.getElementById('btnBrowseVault'),
  btnCollapse: document.getElementById('btnCollapse'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnQuit: document.getElementById('btnQuit'),
  vaultPath: document.getElementById('vaultPath'),
  petSize: document.getElementById('petSize'),
  petSizeValue: document.getElementById('petSizeValue'),
  safeMode: document.getElementById('safeMode'),
  moveFolders: document.getElementById('moveFolders'),
  addDatePrefix: document.getElementById('addDatePrefix'),
  launchAtLogin: document.getElementById('launchAtLogin'),
  alwaysOnTop: document.getElementById('alwaysOnTop')
};

const IDLE_LINES = [
  '稳住，能赢',
  '小事，拿下',
  '别慌，有我',
  '冲一下下',
  '回血中',
  '漂亮，继续',
  '桌面喘口气',
  '我在盯着呢'
];

const AMBIENT_ACTION_SEQUENCE = ['silly', 'wave', 'dizzy', 'sleep'];
const AMBIENT_MIN_DELAY_MS = 30000;
const AMBIENT_MAX_DELAY_MS = 60000;
const IDLE_SLEEP_DELAY_MS = 180000;
const CLICK_ACTION_DELAY_MS = 280;

const ACTIONS = {
  dizzy: { src: '../assets/videos/filemonster_dizzy.webp', loop: true, durationMs: 3630, text: '转两圈，醒脑' },
  idle: { src: '../assets/videos/filemonster_idle.webp', loop: false, durationMs: 3630, text: IDLE_LINES[0] },
  silly: { src: '../assets/videos/filemonster_silly.webp', loop: false, durationMs: 3630, text: '摸一下，开窍' },
  sleep: { src: '../assets/videos/filemonster_sleep.webp', loop: true, durationMs: 3630, text: '回血，勿扰' },
  wave: { src: '../assets/videos/filemonster_wave.webp', loop: false, durationMs: 3630, text: '漂亮，过关' }
};

const CATEGORY_SPEECH = {
  image: ['图片归队', '颜值入库', '图像站好'],
  screenshot: ['截图入档', '证据稳了', '截图归位'],
  document: ['文档上架', '脑子减负', '纸面清醒'],
  folder: ['文件夹住好', '小区入住', '文件夹归队'],
  video: ['视频进窝', '别再流浪', '大片归档'],
  audio: ['音频收声', '耳朵放心', '声音归位'],
  archive: ['压缩包躺好', '别炸', '包袱收好'],
  code: ['代码归位', 'bug冷静', '代码坐好'],
  design: ['灵感有窝', '设计回家', '稿子站稳'],
  mixed: ['一锅端', '桌面退烧', '杂物归队'],
  empty: ['没挪动', '桌面很倔', '它不肯搬家']
};

const SCENE_SPEECH = {
  working: {
    drop: ['收到，处理中', '我先瞅瞅', '放这儿就行'],
    organize: ['开工，收桌', '整理启动', '我来归队']
  },
  success: {
    openVault: ['整理箱开门', '箱子在这儿', '仓库亮灯'],
    openTrash: ['回收站开门', '旧物有窝', '回收站在线'],
    undo: ['撤回成功', '时光倒带', '刚刚撤了']
  },
  failure: {
    generic: ['没收进去', '差点成功', '我卡了一下'],
    drop: ['没收进去', '这份有点倔', '拖拽卡住了'],
    noPath: ['路径迷路了', '没抓到文件', '入口空空'],
    noChange: ['它不肯搬家', '桌面很淡定', '没有可搬的'],
    settings: ['设置没站稳', '保存卡了一下', '开关打滑了'],
    open: ['门没打开', '路径打盹了', '箱子没醒'],
    canceled: ['好，先不动', '收到，暂停', '那就先放着']
  }
};

let currentAction = '';
let lastInteractionAt = Date.now();
let draggingWindow = false;
let panelCollapsed = true;
let hoverLock = false;
let pointerStart = null;
let didDrag = false;
const DRAG_THRESHOLD = 8;
const DOUBLE_CLICK_DELAY_MS = 280;
let mousePassthrough = false;
let resizingPet = false;
let activePointerId = null;
let actionTimer = null;
let clickActionTimer = null;
let ambientTimer = null;
let idleSleepTimer = null;
let ambientActionIndex = 0;
let ambientSchedulerStarted = false;
let suppressNextClick = false;
let lastPrimaryClickAt = 0;
let panelTransition = Promise.resolve();

function clearActionTimer() {
  if (actionTimer) {
    clearTimeout(actionTimer);
    actionTimer = null;
  }
}

function clearClickActionTimer() {
  if (clickActionTimer) {
    clearTimeout(clickActionTimer);
    clickActionTimer = null;
  }
}

function clearAmbientTimer() {
  if (ambientTimer) {
    clearTimeout(ambientTimer);
    ambientTimer = null;
  }
}

function clearIdleSleepTimer() {
  if (idleSleepTimer) {
    clearTimeout(idleSleepTimer);
    idleSleepTimer = null;
  }
}

function scheduleIdleSleep() {
  if (!ambientSchedulerStarted) return;
  clearIdleSleepTimer();
  const elapsed = Date.now() - lastInteractionAt;
  const delay = Math.max(0, IDLE_SLEEP_DELAY_MS - elapsed);
  idleSleepTimer = setTimeout(() => {
    idleSleepTimer = null;
    if (document.hidden || draggingWindow || pointerStart || resizingPet || currentAction !== 'idle') {
      scheduleIdleSleep();
      return;
    }
    if (Date.now() - lastInteractionAt >= IDLE_SLEEP_DELAY_MS) {
      playAction('sleep', { restart: true, loop: true, text: ACTIONS.sleep.text });
      return;
    }
    scheduleIdleSleep();
  }, delay);
}

function scheduleNextAmbientAction() {
  if (!ambientSchedulerStarted) return;
  clearAmbientTimer();
  const delay = AMBIENT_MIN_DELAY_MS + Math.random() * (AMBIENT_MAX_DELAY_MS - AMBIENT_MIN_DELAY_MS);
  ambientTimer = setTimeout(() => {
    ambientTimer = null;
    if (document.hidden || draggingWindow || pointerStart || resizingPet || currentAction !== 'idle') {
      scheduleNextAmbientAction();
      return;
    }
    const name = AMBIENT_ACTION_SEQUENCE[ambientActionIndex];
    ambientActionIndex = (ambientActionIndex + 1) % AMBIENT_ACTION_SEQUENCE.length;
    const action = ACTIONS[name] || ACTIONS.idle;
    const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
    playAction(name, { restart: true, loop: false, text: line, durationMs: action.durationMs });
  }, delay);
}

function startAmbientScheduler() {
  ambientSchedulerStarted = true;
  scheduleIdleSleep();
  scheduleNextAmbientAction();
}

function scheduleSingleClickAction() {
  clearClickActionTimer();
  clickActionTimer = setTimeout(() => {
    clickActionTimer = null;
    lastPrimaryClickAt = 0;
    touch();
    playAction('wave', { restart: true });
  }, CLICK_ACTION_DELAY_MS);
}

function handlePrimaryPointerClick() {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  const now = Date.now();
  if (now - lastPrimaryClickAt <= DOUBLE_CLICK_DELAY_MS) {
    lastPrimaryClickAt = 0;
    clearClickActionTimer();
    touch();
    playAction('dizzy', { restart: true, loop: true, text: ACTIONS.dizzy.text });
    actionTimer = setTimeout(() => {
      actionTimer = null;
      if (currentAction === 'dizzy') playAction('idle', { restart: true });
    }, ACTIONS.dizzy.durationMs * 2);
    return;
  }
  lastPrimaryClickAt = now;
  scheduleSingleClickAction();
}

function restartSprite(src) {
  if (petSprite.getAttribute('src') === src) {
    petSprite.removeAttribute('src');
  }
  petSprite.src = src;
}

function isPrimaryPointer(event) {
  return event.button === 0 || event.buttons === 1;
}

function getCurrentPetSize() {
  return normalizePetSize(ui.petSize.value);
}

function normalizePetSize(size) {
  return Math.min(360, Math.max(160, Number(size) || 220));
}

function setPetPreviewSize(size) {
  const petSize = normalizePetSize(size);
  petStage.style.setProperty('--pet-preview-size', `${petSize}px`);
  petInteractive.style.setProperty('--pet-preview-size', `${petSize}px`);
  ui.petSizeValue.textContent = `${petSize}px`;
  return petSize;
}

function commitPetSize(size) {
  const petSize = normalizePetSize(size);
  document.documentElement.style.setProperty('--pet-size', `${petSize}px`);
  petStage.style.setProperty('--pet-preview-size', `${petSize}px`);
  petInteractive.style.setProperty('--pet-preview-size', `${petSize}px`);
  ui.petSizeValue.textContent = `${petSize}px`;
  // 收起或展开都按实际尺寸调窗口，保证设置页贴着文件怪
  window.fileMonster.applyPetSize(petSize, !panelCollapsed);
  return petSize;
}

function syncPetSizeSlider(size) {
  const petSize = normalizePetSize(size);
  if (!resizingPet && String(ui.petSize.value) !== String(petSize)) {
    ui.petSize.value = String(petSize);
  }
  return petSize;
}

function applyPetSize(size, options = {}) {
  const petSize = commitPetSize(size);
  if (options.syncSlider !== false) syncPetSizeSlider(petSize);
  if (options.resizeWindow) {
    window.fileMonster.applyPetSize(petSize, !panelCollapsed);
  }
  return petSize;
}

function setSpeech(text) {
  speech.textContent = text;
  statusText.textContent = text;
}

function ensurePetVisible() {
  if (draggingWindow) return;
  const petSize = getCurrentPetSize();
  petStage.style.setProperty('--pet-preview-size', `${petSize}px`);
  petInteractive.style.setProperty('--pet-preview-size', `${petSize}px`);
  const action = ACTIONS[currentAction] || ACTIONS.idle;
  if (!petSprite.getAttribute('src')) restartSprite(action.src);
}

async function playAction(name, options = {}) {
  clearActionTimer();
  const actionToken = actionState.begin();
  const action = ACTIONS[name] || ACTIONS.idle;
  const shouldRestart = options.restart || currentAction !== name || petSprite.getAttribute('src') !== action.src;
  currentAction = ACTIONS[name] ? name : 'idle';
  setSpeech(options.text || action.text);

  if (shouldRestart) {
    restartSprite(action.src);
  }

  if (!actionState.isCurrent(actionToken)) return;
  if (currentAction === 'idle') {
    scheduleNextAmbientAction();
    scheduleIdleSleep();
    return;
  }
  const loop = options.loop ?? action.loop;
  if (!loop) {
    actionTimer = setTimeout(() => {
      actionTimer = null;
      if (!actionState.isCurrent(actionToken)) return;
      if (options.backToIdle !== false) playAction('idle', { restart: true });
    }, options.durationMs ?? action.durationMs);
  }
}

async function playFailureAction(message) {
  await playAction('dizzy', { restart: true, loop: false, text: message || ACTIONS.dizzy.text });
}

function pickLine(lines) {
  if (!Array.isArray(lines) || !lines.length) return '';
  return lines[Math.floor(Math.random() * lines.length)];
}

function touch() {
  lastInteractionAt = Date.now();
  scheduleIdleSleep();
  scheduleNextAmbientAction();
}

function getCategorySpeechKey(category) {
  const name = String(category || '');
  if (name.includes('截图')) return 'screenshot';
  if (name.includes('图片')) return 'image';
  if (name.includes('视频')) return 'video';
  if (name.includes('音频')) return 'audio';
  if (name.includes('文件夹')) return 'folder';
  if (name.includes('PDF') || name.includes('文档') || name.includes('表格') || name.includes('演示')) return 'document';
  if (name.includes('压缩')) return 'archive';
  if (name.includes('代码')) return 'code';
  if (name.includes('设计')) return 'design';
  return 'mixed';
}

function buildOrganizeSpeech(result) {
  const movedItems = (result?.moved || []).filter(item => !item.deleted);
  if (!movedItems.length) return pickLine(CATEGORY_SPEECH.empty);
  const counts = new Map();
  for (const item of movedItems) {
    const key = getCategorySpeechKey(item.category);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size > 1) return pickLine(CATEGORY_SPEECH.mixed);
  const [key] = counts.keys();
  return pickLine(CATEGORY_SPEECH[key] || CATEGORY_SPEECH.mixed);
}

function buildFailureSpeech(result, scene) {
  const error = result?.errors?.find(item => item?.message)?.message;
  const message = result?.message || error;
  const failure = SCENE_SPEECH.failure;
  if (scene && failure[scene]) return pickLine(failure[scene]);
  if (String(message || '').includes('取消')) return pickLine(failure.canceled);
  if (String(message || '').includes('没有文件被移动')) return pickLine(failure.noChange);
  if (String(message || '').includes('路径')) return pickLine(failure.noPath);
  return pickLine(failure.generic);
}

function logResult(title, result) {
  const deleted = result?.deleted?.length || 0;
  const movedItems = (result?.moved || []).filter(item => !item.deleted);
  const moved = movedItems.length;
  const skipped = result?.skipped?.length || 0;
  const errors = result?.errors?.length || 0;
  const restored = result?.restored?.length || 0;
  const lines = [`${title}`];
  if (moved) lines.push(`已移动：${moved} 个`);
  if (deleted) lines.push(`已删除空文件夹：${deleted} 个`);
  if (restored) lines.push(`已恢复：${restored} 个`);
  if (skipped) lines.push(`已跳过：${skipped} 个`);
  if (errors) lines.push(`错误：${errors} 个`);
  if (result?.message) lines.push(result.message);
  movedItems.slice(0, 8).forEach(item => lines.push(`✓ ${item.category}: ${item.target}`));
  if (result?.deleted?.length) result.deleted.slice(0, 8).forEach(item => lines.push(`空文件夹已删除: ${item.source}`));
  if (result?.skipped?.length) result.skipped.slice(0, 5).forEach(item => lines.push(`- ${item.reason}: ${item.source}`));
  if (result?.errors?.length) result.errors.slice(0, 5).forEach(item => lines.push(`! ${item.message}`));
  statusText.textContent = lines.slice(0, 2).join(' · ');
}

async function runWithAction(workingAction, task, successTitle, options = {}) {
  touch();
  // 使用动作本身的 loop 设置：scan 等自带 loop:true 的会循环播放，
  // notify/thinking 等一次性动画只播一遍
  const actionConfig = ACTIONS[workingAction] || ACTIONS.idle;
  const workingLoop = options.workingLoop ?? actionConfig.loop;
  await playAction(workingAction, { restart: true, loop: workingLoop });
  try {
    const result = await task();
    if (options.requiresFileChange && !operationResult.didMutateFiles(result)) {
      result.ok = false;
      result.message = result.message || '没有文件被移动，请查看跳过原因';
    }
    logResult(successTitle, result);
    if (result?.message && String(result.message).includes('已取消')) {
      await playAction('idle', { restart: true, text: '好，先不收拾' });
      return result;
    }
    if (result.ok === false || (result.errors && result.errors.length)) await playFailureAction(buildFailureSpeech(result, options.failureScene));
    else await playAction('wave', { restart: true, text: options.successScene ? pickLine(SCENE_SPEECH.success[options.successScene]) : buildOrganizeSpeech(result) });
    return result;
  } catch (err) {
    statusText.textContent = err.message;
    await playFailureAction(buildFailureSpeech({ message: err.message }, options.failureScene));
    return null;
  }
}

async function loadSettingsToUi(settings) {
  ui.vaultPath.value = settings.vaultPath || '';
  ui.safeMode.checked = Boolean(settings.safeMode);
  ui.moveFolders.checked = Boolean(settings.moveFolders);
  ui.addDatePrefix.checked = Boolean(settings.addDatePrefix);
  ui.launchAtLogin.checked = Boolean(settings.launchAtLogin);
  ui.alwaysOnTop.checked = Boolean(settings.alwaysOnTop);
  const petSize = normalizePetSize(settings.petSize ?? 220);
  document.documentElement.style.setProperty('--pet-size', `${petSize}px`);
  petStage.style.setProperty('--pet-preview-size', `${petSize}px`);
  petInteractive.style.setProperty('--pet-preview-size', `${petSize}px`);
  ui.petSizeValue.textContent = `${petSize}px`;
  if (!resizingPet) ui.petSize.value = String(petSize);
}

async function saveCurrentSettings(options = {}) {
  try {
    const currentSettings = await window.fileMonster.getSettings();
    const settings = {
      vaultPath: ui.vaultPath.value.trim(),
      petSize: normalizePetSize(ui.petSize.value),
      safeMode: ui.safeMode.checked,
      moveFolders: ui.moveFolders.checked,
      addDatePrefix: ui.addDatePrefix.checked,
      launchAtLogin: ui.launchAtLogin.checked,
      alwaysOnTop: ui.alwaysOnTop.checked,
      screenshotKeywords: currentSettings.screenshotKeywords,
      rules: currentSettings.rules
    };
    const saved = await window.fileMonster.saveSettings(settings);
    await loadSettingsToUi(saved);
    applyPetSize(saved.petSize, { resizeWindow: true });
    const vaultAdjusted = String(settings.vaultPath || '').trim() !== String(saved.vaultPath || '').trim();
    statusText.textContent = options.statusText || (vaultAdjusted ? '路径不安全，已自动回退' : '设置已自动保存');
    return saved;
  } catch (err) {
    statusText.textContent = '设置自动保存失败：' + err.message;
    await playFailureAction(pickLine(SCENE_SPEECH.failure.settings));
    return null;
  }
}

async function initSettings() {
  const settings = await window.fileMonster.getSettings();
  await loadSettingsToUi(settings);
  applyPetSize(settings.petSize ?? 220, { resizeWindow: true });
}

function getDroppedPaths(event) {
  return Array.from(event.dataTransfer.files || [])
    .map(file => window.fileMonster.getPathForFile(file) || file.path || '')
    .filter(Boolean);
}

function getMousePassthrough() {
  // 桌面宠物窗口必须始终可交互，鼠标穿透只在特定操作中被显式关闭后恢复
  return false;
}

function updateMousePassthrough() {
  const shouldPass = getMousePassthrough();
  if (shouldPass !== mousePassthrough) {
    mousePassthrough = shouldPass;
    window.fileMonster.setMousePassthrough(shouldPass);
  }
}

petInteractive.addEventListener('dragenter', event => {
  event.preventDefault();
  window.fileMonster.setMousePassthrough(false);
});

petInteractive.addEventListener('dragover', event => {
  event.preventDefault();
  touch();
  petStage.classList.add('drop-ready');
  if (currentAction !== 'dizzy') playAction('dizzy', { restart: true, loop: true });
});

petInteractive.addEventListener('dragleave', event => {
  if (event.relatedTarget && petInteractive.contains(event.relatedTarget)) return;
  petStage.classList.remove('drop-ready');
  if (currentAction === 'dizzy') playAction('idle', { restart: true });
});

petInteractive.addEventListener('drop', async event => {
  event.preventDefault();
  touch();
  petStage.classList.remove('drop-ready');
  const paths = getDroppedPaths(event);
  if (!paths.length) {
    statusText.textContent = '没有读取到文件路径';
    await playFailureAction(pickLine(SCENE_SPEECH.failure.noPath));
    mousePassthrough = getMousePassthrough();
    window.fileMonster.setMousePassthrough(mousePassthrough);
    return;
  }
  await playAction('dizzy', { restart: true, loop: false, text: pickLine(SCENE_SPEECH.working.drop) });
  setTimeout(async () => {
    try {
      await runWithAction('dizzy', () => window.fileMonster.organizePaths(paths), '拖拽整理完成', { requiresFileChange: true, workingLoop: false, failureScene: 'drop' });
    } finally {
      mousePassthrough = getMousePassthrough();
      window.fileMonster.setMousePassthrough(mousePassthrough);
    }
  }, 500);
});

function startWindowDrag() {
  if (draggingWindow) return;
  draggingWindow = true;
  petStage.classList.add('dragging');
  // 拖动时只改文案和样式，不切换当前动画
  setSpeech(ACTIONS.dizzy.text);
  window.fileMonster.dragStart();
}

function endWindowDrag() {
  const wasDragging = draggingWindow;
  petStage.classList.remove('dragging');
  draggingWindow = false;
  pointerStart = null;
  didDrag = false;
  activePointerId = null;
  // 无论是否在拖，都通知主进程停掉拖拽定时器，避免右键后窗口还在跑
  window.fileMonster.dragEnd();
  if (wasDragging) {
    suppressNextClick = true;
    if (currentAction === 'idle' || !currentAction) {
      setSpeech(IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)]);
    } else {
      setSpeech((ACTIONS[currentAction] || ACTIONS.idle).text);
    }
    requestAnimationFrame(() => ensurePetVisible());
  }
}

function releasePetPointer(pointerId) {
  if (pointerId === null || pointerId === undefined) return;
  try {
    if (petInteractive.hasPointerCapture(pointerId)) {
      petInteractive.releasePointerCapture(pointerId);
    }
  } catch {}
}

function resetPointerState() {
  releasePetPointer(activePointerId);
  endWindowDrag();
}

petInteractive.addEventListener('pointerdown', event => {
  // 右键：只开关设置，绝不进入拖拽
  if (event.button === 2) {
    event.preventDefault();
    resetPointerState();
    window.fileMonster.setMousePassthrough(false);
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  if (mousePassthrough) {
    mousePassthrough = false;
    window.fileMonster.setMousePassthrough(false);
  }
  activePointerId = event.pointerId;
  pointerStart = { x: event.clientX, y: event.clientY };
  didDrag = false;
  touch();
  try {
    petInteractive.setPointerCapture(event.pointerId);
  } catch {}
});

petInteractive.addEventListener('contextmenu', event => {
  event.preventDefault();
  event.stopPropagation();
  resetPointerState();
  window.fileMonster.setMousePassthrough(false);
  setPanelCollapsed(!panelCollapsed);
});


// 窗口移动时 Windows 常会丢失 pointer capture，拖动中要重新捕获，不能结束拖拽
petInteractive.addEventListener('lostpointercapture', event => {
  if (!draggingWindow || activePointerId === null) return;
  if (event.pointerId !== activePointerId) return;
  try {
    petInteractive.setPointerCapture(activePointerId);
  } catch {}
});

window.addEventListener('pointermove', event => {
  if (!pointerStart || activePointerId !== event.pointerId) return;
  // 必须按住左键才允许拖动，右键移动不算
  if ((event.buttons & 1) === 0) {
    resetPointerState();
    return;
  }
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (!didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    didDrag = true;
    startWindowDrag();
  }
});

window.addEventListener('pointerup', event => {
  if (resizingPet) endPetResize();
  if (event.button === 2) {
    resetPointerState();
    return;
  }
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  const wasDrag = didDrag;
  const pointerId = activePointerId;
  releasePetPointer(pointerId);

  if (!pointerStart) {
    endWindowDrag();
    return;
  }

  if (!wasDrag && event.button === 0) {
    pointerStart = null;
    activePointerId = null;
    didDrag = false;
    handlePrimaryPointerClick();
    return;
  }

  endWindowDrag();
});

window.addEventListener('pointercancel', event => {
  if (resizingPet) endPetResize();
  if (activePointerId !== null && event.pointerId !== activePointerId) return;
  resetPointerState();
});

window.addEventListener('blur', () => {
  if (resizingPet) endPetResize();
  if (pointerStart || draggingWindow) resetPointerState();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (resizingPet) endPetResize();
    if (pointerStart || draggingWindow) resetPointerState();
  } else {
    setTimeout(() => {
      if (document.hidden || draggingWindow || currentAction === 'sleep') return;
      ensurePetVisible();
    }, 100);
  }
});

petInteractive.addEventListener('mouseenter', () => {
  if (hoverLock || draggingWindow || !panelCollapsed) return;
  hoverLock = true;
  touch();
  playAction('silly', { restart: true });
  setTimeout(() => { hoverLock = false; }, 1800);
});

ui.btnOrganize.addEventListener('click', () => runWithAction('dizzy', () => window.fileMonster.organizeDesktop(), '桌面整理完成', { requiresFileChange: true, failureScene: 'generic' }));
ui.btnScreenshots.addEventListener('click', () => runWithAction('dizzy', () => window.fileMonster.organizeScreenshots(), '截图整理完成', { requiresFileChange: true, failureScene: 'generic' }));
ui.btnOpenVault.addEventListener('click', () => runWithAction('silly', () => window.fileMonster.openVault(), '已打开整理箱', { successScene: 'openVault', failureScene: 'open' }));
ui.btnOpenTrash.addEventListener('click', () => runWithAction('silly', () => window.fileMonster.openTrash(), '已打开回收站', { successScene: 'openTrash', failureScene: 'open' }));
ui.btnUndo.addEventListener('click', () => runWithAction('silly', () => window.fileMonster.undoOrganize(), '撤销整理完成', { successScene: 'undo', failureScene: 'generic' }));
ui.btnBrowseVault.addEventListener('click', async () => {
  const result = await window.fileMonster.chooseVaultPath();
  if (!result?.ok || !result.path) return;
  ui.vaultPath.value = result.path;
  await saveCurrentSettings({ statusText: '整理箱路径已更新' });
});

function endPetResize() {
  if (!resizingPet) return;
  resizingPet = false;
  mousePassthrough = getMousePassthrough();
  window.fileMonster.setMousePassthrough(mousePassthrough);
}

ui.petSize.addEventListener('pointerdown', event => {
  event.stopPropagation();
  resizingPet = true;
  mousePassthrough = false;
  window.fileMonster.setMousePassthrough(false);
});

ui.petSize.addEventListener('input', () => {
  touch();
  setPetPreviewSize(ui.petSize.value);
});

ui.petSize.addEventListener('change', () => {
  endPetResize();
  commitPetSize(ui.petSize.value);
  saveCurrentSettings();
});

ui.petSize.addEventListener('pointercancel', () => {
  endPetResize();
});

ui.vaultPath.addEventListener('change', () => {
  saveCurrentSettings();
});

for (const checkbox of [ui.safeMode, ui.moveFolders, ui.addDatePrefix, ui.launchAtLogin, ui.alwaysOnTop]) {
  checkbox.addEventListener('change', () => {
    saveCurrentSettings();
  });
}

function setPanelCollapsed(collapsed) {
  panelTransition = panelTransition.catch(() => {}).then(async () => {
    if (panelCollapsed === collapsed) return;

    resetPointerState();
    panelCollapsed = collapsed;
    appShell.classList.toggle('collapsed', panelCollapsed);
    await window.fileMonster.togglePanelSize(!panelCollapsed, getCurrentPetSize());
    mousePassthrough = getMousePassthrough();
    window.fileMonster.setMousePassthrough(mousePassthrough);

    const recover = () => {
      ensurePetVisible();
      petSprite.style.transform = 'translateZ(0)';
    };
    requestAnimationFrame(() => {
      recover();
      setTimeout(recover, 80);
    });
  });
  return panelTransition;
}

ui.btnCollapse.addEventListener('click', () => setPanelCollapsed(!panelCollapsed));
ui.btnMinimize.addEventListener('click', () => window.fileMonster.minimize());
ui.btnQuit.addEventListener('click', () => window.fileMonster.quit());

window.fileMonster.onMenuAction(action => {
  const map = {
    'organize-desktop': () => ui.btnOrganize.click(),
    'organize-screenshots': () => ui.btnScreenshots.click(),
    'undo-organize': () => ui.btnUndo.click(),
    'toggle-panel': () => ui.btnCollapse.click()
  };
  if (map[action]) map[action]();
});

window.fileMonster.onSettingsChanged(async settings => {
  if (resizingPet) return;
  await loadSettingsToUi(settings);
  applyPetSize(settings.petSize ?? 220, { resizeWindow: true });
});


setInterval(() => {
  if (currentAction !== 'idle') return;
  const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
  setSpeech(line);
}, 18000);


window.addEventListener('mousemove', event => {
  if (draggingWindow || pointerStart) return;
  if (event.target.closest('#petSize')) return;
  const wasSleeping = currentAction === 'sleep';
  touch();
  if (wasSleeping) playAction('wave', { restart: true });
  updateMousePassthrough(event);
});


window.fileMonster.onWindowResized(() => {
  requestAnimationFrame(() => ensurePetVisible());
});

setInterval(() => {
  if (document.hidden || draggingWindow) return;
  ensurePetVisible();
}, 15000);

initSettings().then(async () => {
  await setPanelCollapsed(true);
  mousePassthrough = getMousePassthrough();
  window.fileMonster.setMousePassthrough(mousePassthrough);
  playAction('idle', { restart: true });
  startAmbientScheduler();
});
