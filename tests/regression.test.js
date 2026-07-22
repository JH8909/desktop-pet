const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { restoreBatch, buildNextBatch } = require('../src/organizer-history');
const { createActionState } = require('../src/action-state');
const { canOrganizeSource } = require('../src/organize-scope');
const { didMutateFiles } = require('../src/operation-result');
const { shouldPassThroughMouse } = require('../src/input-policy');

function hasImageMagick() {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function testKeepsFailedUndoItems() {
  const batch = [
    { source: 'desktop/a.txt', target: 'vault/a.txt' },
    { source: 'desktop/b.txt', target: 'vault/b.txt' }
  ];
  const result = await restoreBatch(batch, {
    exists: async target => target === 'vault/a.txt',
    uniquePath: async source => source,
    ensureDir: async () => {},
    moveItem: async (target, source) => {
      assert.equal(target, 'vault/a.txt');
      assert.equal(source, 'desktop/a.txt');
    }
  });
  assert.deepEqual(result.restored, [{ source: 'vault/a.txt', target: 'desktop/a.txt' }]);
  assert.equal(result.errors.length, 1);
  assert.deepEqual(result.remainingItems, [batch[1]]);
}

function testDropUndoBatchAccumulatesMovedFiles() {
  const previous = {
    time: 1,
    reason: 'drop',
    items: [
      { source: 'desktop/a.txt', target: 'vault/a.txt' },
      { source: 'desktop/b.txt', target: 'vault/b.txt' }
    ]
  };
  const moved = [{ source: 'desktop/c.txt', target: 'vault/c.txt' }];

  const batch = buildNextBatch(previous, moved, { reason: 'drop' });

  assert.equal(batch.reason, 'drop');
  assert.deepEqual(batch.items, [...previous.items, ...moved]);
}

function testNonDropUndoBatchReplacesPreviousBatch() {
  const previous = {
    time: 1,
    reason: 'drop',
    items: [{ source: 'desktop/a.txt', target: 'vault/a.txt' }]
  };
  const moved = [
    { source: 'desktop/b.txt', target: 'vault/b.txt' },
    { source: 'desktop/c.txt', target: 'vault/c.txt' }
  ];

  const batch = buildNextBatch(previous, moved, { reason: 'desktop' });

  assert.equal(batch.reason, 'desktop');
  assert.deepEqual(batch.items, moved);
}

function testInvalidatesOlderActionCallback() {
  const state = createActionState();
  const first = state.begin();
  const second = state.begin();
  assert.equal(state.isCurrent(first), false);
  assert.equal(state.isCurrent(second), true);
}

function testAllowsExplicitDropOutsideDesktop() {
  const scope = { desktopRoot: 'C:/Desktop', vaultPath: 'C:/Desktop/整理箱' };
  assert.equal(canOrganizeSource('C:/Downloads/photo.png', scope), false);
  assert.equal(canOrganizeSource('C:/Downloads/photo.png', { ...scope, allowOutsideDesktop: true }), true);
  assert.equal(canOrganizeSource('C:/Desktop/整理箱/photo.png', { ...scope, allowOutsideDesktop: true }), false);
}

function testDoesNotTreatSkippedOnlyResultAsAFileChange() {
  assert.equal(didMutateFiles({ moved: [], deleted: [], restored: [], skipped: [{ reason: '安全模式跳过' }] }), false);
  assert.equal(didMutateFiles({ moved: [{ source: 'a', target: 'b' }] }), true);
}

function testKeepsDropTargetInteractive() {
  assert.equal(shouldPassThroughMouse({ panelCollapsed: true, dropTargetEnabled: true }), false);
  assert.equal(shouldPassThroughMouse({ panelCollapsed: true, dropTargetEnabled: false }), true);
}

function testUsesSquareTransparentWebpLayout() {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(css, /\.video-wrap\s*{[^}]*height:\s*var\(--pet-preview-size, 220px\)/s);
  assert.match(css, /#petSprite\s*{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.doesNotMatch(main, /size\s*\*\s*0\.89|160\s*\*\s*0\.89/);
  assert.match(html, /<img id="petSprite"[^>]*src="\.\.\/assets\/videos\/filemonster_idle\.webp"/);
  assert.doesNotMatch(html, /<video|petVideo|petFreeze|poster=/);
  assert.doesNotMatch(renderer, /filemonster_(?:drag|work|success|error|wake|scan|hover|notify|thinking|ingest)\.webm/);
}

function testKeepsOnlyFiveWebpActionStates() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'videos', 'manifest.json'), 'utf8'));
  const expectedActions = ['dizzy', 'idle', 'silly', 'sleep', 'wave'];
  const expectedFiles = [
    'filemonster_dizzy.webp',
    'filemonster_idle.webp',
    'filemonster_silly.webp',
    'filemonster_sleep.webp',
    'filemonster_wave.webp'
  ];

  const actionBlock = renderer.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
  assert.ok(actionBlock, 'renderer.js should define ACTIONS');
  const actionKeys = [...actionBlock[1].matchAll(/^\s{2}([a-z]+):/gm)].map(match => match[1]).sort();
  assert.deepEqual(actionKeys, expectedActions);

  const literalActionCalls = [...renderer.matchAll(/playAction\('([^']+)'/g)].map(match => match[1]);
  const ambientActionBlock = renderer.match(/const AMBIENT_ACTION_SEQUENCE = \[([^\]]+)\];/);
  assert.ok(ambientActionBlock, 'renderer.js should define AMBIENT_ACTION_SEQUENCE');
  const ambientActions = [...ambientActionBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set([...literalActionCalls, ...ambientActions])].sort(), expectedActions);
  assert.deepEqual(Object.keys(manifest.segments).sort(), expectedActions);
  assert.deepEqual(Object.values(manifest.segments).map(segment => segment.file).sort(), expectedFiles);
  assert.doesNotMatch(renderer, /\.webm/);
}

