(function attachActionState(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.fileMonsterActionState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => ({
  createActionState() {
    let currentToken = 0;
    return {
      begin() {
        currentToken += 1;
        return currentToken;
      },
      isCurrent(token) {
        return token === currentToken;
      }
    };
  }
}));
