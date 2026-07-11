const video = document.getElementById('petVideo');
const petFreeze = document.getElementById('petFreeze');
const appShell = document.getElementById('app');
const petStage = document.getElementById('petStage');
const petInteractive = document.getElementById('petInteractive');
const speech = document.getElementById('speech');
const statusText = document.getElementById('statusText');
const resultLog = document.getElementById('resultLog');
const actionState = window.fileMonsterActionState.createActionState();
const operationResult = window.fileMonsterOperationResult;
const inputPolicy = window.fileMonsterInputPolicy;

const ui = {
  btnOrganize: document.getElementById('btnOrganize'),
  btnScreenshots: document.getElementById('btnScreenshots'),
  btnOpenVault: document.getElementById('btnOpenVault'),
  btnUndo: document.getElementById('btnUndo'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),
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
  alwaysOnTop: document.getElementById('alwaysOnTop'),
  rulesEditor: document.getElementById('rulesEditor')
};

const IDLE_LINES = [
  '桌面躺平中…',
  '今日运势：宜整理',
  '摸鱼待机，文件自来',
  '充电完毕，随时开吃',
  '我在蹲你的桌面',
  '乌云散尽，等你投喂'
];

// 待机时轮换的短动作；循环类视频会播放数秒后回 idle
const IDLE_CLIP_POOL = ['thinking', 'hover', 'notify', 'scan', 'sleep'];

const ACTIONS = {
  idle: { src: '../assets/videos/filemonster_idle.webm', loop: false, text: IDLE_LINES[0] },
  drag: { src: '../assets/videos/filemonster_drag.webm', loop: true, text: '嘿嘿，带我去哪儿玩' },
  work: { src: '../assets/videos/filemonster_work.webm', loop: true, text: '咔嚓咔嚓，桌面变清爽' },
  success: { src: '../assets/videos/filemonster_success.webm', loop: false, text: '耶！又收拾干净一块' },
  error: { src: '../assets/videos/filemonster_error.webm', loop: false, text: '啊哦，这波翻车了…' },
  sleep: { src: '../assets/videos/filemonster_sleep.webm', loop: true, text: '💤 Zzz… 做梦都在分类' },
  wake: { src: '../assets/videos/filemonster_wake.webm', loop: false, text: '谁戳我？起来干活！' },
  scan: { src: '../assets/videos/filemonster_scan.webm', loop: true, text: '雷达启动，扫扫你的桌面' },
  hover: { src: '../assets/videos/filemonster_hover.webm', loop: false, text: '有文件？尽管砸过来' },
  notify: { src: '../assets/videos/filemonster_notify.webm', loop: false, text: '叮咚～有事找你' },
  thinking: { src: '../assets/videos/filemonster_thinking.webm', loop: false, text: '让我想想…这啥玩意儿' },
  ingest: { src: '../assets/videos/filemonster_ingest.webm', loop: false, text: '嗷呜～开吃！' }
};

let currentAction = '';
let lastInteractionAt = Date.now();
let draggingWindow = false;
let panelCollapsed = true;
let hoverLock = false;
let pointerStart = null;
let didDrag = false;
const DRAG_THRESHOLD = 8;
let mousePassthrough = false;
let resizingPet = false;
let activePointerId = null;
let idleBlinkTimer = null;
let idleHolding = false;
let panelTransition = Promise.resolve();
let lastGoodFrame = null;

function hideIdleFreezeFrame() {
  petFreeze.classList.remove('is-on');
  video.classList.remove('is-frozen');
}

function captureVideoFrame() {
  const w = video.videoWidth || 0;
  const h = video.videoHeight || 0;
  if (!w || !h) return false;
  if (petFreeze.width !== w) petFreeze.width = w;
  if (petFreeze.height !== h) petFreeze.height = h;
  try {
    const ctx = petFreeze.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(video, 0, 0, w, h);
    const sample = ctx.getImageData(w >> 1, h >> 1, 1, 1).data;
    if (sample[3] === 0) return false;
    lastGoodFrame = { w, h, time: video.currentTime };
    return true;
  } catch {
    return false;
  }
}

function showIdleFreezeFrame() {
  if (captureVideoFrame()) {
    petFreeze.classList.add('is-on');
    video.classList.add('is-frozen');
  } else if (lastGoodFrame) {
    petFreeze.classList.add('is-on');
    video.classList.add('is-frozen');
  } else {
    hideIdleFreezeFrame();
  }
}

