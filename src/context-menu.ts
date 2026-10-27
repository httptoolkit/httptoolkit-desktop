import * as Electron from 'electron';
import { UnreachableCheck } from '@httptoolkit/util';

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
    accelerator?: string;
    optionType?:
        | 'checkbox'
        | 'radio'
        | 'normal';
    checked?: boolean; // only for checkbox/radio type
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
        type: option.optionType || 'normal',
        id: option.id,
        label: option.label,
        enabled: option.enabled,
        click: callback,
        accelerator: option.accelerator,
        checked: (option.optionType === 'checkbox' || option.optionType === 'radio')
            ? !!option.checked
            : undefined
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

const MAX_LOOKUP_LABEL_LENGTH = 25;

// The default context menu, shown wherever the UI doesn't provide its own
export function showDefaultContextMenu(contents: Electron.WebContents, props: Electron.ContextMenuParams) {
    const { editFlags, isEditable, misspelledWord, linkURL, mediaType } = props;
    const selection = props.selectionText.trim();
    const hasText = selection.length > 0;
    const isMisspelled = hasText && !!misspelledWord;

    const sections: Electron.MenuItemConstructorOptions[][] = [];

    if (isMisspelled && isEditable) {
        sections.push(
            props.dictionarySuggestions.length > 0
                ? props.dictionarySuggestions.map((suggestion) => ({
                    label: suggestion,
                    click: () => contents.replaceMisspelling(suggestion)
                }))
                : [{ label: 'No Guesses Found', enabled: false }],
            [{
                label: '&Learn Spelling',
                click: () => contents.session.addWordToSpellCheckerDictionary(misspelledWord)
            }]
        );
    }

    if (hasText) {
        const lookupItems: Electron.MenuItemConstructorOptions[] = [];
        if (process.platform === 'darwin' && !linkURL) {
            const truncated = selection.length > MAX_LOOKUP_LABEL_LENGTH
                ? selection.slice(0, MAX_LOOKUP_LABEL_LENGTH - 1) + '…'
                : selection;
            lookupItems.push({
                label: `Look Up “${truncated.replace(/&/g, '&&')}”`,
                click: () => contents.showDefinitionForSelection()
            });
        }
        lookupItems.push({
            label: '&Search with Google',
            click: () => {
                const url = new URL('https://www.google.com/search');
                url.searchParams.set('q', props.selectionText);
                Electron.shell.openExternal(url.toString());
            }
        });
        sections.push(lookupItems);
    }

    const editItems: Electron.MenuItemConstructorOptions[] = [];
    if (isEditable) {
        editItems.push({ label: 'Cu&t', enabled: editFlags.canCut && hasText, click: () => contents.cut() });
    }
    if (isEditable || hasText) {
        editItems.push({ label: '&Copy', enabled: editFlags.canCopy && hasText, click: () => contents.copy() });
    }
    if (isEditable) {
        editItems.push({ label: '&Paste', enabled: editFlags.canPaste, click: () => contents.paste() });
    }
    sections.push(editItems);

    if (mediaType === 'image') {
        sections.push([
            // With no will-download handler, Electron prompts with a save dialog:
            { label: 'Sa&ve Image As…', click: () => contents.downloadURL(props.srcURL) },
            { label: 'Cop&y Image', click: () => contents.copyImageAt(props.x, props.y) }
        ]);
    }

    if (linkURL && mediaType === 'none') {
        sections.push([{
            label: 'Copy Lin&k',
            click: () => Electron.clipboard.write({ bookmark: props.linkText, text: linkURL })
        }]);
    }

    if (!Electron.app.isPackaged) {
        sections.push([{
            label: 'I&nspect Element',
            click: () => {
                contents.inspectElement(props.x, props.y);
                if (contents.isDevToolsOpened()) contents.devToolsWebContents?.focus();
            }
        }]);
    }

    const template = sections
        .filter((section) => section.length > 0)
        .flatMap((section, i) => i === 0
            ? section
            : [{ type: 'separator' } as const, ...section]
        );

    if (template.length > 0) {
        Electron.Menu.buildFromTemplate(template).popup({
            window: Electron.BrowserWindow.fromWebContents(contents) ?? undefined
        });
    }
}
