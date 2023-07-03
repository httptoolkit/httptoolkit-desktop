import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('desktopApi', {
  selectApplication: () => ipcRenderer.invoke('select-application'),
});
