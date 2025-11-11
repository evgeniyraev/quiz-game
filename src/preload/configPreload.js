const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configAPI', {
  importExcel: (payload) => ipcRenderer.invoke('process-excel', payload),
  requestQuiz: () => ipcRenderer.invoke('get-quiz'),
  selectWorkingDirectory: () => ipcRenderer.invoke('select-working-directory'),
  saveSettings: (payload) => ipcRenderer.invoke('update-settings', payload),
  exportSettings: () => ipcRenderer.invoke('export-settings'),
  importSettingsFile: () => ipcRenderer.invoke('import-settings'),
  ingestMedia: (payload) => ipcRenderer.invoke('ingest-media', payload),
  resetSettings: () => ipcRenderer.invoke('reset-settings'),
  onQuizUpdated: (callback) => {
    ipcRenderer.removeAllListeners('quiz-updated');
    ipcRenderer.on('quiz-updated', (_event, payload) => callback(payload));
  },
});
