const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chessash', {
  platform: 'windows',
  apiFetch: url => ipcRenderer.invoke('api:fetch', url),
  reviewFacts: (facts, pack) => ipcRenderer.invoke('policy:review', facts, pack),
  trainingDecisions: facts => ipcRenderer.invoke('policy:training', facts),
  policyGetPack: () => ipcRenderer.invoke('policy:pack:get'),
  policySavePack: pack => ipcRenderer.invoke('policy:pack:save', pack),
  tutorModels: config => ipcRenderer.invoke('tutor:models', config),
  tutorChat: request => ipcRenderer.invoke('tutor:chat', request),
  tutorCancel: id => ipcRenderer.invoke('tutor:cancel', id),
  tutorGetSettings: () => ipcRenderer.invoke('tutor:settings:get'),
  tutorSaveSettings: config => ipcRenderer.invoke('tutor:settings:save', config),
  tutorOnChunk: callback => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on('tutor:chunk', listener);
    return () => ipcRenderer.removeListener('tutor:chunk', listener);
  }
});
