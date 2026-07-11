(function attachInputPolicy(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.fileMonsterInputPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  shouldPassThroughMouse({ panelCollapsed, dropTargetEnabled }) {
    return Boolean(panelCollapsed && !dropTargetEnabled);
  }
}));
