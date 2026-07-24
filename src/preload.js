const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('fileMonster', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  chooseVaultPath: () => ipcRenderer.invoke('settings:choose-vault'),
  organizePaths: paths => ipcRenderer.invoke('organize:paths', paths),
  organizeDesktop: () => ipcRenderer.invoke('organize:desktop'),
  runAiCommand: command => ipcRenderer.invoke('ai:command', command),
  analyzeImageUrlWithAiStream: input => ipcRenderer.invoke('ai:image-url-stream', input),
  organizeScreenshots: () => ipcRenderer.invoke('organize:screenshots'),
  undoOrganize: () => ipcRenderer.invoke('organize:undo'),
  openVault: () => ipcRenderer.invoke('vault:open'),
  openTrash: () => ipcRenderer.invoke('trash:open'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch {
      return file?.path || '';
    }
  },
  togglePanelSize: (expanded, petSize) => ipcRenderer.invoke('window:toggle-panel-size', expanded, petSize),
  applyPetSize: (petSize, expanded) => ipcRenderer.invoke('window:apply-pet-size', petSize, expanded),
  dragStart: () => ipcRenderer.send('window:drag-start'),
  dragEnd: () => ipcRenderer.send('window:drag-end'),
  showContextMenu: () => ipcRenderer.send('window:show-context-menu'),
  minimize: () => ipcRenderer.send('window:minimize'),
  quit: () => ipcRenderer.send('app:quit'),
  setMousePassthrough: passthrough => ipcRenderer.send('window:set-passthrough', passthrough),
  onAiStreamChunk: callback => ipcRenderer.on('ai:stream-chunk', (_event, payload) => callback(payload)),
  onDesktopActivity: callback => ipcRenderer.on('desktop:activity', (_event, payload) => callback(payload)),
  onWindowResized: callback => ipcRenderer.on('window:resized', () => callback()),
  onMenuAction: callback => ipcRenderer.on('pet-menu-action', (_event, action) => callback(action)),
  onSettingsChanged: callback => ipcRenderer.on('pet-settings-changed', (_event, settings) => callback(settings))
});