function testWebpSubjectsShareConsistentHeight() {
  if (!hasImageMagick()) {
    console.warn('skipping WebP subject height check: ImageMagick magick is not installed');
    return;
  }

  const root = path.join(__dirname, '..');
  const files = [
    'filemonster_dizzy.webp',
    'filemonster_idle.webp',
    'filemonster_silly.webp',
    'filemonster_sleep.webp',
    'filemonster_wave.webp'
  ];

  const heights = files.map(file => {
    const output = execFileSync('magick', [
      path.join(root, 'assets', 'videos', file),
      '-coalesce',
      '-alpha',
      'extract',
      '-format',
      '%@\n',
      'info:'
    ], { encoding: 'utf8' });
    const maxHeight = Math.max(...output.trim().split(/\r?\n/).map(box => {
      const match = box.match(/^\d+x(\d+)/);
      assert.ok(match, `missing alpha bounding box for ${file}: ${box}`);
      return Number(match[1]);
    }));
    return { file, maxHeight };
  });

  const expectedHeights = {
    'filemonster_dizzy.webp': [246, 254],
    'filemonster_idle.webp': [246, 254],
    'filemonster_silly.webp': [246, 254],
    'filemonster_sleep.webp': [246, 254],
    'filemonster_wave.webp': [246, 254]
  };

  for (const { file, maxHeight } of heights) {
    const [minHeight, maxAllowedHeight] = expectedHeights[file];
    assert.ok(
      maxHeight >= minHeight && maxHeight <= maxAllowedHeight,
      `${file} subject height ${maxHeight}px is not within ${minHeight}-${maxAllowedHeight}px`
    );
  }
}

