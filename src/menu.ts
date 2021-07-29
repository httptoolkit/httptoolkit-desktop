import { app, Menu, MenuItemConstructorOptions } from 'electron';
import { autoHideMenuBar } from "./index"

const menuTemplate: MenuItemConstructorOptions[] = [
    {
        label: '&Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut', registerAccelerator: false },
            { role: 'copy', registerAccelerator: false },
            { role: 'paste', registerAccelerator: false },
            { role: 'pasteAndMatchStyle', registerAccelerator: false },
            { role: 'delete' },
            { role: 'selectAll' }
        ]
    },
    {
        label: '&View',
        submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            { type: 'separator' },
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'checkbox', 'label': 'Toggle Menu Bar', click(event) {
                autoHideMenuBar(event.checked || false)
            }}
        ]
    },
    {
        label: '&Window',
        role: 'window',
        submenu: [
            { role: 'minimize' },
            { role: 'close' }
        ]
    },
    {
        label: '&Help',
        role: 'help',
        submenu: [
            {
                label: 'Learn More',
                click () { require('electron').shell.openExternal('https://httptoolkit.tech') }
            }
        ]
    }
];

if (process.platform === 'darwin') {
    const macMenu: MenuItemConstructorOptions = {
        label: app.getName(),
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
        ]
    };
    menuTemplate.unshift(macMenu);

    // Add to Edit menu
    (menuTemplate[1].submenu as MenuItemConstructorOptions[]).push(
        { type: 'separator' },
        {
            label: 'Speech',
            submenu: [
                { role: 'startSpeaking' },
                { role: 'stopSpeaking' }
            ]
        }
    );

    // Window menu
    menuTemplate[3].submenu = [
        { role: 'close' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
    ];
} else {
    menuTemplate.unshift({
        label: '&File',
        submenu: [
            {
                // This should close the Window, but look like Quit. End behaviour is that every
                // Window _acts_ like a separate process, but is really a separate window.
                // (This lets us easily share a single server instance)
                role: 'close',
                label: 'Quit',
                accelerator: 'CommandOrControl+Q'
            }
        ]
    });
}

export const menu = Menu.buildFromTemplate(menuTemplate);