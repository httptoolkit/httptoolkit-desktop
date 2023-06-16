import {contextBridge, ipcRenderer} from 'electron';

contextBridge.exposeInMainWorld('nativeFile', {
  open: () => ipcRenderer.invoke('open-file'),
});