function testAmbientAnimationsRunInOrderEveryThirtyToSixtySeconds() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /const AMBIENT_ACTION_SEQUENCE = \['silly', 'wave', 'dizzy', 'sleep'\];/);
  assert.match(renderer, /const AMBIENT_MIN_DELAY_MS = 30000;/);
  assert.match(renderer, /const AMBIENT_MAX_DELAY_MS = 60000;/);
  assert.match(renderer, /const IDLE_SLEEP_DELAY_MS = 180000;/);
  assert.match(renderer, /ambientActionIndex = \(ambientActionIndex \+ 1\) % AMBIENT_ACTION_SEQUENCE\.length;/);
  assert.match(renderer, /AMBIENT_MIN_DELAY_MS \+ Math\.random\(\) \* \(AMBIENT_MAX_DELAY_MS - AMBIENT_MIN_DELAY_MS\)/);
  assert.match(renderer, /playAction\(name, \{ restart: true, loop: false, text: line, durationMs: action\.durationMs \}\)/);
  assert.match(renderer, /function scheduleIdleSleep\(\)[\s\S]*Date\.now\(\) - lastInteractionAt >= IDLE_SLEEP_DELAY_MS[\s\S]*playAction\('sleep', \{ restart: true, loop: true/);
  assert.match(renderer, /if \(currentAction === 'idle'\) \{[\s\S]*scheduleNextAmbientAction\(\);[\s\S]*scheduleIdleSleep\(\);[\s\S]*return;[\s\S]*\}/);
  assert.match(renderer, /function touch\(\)[\s\S]*lastInteractionAt = Date\.now\(\);[\s\S]*scheduleIdleSleep\(\);[\s\S]*scheduleNextAmbientAction\(\);/);
  assert.doesNotMatch(renderer, /IDLE_CLIP_POOL|IDLE_LOOP_DURATION|idleClipTimeout|idleHolding|idleBlinkTimer|scheduleNextIdleBlink|replayIdleBlink|}, 12000\)/);
}

function testMouseInteractionsTriggerPetAnimations() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /petInteractive\.addEventListener\('mouseenter'[\s\S]*playAction\('silly', \{ restart: true \}\)/);
  assert.match(renderer, /const wasSleeping = currentAction === 'sleep';[\s\S]*if \(wasSleeping\) playAction\('wave', \{ restart: true \}\)/);
  assert.match(renderer, /petInteractive\.addEventListener\('dragover'[\s\S]*playAction\('dizzy', \{ restart: true, loop: true \}\)/);
}