function clearIdleBlinkTimer() {
  if (idleBlinkTimer) {
    clearTimeout(idleBlinkTimer);
    idleBlinkTimer = null;
  }
  idleHolding = false;
  // 不隐藏冻结帧 —— 交给 playAction 在视频真正开始播放后隐藏，
  // 避免过渡期（旧动作→新动作）画面短暂消失
}

function holdIdleRestPose() {
  idleHolding = true;
  video.loop = false;
  video.onended = null;

  // 立即用预缓存帧冻结画面，避免视频结束后出现空白帧闪烁
  if (lastGoodFrame) {
    petFreeze.classList.add('is-on');
    video.classList.add('is-frozen');
  }

  const d = video.duration;
  const snap = () => {
    if (!idleHolding || currentAction !== 'idle') return;
    if (captureVideoFrame()) {
      petFreeze.classList.add('is-on');
      video.classList.add('is-frozen');
    }
    video.pause();
  };
  if (d && Number.isFinite(d)) {
    const seekTarget = Math.max(0, d - 0.05);
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      snap();
    };
    video.addEventListener('seeked', onSeeked);
    try {
      video.currentTime = seekTarget;
    } catch {
      snap();
    }
  } else {
    snap();
  }
}

function waitForVideoFrame() {
  return new Promise(resolve => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      video.removeEventListener('timeupdate', onTime);
      resolve();
    };
    const onTime = () => {
      if (video.currentTime > 0) done();
    };
    video.addEventListener('timeupdate', onTime);
    // 兜底：最多等 150ms，防止 timeupdate 永不触发导致卡死
    setTimeout(done, 150);
  });
}

function scheduleNextIdleBlink() {
  if (idleBlinkTimer) {
    clearTimeout(idleBlinkTimer);
    idleBlinkTimer = null;
  }
  holdIdleRestPose();
  const delay = 2000 + Math.random() * 1500; // 2–3.5 秒，缩短末帧停顿
  idleBlinkTimer = setTimeout(() => {
    idleBlinkTimer = null;
    if (currentAction !== 'idle') {
      clearIdleBlinkTimer();
      return;
    }
    if (draggingWindow || pointerStart || document.hidden) {
      scheduleNextIdleBlink();
      return;
    }
    replayIdleBlink();
  }, delay);
}

async function replayIdleBlink() {
  idleHolding = false;
  currentAction = 'idle';
  video.loop = false;
  video.onended = null;
  try { video.currentTime = 0; } catch {}
  let played = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await video.play();
      played = true;
      break;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 120));
    }
  }
  if (!played) {
    scheduleNextIdleBlink();
    return;
  }
  // 等视频真正渲染出帧后再移除冻结帧，避免中间出现空白闪烁
  await waitForVideoFrame();
  hideIdleFreezeFrame();
  video.onended = () => {
    if (currentAction !== 'idle') return;
    scheduleNextIdleBlink();
  };
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

  // 冻结帧模式下：视频暂停中，不强行播放（会破坏冻结帧），
  // 仅确保视频源有效供下次 blink 使用
  if (idleHolding) {
    if (!video.currentSrc && currentAction) {
      const action = ACTIONS[currentAction] || ACTIONS.idle;
      video.src = action.src;
    }
    return;
  }

  // 只恢复播放，不要 video.load()，否则透明视频会闪没
  if (video.paused) {
    video.play().catch(() => {
      const action = ACTIONS[currentAction] || ACTIONS.idle;
      if (!video.currentSrc) {
        video.src = action.src;
      }
      video.play().catch(() => {});
    });
  }
}

