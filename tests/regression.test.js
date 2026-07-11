const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { restoreBatch } = require('../src/organizer-history');
const { createActionState } = require('../src/action-state');
const { canOrganizeSource } = require('../src/organize-scope');
const { didMutateFiles } = require('../src/operation-result');
const { shouldPassThroughMouse } = require('../src/input-policy');

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

function testUsesSquareTransparentVideoLayout() {
  const root = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');

  assert.match(css, /\.video-wrap\s*{[^}]*height:\s*var\(--pet-preview-size, 220px\)/s);
  assert.match(css, /#petVideo\s*{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.match(css, /\.pet-freeze\s*{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  assert.doesNotMatch(main, /size\s*\*\s*0\.89|160\s*\*\s*0\.89/);
  assert.match(html, /id="petVideo"[^>]*poster="\.\.\/assets\/videos\/filemonster_poster\.webp"/);
}

Promise.resolve()
  .then(testKeepsFailedUndoItems)
  .then(testInvalidatesOlderActionCallback)
  .then(testAllowsExplicitDropOutsideDesktop)
  .then(testDoesNotTreatSkippedOnlyResultAsAFileChange)
  .then(testKeepsDropTargetInteractive)
  .then(testUsesSquareTransparentVideoLayout)
  .then(() => console.log('regression tests passed'));