function testPetInteractionDoesNotScaleSprite() {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

  assert.doesNotMatch(css, /\.pet-stage\.dragging \.video-wrap\s*{[^}]*animation:/s);
  assert.doesNotMatch(css, /\.drop-halo\s*{[^}]*scale\(/s);
  assert.doesNotMatch(css, /\.pet-stage\.drop-ready \.drop-halo\s*{[^}]*scale\(/s);
  assert.doesNotMatch(css, /@keyframes petWiggle/);
}

function testClickInteractionsTriggerWaveAndDizzyLoop() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /const CLICK_ACTION_DELAY_MS = 280;/);
  assert.match(renderer, /const DOUBLE_CLICK_DELAY_MS = 280;/);
  assert.match(renderer, /function handlePrimaryPointerClick\(\)[\s\S]*scheduleSingleClickAction\(\)/);
  assert.match(renderer, /if \(!wasDrag && event\.button === 0\) \{[\s\S]*handlePrimaryPointerClick\(\);/);
  assert.match(renderer, /function scheduleSingleClickAction\(\)[\s\S]*playAction\('wave', \{ restart: true \}\)/);
  assert.match(renderer, /function handlePrimaryPointerClick\(\)[\s\S]*clearClickActionTimer\(\);[\s\S]*playAction\('dizzy', \{ restart: true, loop: true[\s\S]*\}\)/);
  assert.doesNotMatch(renderer, /petInteractive\.addEventListener\('click'/);
  assert.doesNotMatch(renderer, /petInteractive\.addEventListener\('dblclick'/);
}

function testFailureActionsPlayDizzyOnlyOnceWithText() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /const SCENE_SPEECH = \{/);
  for (const phrase of ['没收进去', '这份有点倔', '路径迷路了', '门没打开', '设置没站稳', '收到，处理中']) {
    assert.match(renderer, new RegExp(phrase));
  }
  assert.match(renderer, /function pickLine\(lines\)/);
  assert.match(renderer, /async function playFailureAction\(message\)/);
  assert.match(renderer, /playAction\('dizzy', \{ restart: true, loop: false, text: message \|\| ACTIONS\.dizzy\.text \}\)/);
  assert.match(renderer, /const workingLoop = options\.workingLoop \?\? actionConfig\.loop/);
  assert.match(renderer, /if \(result\.ok === false \|\| \(result\.errors && result\.errors\.length\)\) await playFailureAction\(buildFailureSpeech\(result, options\.failureScene\)\)/);
  assert.match(renderer, /catch \(err\) \{[\s\S]*await playFailureAction\(buildFailureSpeech\(\{ message: err\.message \}, options\.failureScene\)\)/);
  assert.match(renderer, /catch \(err\) \{[\s\S]*await playFailureAction\(pickLine\(SCENE_SPEECH\.failure\.settings\)\)/);
  assert.match(renderer, /if \(!paths\.length\) \{[\s\S]*await playFailureAction\(pickLine\(SCENE_SPEECH\.failure\.noPath\)\)/);
  assert.match(renderer, /petInteractive\.addEventListener\('drop'[\s\S]*await playAction\('dizzy', \{ restart: true, loop: false, text: pickLine\(SCENE_SPEECH\.working\.drop\) \}\)/);
  assert.match(renderer, /runWithAction\('dizzy', \(\) => window\.fileMonster\.organizePaths\(paths\), '拖拽整理完成', \{ requiresFileChange: true, workingLoop: false, failureScene: 'drop' \}\)/);
  assert.doesNotMatch(renderer, /petInteractive\.addEventListener\('drop'[\s\S]*await playAction\('dizzy', \{ restart: true \}\);/);
  assert.doesNotMatch(renderer, /playFailureAction\('操作失败：' \+ err\.message\)/);
  assert.doesNotMatch(renderer, /playFailureAction\('设置自动保存失败：' \+ err\.message\)/);
}

function testSpeechBubbleIsSmallerAndShiftedDown() {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

  assert.doesNotMatch(css, /\.video-wrap\s*{[^}]*order:\s*1/s);
  assert.doesNotMatch(css, /\.speech\s*{[^}]*order:\s*2/s);
  assert.match(css, /\.speech\s*{[^}]*max-width:\s*calc\(var\(--pet-preview-size\) \* 0\.72\)[^}]*align-self:\s*flex-start[^}]*margin-left:\s*calc\(var\(--pet-preview-size\) \* 0\.12\)[^}]*font-size:\s*8px[^}]*transform:\s*translateY\(28px\)/s);
  assert.match(css, /\.speech::after\s*{[^}]*left:\s*28px[^}]*bottom:\s*-6px/s);
}

function testOrganizeSpeechUsesMovedCategories() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /const CATEGORY_SPEECH = \{/);
  for (const phrase of ['图片归队', '文档上架', '文件夹归队', '视频进窝', '桌面退烧']) {
    assert.match(renderer, new RegExp(phrase));
  }
  assert.match(renderer, /return pickLine\(CATEGORY_SPEECH\[key\] \|\| CATEGORY_SPEECH\.mixed\)/);
  assert.match(renderer, /function buildOrganizeSpeech\(result\)/);
  assert.match(renderer, /result\?\.moved[\s\S]*item\.category/);
  assert.match(renderer, /playAction\('wave', \{ restart: true, text: options\.successScene \? pickLine\(SCENE_SPEECH\.success\[options\.successScene\]\) : buildOrganizeSpeech\(result\) \}\)/);
}

function testPanelUsesCleanReferenceLayoutWithTrash() {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

  assert.match(html, /class="brand-lockup"/);
  assert.match(html, /<div class="brand-copy">/);
  assert.match(html, /<img class="brand-pet"[^>]*src="\.\.\/assets\/icon-app\.png"/);
  assert.match(html, /id="btnOpenTrash"/);
  assert.match(html, /id="btnBrowseVault"/);
  assert.doesNotMatch(html, /btnSaveSettings/);
  assert.match(html, /id="btnMinimize"[\s\S]*<svg class="window-icon"/);
  assert.match(html, /id="btnCollapse"[\s\S]*<svg class="window-icon"/);
  assert.match(html, /id="btnQuit"[\s\S]*<svg class="window-icon"/);
  assert.doesNotMatch(html, />[—□×]</);
  assert.match(html, /id="btnOrganize" class="quick-action top"/);
  assert.match(html, /id="btnScreenshots" class="quick-action top"/);
  assert.match(html, /id="btnOpenVault" class="quick-action bottom"[\s\S]*<span class="action-label">[\s\S]*<svg class="action-icon"[\s\S]*<\/svg>[\s\S]*<span>[^<]+<\/span>[\s\S]*<\/span>/);
  assert.match(html, /id="btnOpenTrash" class="quick-action bottom trash"[\s\S]*<span class="action-label">[\s\S]*<svg class="action-icon"[\s\S]*<\/svg>[\s\S]*<span>[^<]+<\/span>[\s\S]*<\/span>/);
  assert.match(html, /id="btnUndo" class="quick-action bottom undo"[\s\S]*<span class="action-label">[\s\S]*<svg class="action-icon"[\s\S]*<\/svg>[\s\S]*<span>[^<]+<\/span>[\s\S]*<\/span>/);
  assert.doesNotMatch(html, /quick-secondary-actions|quick-action primary/);
  assert.doesNotMatch(html, /rulesEditor|resultLog|分类规则|处理结果/);
  assert.doesNotMatch(renderer, /rulesEditor|resultLog/);
  assert.doesNotMatch(renderer, /btnSaveSettings/);
  assert.match(renderer, /rules:\s*currentSettings\.rules/);
  assert.match(renderer, /async function saveCurrentSettings\(/);
  assert.match(renderer, /ui\.petSize\.addEventListener\('change'[\s\S]*saveCurrentSettings\(/);
  assert.match(renderer, /ui\.btnBrowseVault\.addEventListener\('click'[\s\S]*saveCurrentSettings\(/);
  assert.match(renderer, /for \(const checkbox of \[ui\.safeMode, ui\.moveFolders, ui\.addDatePrefix, ui\.launchAtLogin, ui\.alwaysOnTop\]\)/);
  assert.match(renderer, /btnOpenTrash:[\s\S]*getElementById\('btnOpenTrash'\)/);
  assert.match(renderer, /ui\.btnOpenTrash\.addEventListener\('click'[\s\S]*window\.fileMonster\.openTrash\(\)/);
  assert.match(preload, /openTrash:\s*\(\) => ipcRenderer\.invoke\('trash:open'\)/);
  assert.match(preload, /chooseVaultPath:\s*\(\) => ipcRenderer\.invoke\('settings:choose-vault'\)/);
  assert.match(main, /const PANEL_WIDTH = 280;/);
  assert.match(main, /const PANEL_HEIGHT = 420;/);
  assert.match(main, /function openTrash\(\)/);
  assert.match(main, /function chooseVaultPath\(\)/);
  assert.match(main, /ipcMain\.handle\('trash:open'/);
  assert.match(main, /ipcMain\.handle\('settings:choose-vault'/);
  assert.match(css, /--panel-width:\s*280px/);
  assert.match(css, /\.control-panel\s*{[^}]*height:\s*420px/s);
  assert.match(css, /\.control-panel\s*{[^}]*rgba\(13,\s*15,\s*18,\s*0\.98\)/s);
  assert.match(css, /\.control-panel\s*{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.control-panel::?-webkit-scrollbar-thumb/s);
  assert.match(css, /\.brand-pet\s*{[^}]*width:\s*42px[^}]*height:\s*42px/s);
  assert.match(css, /\.brand-copy\s*{[^}]*height:\s*42px[^}]*justify-content:\s*center/s);
  assert.match(css, /\.brand-copy h1\s*{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.brand-copy p\s*{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /h1\s*{[^}]*font-size:\s*26px[^}]*line-height:\s*26px/s);
  assert.match(css, /p\s*{[^}]*font-size:\s*11px[^}]*line-height:\s*14px/s);
  assert.match(css, /\.window-actions button\s*{[^}]*width:\s*30px[^}]*height:\s*30px[^}]*display:\s*grid[^}]*place-items:\s*center[^}]*line-height:\s*0/s);
  assert.match(css, /\.window-icon\s*{[^}]*display:\s*block/s);
  assert.match(css, /\.quick-action-grid\s*{[^}]*grid-template-columns:\s*repeat\(6,\s*1fr\)/s);
  assert.match(css, /\.quick-action\s*{[^}]*min-height:\s*40px/s);
  assert.match(css, /\.quick-action\.top\s*{[^}]*grid-column:\s*span 3/s);
  assert.match(css, /\.quick-action\.bottom\s*{[^}]*grid-column:\s*span 2/s);
  assert.match(css, /\.quick-action\.bottom\s*{[^}]*justify-content:\s*center[^}]*text-align:\s*center/s);
  assert.match(css, /\.quick-action\.bottom \.action-label\s*{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*justify-content:\s*center/s);
  assert.match(css, /\.quick-action\.bottom \.action-label > span\s*{[^}]*display:\s*block[^}]*text-align:\s*center/s);
  assert.match(css, /\.quick-action\s*{[^}]*white-space:\s*nowrap/s);
  assert.match(css, /\.action-icon,\s*\.window-icon\s*{[^}]*fill:\s*none[^}]*stroke:\s*currentColor[^}]*stroke-width:\s*1\.8/s);
  assert.match(css, /\.window-actions button\s*{[^}]*color:\s*rgba\(255,\s*255,\s*255,\s*0\.9\)/s);
  assert.match(css, /\.quick-action\.trash/s);
  assert.match(css, /\.setting-row\s*{[^}]*min-height:\s*48px/s);
  assert.match(css, /\.path-row\s*{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.switch\s+input:checked \+ \.switch-ui/s);
  assert.doesNotMatch(css, /\.save-action/);
}

function testSpeechCopyIsShortAndPlayful() {
  const root = path.join(__dirname, '..');
  const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

  for (const phrase of ['稳住', '拿下', '开窍', '回血', '漂亮']) {
    assert.match(renderer, new RegExp(phrase));
  }
  assert.doesNotMatch(renderer, /打工人|摸鱼待机|文件自来|尽管砸过来|桌面变清爽/);
}

Promise.resolve()
  .then(testKeepsFailedUndoItems)
  .then(testDropUndoBatchAccumulatesMovedFiles)
  .then(testNonDropUndoBatchReplacesPreviousBatch)
  .then(testInvalidatesOlderActionCallback)
  .then(testAllowsExplicitDropOutsideDesktop)
  .then(testDoesNotTreatSkippedOnlyResultAsAFileChange)
  .then(testKeepsDropTargetInteractive)
  .then(testUsesSquareTransparentWebpLayout)
  .then(testKeepsOnlyFiveWebpActionStates)
  .then(testWebpSubjectsShareConsistentHeight)
  .then(testAmbientAnimationsRunInOrderEveryThirtyToSixtySeconds)
  .then(testMouseInteractionsTriggerPetAnimations)
  .then(testPetInteractionDoesNotScaleSprite)
  .then(testClickInteractionsTriggerWaveAndDizzyLoop)
  .then(testFailureActionsPlayDizzyOnlyOnceWithText)
  .then(testSpeechBubbleIsSmallerAndShiftedDown)
  .then(testOrganizeSpeechUsesMovedCategories)
  .then(testPanelUsesCleanReferenceLayoutWithTrash)
  .then(testSpeechCopyIsShortAndPlayful)
  .then(() => console.log('regression tests passed'));