async function playAction(name, options = {}) {
  clearIdleBlinkTimer();
  const actionToken = actionState.begin();
  const action = ACTIONS[name] || ACTIONS.idle;
  const shouldRestart = options.restart || currentAction !== name;
  currentAction = name;
  video.loop = options.loop ?? action.loop;
  setSpeech(options.text || action.text);
  video.onended = null;

  if (shouldRestart) {
    const reuseIdle = name === 'idle' && /filemonster_idle\.webm/i.test(video.currentSrc || video.src || '');
    if (reuseIdle) {
      try { video.currentTime = 0; } catch {}
    } else {
      // 切换视频源前先用冻结帧遮挡，避免 src 切换期间出现空白帧
      if (!video.classList.contains('is-frozen')) {
        const captured = !video.paused && captureVideoFrame();
        if (captured || lastGoodFrame) {
          petFreeze.classList.add('is-on');
          video.classList.add('is-frozen');
        }
      }
      video.src = action.src;
      try { video.currentTime = 0; } catch {}
    }
  }

  // 最多重试 3 次播放，所有异常被捕获以防崩溃
  let played = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await video.play();
      played = true;
      break;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 120));
    }
  }

  if (!actionState.isCurrent(actionToken)) return;

  // 播放成功后等待实际帧渲染，再隐藏冻结帧
  if (played) {
    await waitForVideoFrame();
    if (!actionState.isCurrent(actionToken)) return;
    hideIdleFreezeFrame();
  }

  video.onended = () => {
    if (!actionState.isCurrent(actionToken) || video.loop) return;
    if (name === 'idle') {
      scheduleNextIdleBlink();
      return;
    }
    if (options.backToIdle !== false) playAction('idle', { restart: true });
  };
}

function touch() {
  lastInteractionAt = Date.now();
  if (idleClipTimeout) {
    clearTimeout(idleClipTimeout);
    idleClipTimeout = null;
  }
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
  resultLog.textContent = lines.join('\n');
}

async function runWithAction(workingAction, task, successTitle, options = {}) {
  touch();
  // 使用动作本身的 loop 设置：scan 等自带 loop:true 的会循环播放，
  // notify/thinking 等一次性动画只播一遍
  const actionConfig = ACTIONS[workingAction] || ACTIONS.idle;
  await playAction(workingAction, { restart: true, loop: actionConfig.loop });
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
    if (result.ok === false || (result.errors && result.errors.length)) await playAction('error', { restart: true });
    else await playAction('success', { restart: true });
    return result;
  } catch (err) {
    resultLog.textContent = err.message;
    await playAction('error', { restart: true, text: '操作失败：' + err.message });
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
  ui.rulesEditor.value = JSON.stringify(settings.rules || {}, null, 2);
  const petSize = normalizePetSize(settings.petSize ?? 220);
  document.documentElement.style.setProperty('--pet-size', `${petSize}px`);
  petStage.style.setProperty('--pet-preview-size', `${petSize}px`);
  petInteractive.style.setProperty('--pet-preview-size', `${petSize}px`);
  ui.petSizeValue.textContent = `${petSize}px`;
  if (!resizingPet) ui.petSize.value = String(petSize);
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
  if (currentAction !== 'scan' && currentAction !== 'work') playAction('scan', { restart: true, loop: true });
});

petInteractive.addEventListener('dragleave', event => {
  if (event.relatedTarget && petInteractive.contains(event.relatedTarget)) return;
  petStage.classList.remove('drop-ready');
  if (currentAction === 'scan') playAction('idle', { restart: true });
});

petInteractive.addEventListener('drop', async event => {
  event.preventDefault();
  touch();
  petStage.classList.remove('drop-ready');
  const paths = getDroppedPaths(event);
  if (!paths.length) {
    resultLog.textContent = '没有读取到文件路径。请把文件/文件夹拖到文件怪身上再试。';
    await playAction('error', { restart: true });
    mousePassthrough = getMousePassthrough();
    window.fileMonster.setMousePassthrough(mousePassthrough);
    return;
  }
  await playAction('ingest', { restart: true });
  setTimeout(async () => {
    try {
      await runWithAction('work', () => window.fileMonster.organizePaths(paths), '拖拽整理完成', { requiresFileChange: true });
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
  // 拖动时只改文案和样式，绝不重载视频，否则透明 WebM 会直接消失
  setSpeech(ACTIONS.drag.text);
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
    // Alt+Tab 返回时，GPU 可能丢失 WebM 透明通道，尝试恢复视频
    setTimeout(() => {
      if (document.hidden || draggingWindow || currentAction === 'sleep') return;
      if (video.paused || !video.currentSrc) {
        const action = ACTIONS[currentAction] || ACTIONS.idle;
        if (!video.currentSrc) video.src = action.src;
        video.play().catch(() => {});
      }
    }, 100);
  }
});

petInteractive.addEventListener('mouseenter', () => {
  if (hoverLock || draggingWindow || !panelCollapsed) return;
  hoverLock = true;
  touch();
  // 与拖动相同：只改文案，禁止 playAction/video.load()，否则透明 WebM 会直接消失
  setSpeech(ACTIONS.hover.text);
  setTimeout(() => { hoverLock = false; }, 1800);
});

ui.btnOrganize.addEventListener('click', () => runWithAction('scan', () => window.fileMonster.organizeDesktop(), '桌面整理完成', { requiresFileChange: true }));
ui.btnScreenshots.addEventListener('click', () => runWithAction('scan', () => window.fileMonster.organizeScreenshots(), '截图整理完成', { requiresFileChange: true }));
ui.btnOpenVault.addEventListener('click', () => runWithAction('notify', () => window.fileMonster.openVault(), '已打开整理箱'));
ui.btnUndo.addEventListener('click', () => runWithAction('thinking', () => window.fileMonster.undoOrganize(), '撤销整理完成'));

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
});

