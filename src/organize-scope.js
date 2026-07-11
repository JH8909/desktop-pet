const path = require('path');

function normalizePathKey(filePath) {
  const resolved = path.resolve(String(filePath));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isPathInside(child, parent) {
  const childKey = normalizePathKey(child);
  const parentKey = normalizePathKey(parent);
  return childKey === parentKey || childKey.startsWith(parentKey + path.sep);
}

function canOrganizeSource(sourcePath, { desktopRoot, vaultPath, allowOutsideDesktop = false }) {
  if (isPathInside(sourcePath, vaultPath)) return false;
  return allowOutsideDesktop || isPathInside(sourcePath, desktopRoot);
}

module.exports = { canOrganizeSource };
