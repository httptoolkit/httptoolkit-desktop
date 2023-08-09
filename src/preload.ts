import { contextBridge, ipcRenderer } from 'electron';

import type { ContextMenuDefinition } from './context-menu';

contextBridge.exposeInMainWorld('desktopApi', {

    selectApplication: () => ipcRenderer.invoke('select-application'),

    openContextMenu: (options: ContextMenuDefinition) => ipcRenderer.invoke('open-context-menu', options)

});