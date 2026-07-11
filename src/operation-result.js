(function attachOperationResult(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.fileMonsterOperationResult = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  didMutateFiles(result) {
    return Boolean(
      result && (
        (Array.isArray(result.moved) && result.moved.length) ||
        (Array.isArray(result.deleted) && result.deleted.length) ||
        (Array.isArray(result.restored) && result.restored.length)
      )
    );
  }
}));
