const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('configAPI', {
  importExcel: (payload) => ipcRenderer.invoke('process-excel', payload),
  requestQuiz: () => ipcRenderer.invoke('get-quiz'),
  onQuizUpdated: (callback) => {
    ipcRenderer.removeAllListeners('quiz-updated');
    ipcRenderer.on('quiz-updated', (_event, payload) => callback(payload));
  },
});
