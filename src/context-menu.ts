import * as Electron from 'electron';
import { UnreachableCheck } from './util';

export interface ContextMenuDefinition {
    position: { x: number; y: number };
    items: ContextMenuItem[];
}

type ContextMenuItem =
    | ContextMenuOption
    | ContextMenuSubmenu
    | { type: 'separator' };

interface ContextMenuOption {
    type: 'option';
    id: string;
    label: string;
    enabled?: boolean;
}

interface ContextMenuSubmenu {
    type: 'submenu';
    label: string;
    enabled?: boolean;
    items: ContextMenuItem[];
}

type ContextMenuCallback = (item: Electron.MenuItem) => void;


//  This resolves either with an id of a selected option, or undefined if the menu is closes any other way.
export function openContextMenu({ position, items }: ContextMenuDefinition) {
    return new Promise((resolve) => {
        const callback = (menuItem: Electron.MenuItem) => resolve(menuItem.id);

        const menu = buildContextMenu(items, callback);
        menu.addListener('menu-will-close', () => {
            // Resolve has to be deferred briefly, because the click callback fires *after* menu-will-close.
            setTimeout(resolve, 0);
        });

        menu.popup({ x: position.x, y: position.y });
    });
}

function buildContextMenu(items: ContextMenuItem[], callback: ContextMenuCallback) {
    const menu = new Electron.Menu();

    items
    .map((item) => buildContextMenuItem(item, callback))
    .forEach(menuItem => menu.append(menuItem));

    return menu;
}

function buildContextMenuItem(item: ContextMenuItem, callback: ContextMenuCallback): Electron.MenuItem {
    if (item.type === 'option') return buildContextMenuOption(item, callback);
    else if (item.type === 'submenu') return buildContextSubmenu(item, callback);
    else if (item.type === 'separator') return new Electron.MenuItem(item);
    else throw new UnreachableCheck(item, (i) => i.type);
}

function buildContextMenuOption(option: ContextMenuOption, callback: ContextMenuCallback) {
    return new Electron.MenuItem({
        type: 'normal',
        id: option.id,
        label: option.label,
        enabled: option.enabled,
        click: callback
    });
}

function buildContextSubmenu(option: ContextMenuSubmenu, callback: ContextMenuCallback) {
    const submenu = buildContextMenu(option.items, callback);
    return new Electron.MenuItem({
        label: option.label,
        enabled: option.enabled,
        submenu
    });
}