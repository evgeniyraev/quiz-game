const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quizAPI', {
  validatePin: (pin) => ipcRenderer.invoke('validate-pin', pin),
  requestQuiz: () => ipcRenderer.invoke('get-quiz'),
  drawAward: () => ipcRenderer.invoke('draw-award'),
  focusConfig: () => ipcRenderer.invoke('focus-config'),
  onQuizUpdated: (callback) => {
    ipcRenderer.removeAllListeners('quiz-updated');
    ipcRenderer.on('quiz-updated', (_event, payload) => callback(payload));
  },
});
