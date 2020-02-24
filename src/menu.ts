import { app, Menu, MenuItemConstructorOptions } from 'electron';

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
            { role: 'pasteandmatchstyle', registerAccelerator: false },
            { role: 'delete' },
            { role: 'selectall' }
        ]
    },
    {
        label: '&View',
        submenu: [
            { role: 'resetzoom' },
            { role: 'zoomin' },
            { role: 'zoomout' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            { type: 'separator' },
            { role: 'reload' },
            { role: 'forcereload' },
            { role: 'toggledevtools' },
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
    menuTemplate.unshift({
        label: app.getName(),
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideothers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
        ]
    });

    // Edit menu
    (menuTemplate[1].submenu as MenuItemConstructorOptions[]).push(
        { type: 'separator' },
        {
            label: 'Speech',
            submenu: [
                { role: 'startspeaking' },
                { role: 'stopspeaking' }
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

// Mutate menu templates to fix https://github.com/electron/electron/issues/16303
// by forcibly defaulting registerAccelerator to true on role menu items.
function fixAccelerators(menuTemplates: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
    return menuTemplates.map((template) => {
        if (template.role && !template.hasOwnProperty('registerAccelerator')) {
            template.registerAccelerator = true;
        }

        const { submenu } = template;

        if (submenu) {
            if (Array.isArray(submenu)) {
                template.submenu = fixAccelerators(submenu);
            } else {
                template.submenu = fixAccelerators([submenu as MenuItemConstructorOptions]);
            }
        }

        return template;
    });
}

export const menu = Menu.buildFromTemplate(
    fixAccelerators(menuTemplate)
);