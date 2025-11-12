const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configAPI', {
  importExcel: (payload) => ipcRenderer.invoke('process-excel', payload),
  requestQuiz: () => ipcRenderer.invoke('get-quiz'),
  getFlags: () => ipcRenderer.invoke('get-flags'),
  selectWorkingDirectory: () => ipcRenderer.invoke('select-working-directory'),
  saveSettings: (payload) => ipcRenderer.invoke('update-settings', payload),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettingsFile: () => ipcRenderer.invoke('import-settings'),
  ingestMedia: (payload) => ipcRenderer.invoke('ingest-media', payload),
  ingestAfterhours: (payload) => ipcRenderer.invoke('ingest-afterhours', payload),
  exportWorkingDirectory: () => ipcRenderer.invoke('export-working-directory'),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  onSyncMessage: (callback) => {
    ipcRenderer.removeAllListeners('sync-message');
    ipcRenderer.on('sync-message', (_event, message) => callback(message));
  },
  onQuizUpdated: (callback) => {
    ipcRenderer.removeAllListeners('quiz-updated');
    ipcRenderer.on('quiz-updated', (_event, payload) => callback(payload));
  },
});