ui.petSize.addEventListener('pointercancel', () => {
  endPetResize();
});

ui.btnSaveSettings.addEventListener('click', async () => {
  try {
    const rules = JSON.parse(ui.rulesEditor.value || '{}');
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
      rules
    };
    const saved = await window.fileMonster.saveSettings(settings);
    await loadSettingsToUi(saved);
    applyPetSize(saved.petSize, { resizeWindow: true });
    const vaultAdjusted = String(settings.vaultPath || '').trim() !== String(saved.vaultPath || '').trim();
    resultLog.textContent = vaultAdjusted
      ? `设置已保存。整理箱路径不安全，已回退为：\n${saved.vaultPath}`
      : '设置已保存。';
    await playAction('success', { restart: true });
  } catch (err) {
    resultLog.textContent = '规则 JSON 格式错误：' + err.message;
    await playAction('error', { restart: true });
  }
});

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
      if (!video.paused) {
        const t = video.currentTime;
        if (Number.isFinite(t)) {
          try { video.currentTime = t; } catch {}
        }
      }
      // 窗口 resize 后触发 GPU 重绘，避免透明通道丢失
      video.style.transform = 'translateZ(0)';
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
  const idleFor = Date.now() - lastInteractionAt;
  if (idleFor > 60000 && currentAction !== 'sleep') playAction('sleep', { restart: true, loop: true });
}, 5000);

setInterval(() => {
  if (currentAction !== 'idle') return;
  const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
  setSpeech(line);
}, 18000);

// 待机时自动切换短动作视频；非循环类播完回 idle，循环类播放 6-8 秒后回 idle
const IDLE_LOOP_DURATION = 7000;
let idleClipTimeout = null;

setInterval(() => {
  if (document.hidden || draggingWindow || pointerStart || resizingPet) return;
  if (currentAction !== 'idle' || idleHolding) return;
  if (Date.now() - lastInteractionAt < 6000) return;
  const name = IDLE_CLIP_POOL[Math.floor(Math.random() * IDLE_CLIP_POOL.length)];
  const line = IDLE_LINES[Math.floor(Math.random() * IDLE_LINES.length)];
  const actionDef = ACTIONS[name] || ACTIONS.idle;
  const shouldLoop = actionDef.loop;
  playAction(name, { restart: true, loop: shouldLoop, text: line });
  if (shouldLoop) {
    if (idleClipTimeout) clearTimeout(idleClipTimeout);
    idleClipTimeout = setTimeout(() => {
      idleClipTimeout = null;
      if (currentAction === name) playAction('idle', { restart: true });
    }, IDLE_LOOP_DURATION + Math.random() * 2000);
  }
}, 12000);

window.addEventListener('mousemove', event => {
  if (draggingWindow || pointerStart) return;
  if (event.target.closest('#petSize')) return;
  const wasSleeping = currentAction === 'sleep';
  touch();
  if (wasSleeping) playAction('wake', { restart: true });
  updateMousePassthrough(event);
});

video.addEventListener('timeupdate', () => {
  if (video.paused || video.ended) return;
  // 在视频播放后半段持续缓存有效帧，确保 onended/切换时已有可用冻结帧
  const d = video.duration;
  if (d && Number.isFinite(d) && video.currentTime > d * 0.4) {
    captureVideoFrame();
  }
});

video.addEventListener('error', () => {
  playAction('idle', { restart: true });
});

video.addEventListener('stalled', () => {
  ensurePetVisible();
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
});
