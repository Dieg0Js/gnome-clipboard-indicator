/*
 * @Dieg0Js - 2023
 * https://github.com/Dieg0Js/gnome-clipboard-indicator
 *
 * Fork of Clipman from popov895
 * https://github.com/popov895/Clipman
 */

"use strict";

const { Clutter, Cogl, Gio, GLib, GObject, Meta, Pango, Shell, St } =
    imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext;
const Main = imports.ui.main;
const ModalDialog = imports.ui.modalDialog;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Me = ExtensionUtils.getCurrentExtension();
const _ = Gettext.domain(Me.uuid).gettext;

//custom splitter used to separate strings in database file
//if part of clipboard content could cause errors
const _splitter = "#+#-#+#";

const _historySize = 15;

const cache_file_path = GLib.get_user_cache_dir() + "/" + Me.uuid + "/database";

const sensitiveMimeTypes = ["x-kde-passwordManagerHint"];

const ClipboardManager = GObject.registerClass(
    {
        Signals: {
            changed: {},
        },
    },
    class ClipboardManager extends GObject.Object {
        _init() {
            super._init();

            this._createEmptyCacheFile();

            this._clipboard = St.Clipboard.get_default();
            this._selection = Shell.Global.get().get_display().get_selection();
            this._selectionOwnerChangedId = this._selection.connect(
                "owner-changed",
                (...[, selectionType]) => {
                    if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
                        this.emit("changed");
                    }
                }
            );
        }

        destroy() {
            this._selection.disconnect(this._selectionOwnerChangedId);
        }

        _createEmptyCacheFile() {
            //create extension dir in .cache if not exist
            let _cache_file_parent_path = cache_file_path
                .split("/")
                .slice(0, -1)
                .join("/");
            let dir = Gio.File.new_for_path(_cache_file_parent_path);
            if (!dir.query_exists(null)) {
                dir.make_directory_with_parents(null);
            }

            //create database file in extension dir
            let file = Gio.File.new_for_path(cache_file_path);
            if (!file.query_exists(null)) {
                file.create(Gio.FileCreateFlags.NONE, null);
            }
        }

        getText(callback) {
            const mimeTypes = this._clipboard.get_mimetypes(
                St.ClipboardType.CLIPBOARD
            );
            const hasSensitiveMimeTypes = sensitiveMimeTypes.some(
                (sensitiveMimeType) => {
                    return mimeTypes.includes(sensitiveMimeType);
                }
            );
            if (hasSensitiveMimeTypes) {
                callback(null);
            } else {
                this._clipboard.get_text(St.ClipboardType.CLIPBOARD, (...[, text]) => {
                    callback(text);
                });
            }
        }

        setText(text) {
            this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);
        }

        clear() {
            this._clipboard.set_content(
                St.ClipboardType.CLIPBOARD,
                "",
                new GLib.Bytes(null)
            );
        }
    }
);

const PlaceholderMenuItem = class extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this.actor.add_style_class_name("popup-menu-item");

        this._icon = new St.Icon({
            x_align: Clutter.ActorAlign.CENTER,
        });

        this._label = new St.Label({
            x_align: Clutter.ActorAlign.CENTER,
        });

        const boxLayout = new St.BoxLayout({
            style_class: "placeholderpanel",
            vertical: true,
            x_expand: true,
        });
        boxLayout.add(this._icon);
        boxLayout.add(this._label);
        this.actor.add(boxLayout);
    }

    setIcon(icon) {
        this._icon.gicon = icon;
    }

    setText(text) {
        this._label.text = text;
    }
};

const HistoryMenuSection = class extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this.section = new PopupMenu.PopupMenuSection();
        this.scrollView = new St.ScrollView({
            overlay_scrollbars: true,
            style_class: "popuphistorymenusection",
        });
        this.scrollView.add_actor(this.section.actor);
        const menuSection = new PopupMenu.PopupMenuSection();
        menuSection.actor.add_actor(this.scrollView);
        this.addMenuItem(menuSection);
    }

    destroy() {
        this.section.box.disconnect(this._sectionActorRemovedId);
    }
};

const PanelIndicator = GObject.registerClass(
    class PanelIndicator extends PanelMenu.Button {
        _init() {
            super._init(0);

            this.menu.actor.add_style_class_name("panelmenu-button");

            this._buildIcon();
            this._buildMenu();

            this._clipboard = new ClipboardManager();
            this._clipboardChangedId = this._clipboard.connect("changed", () => {
                this._clipboard.getText((text) => {
                    this._onClipboardTextChanged(text);
                });
            });

            this._loadState();

            this._readCacheAndPopulate();
        }

        destroy() {
            this._saveState();

            this._historyMenuSection.section.box.disconnect(
                this._historySectionActorRemovedId
            );
            this._historyMenuSection.destroy();

            this._clipboard.disconnect(this._clipboardChangedId);
            this._clipboard.destroy();

            super.destroy();
        }

        _buildIcon() {
            this._icon = new St.Icon({
                gicon: new Gio.ThemedIcon({ name: "edit-paste-symbolic" }),
                style_class: "system-status-icon",
            });
            this.add_child(this._icon);
        }

        _buildMenu() {
            this._historyMenuSection = new HistoryMenuSection();
            this._historyMenuSection.section.box.connect(
                "actor-added",
                this._updateUi.bind(this)
            );
            this._historySectionActorRemovedId =
                this._historyMenuSection.section.box.connect(
                    "actor-removed",
                    this._updateUi.bind(this)
                );
            this.menu.addMenuItem(this._historyMenuSection);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            this._clearMenuItem = new PopupMenu.PopupMenuItem(_("Clear"));
            this._clearMenuItem.connect("activate", () => {
                this.menu.close();
                if (this._currentMenuItem) {
                    this._clipboard.clear();
                }
                this._historyMenuSection.section.removeAll();

                //empty cache file
                this._removeFromCache(null);
            });
            this.menu.addMenuItem(this._clearMenuItem);

            this.menu.connect("open-state-changed", (...[, open]) => {
                if (open) {
                    this._historyMenuSection.scrollView.vscroll.adjustment.value = 0;
                    // this._historyMenuSection.entry.text = '';
                    // Promise.resolve().then(() => {
                    //     global.stage.set_key_focus(this._historyMenuSection.entry);
                    // });
                }
            });
        }

        async _readCacheFileAsString() {
            let file = Gio.File.new_for_path(cache_file_path);
            let [, contents] = await file.load_contents_async(null);
            return contents.toString();
        }

        _readCacheAndPopulate() {
            let file = Gio.File.new_for_path(cache_file_path);
            file.load_contents_async(null, (file, res) => {
                let [, contents] = file.load_contents_finish(res);
                let raw_data = imports.byteArray.toString(contents);

                let dataList = raw_data.split(_splitter);

                for (let index = 0; index < dataList.length - 1; index++) {
                    let menuItem = this._createMenuItem(dataList[index]);
                    this._historyMenuSection.section.addMenuItem(menuItem, 0);
                }
            });
        }

        _storeInCache(text, moveToEnd) {

            let file = Gio.File.new_for_path(cache_file_path);
            file.load_contents_async(null, (file, res) => {
                let [, contents] = file.load_contents_finish(res);
                let oldContents = imports.byteArray.toString(contents);

                let updatedContents = '';

                if (moveToEnd == true) {
                    //if moveToEnd is true remove text from cache file
                    //happen when selecting an item from extension panel
                     oldContents = oldContents.replace(text + _splitter, "");
                } 
                    //append to end of file
                    updatedContents = oldContents.concat(text, _splitter);

                let outputStream = file.replace(
                    null,
                    false,
                    Gio.FileCreateFlags.NONE,
                    null
                );
                outputStream.write_all(updatedContents, null);
                outputStream.close(null);
            });

        }

        _removeFromCache(text) {
            let file = Gio.File.new_for_path(cache_file_path);
            file.load_contents_async(null, (file, res) => {
                let [, contents] = file.load_contents_finish(res);
                let oldContents = imports.byteArray.toString(contents);

                let updatedContents = '';

                if (text != null) {
                    //if passed text is null delete everything from cache
                    updatedContents = oldContents.replace(text + _splitter, "");
                }

                let outputStream = file.replace(
                    null,
                    false,
                    Gio.FileCreateFlags.NONE,
                    null
                );
                outputStream.write_all(updatedContents, null);
                outputStream.close(null);
            });
        }

        _createMenuItem(text) {
            const menuItem = new PopupMenu.PopupMenuItem(text);
            menuItem.text = text;
            menuItem.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            menuItem.connect("activate", () => {
                this.menu.close();
                this._clipboard.setText(menuItem.text);
                this._storeInCache(menuItem.text, true)
            });
            menuItem.connect("destroy", () => {
                if (this._currentMenuItem === menuItem) {
                    this._currentMenuItem = null;
                }
            });

            const deleteIcon = new St.Icon({
                gicon: new Gio.ThemedIcon({ name: "window-close-symbolic" }),
                style_class: "system-status-icon",
            });
            const deleteButton = new St.Button({
                can_focus: true,
                child: deleteIcon,
                style_class: "toolbutton",
            });
            deleteButton.connect("clicked", () => {
                if (this._historyMenuSection.section.numMenuItems === 1) {
                    this.menu.close();
                }

                this._removeFromCache(menuItem.text);

                this._destroyMenuItem(menuItem);
            });

            const boxLayout = new St.BoxLayout({
                style_class: "toolbuttonnpanel",
                x_align: Clutter.ActorAlign.END,
                x_expand: true,
            });
            boxLayout.add(deleteButton);
            menuItem.actor.add(boxLayout);

            return menuItem;
        }

        _destroyMenuItem(menuItem) {
            if (this._currentMenuItem === menuItem) {
                this._clipboard.clear();
            }
            menuItem.destroy();
        }

        _loadState() {
            if (panelIndicator.state.history.length > 0) {
                panelIndicator.state.history.forEach((text) => {
                    const menuItem = this._createMenuItem(text);
                    this._historyMenuSection.section.addMenuItem(menuItem);
                });
                panelIndicator.state.history.length = 0;
                this._clipboard.getText((text) => {
                    if (text && text.length > 0) {
                        const menuItems = this._historyMenuSection.section._getMenuItems();
                        this._currentMenuItem = menuItems.find((menuItem) => {
                            return menuItem.text === text;
                        });
                        this._currentMenuItem?.setOrnament(PopupMenu.Ornament.DOT);
                    }
                });
            }

            this._updateUi();
        }

        _saveState() {
            const menuItems = this._historyMenuSection.section._getMenuItems();
            panelIndicator.state.history = menuItems.map((menuItem) => {
                return menuItem.text;
            });
        }

        _updateUi() {
            this.visible = this._historyMenuSection.section.numMenuItems > 0;
        }

        _onClipboardTextChanged(raw_text) {
            //check if raw_text is not empty
            if (raw_text) {
                let matchedMenuItem;
                //check if raw_text does not contain the splitter #+#-#+# string (prevent errors)
                if (!raw_text.includes(_splitter)) {
                    //remove spaces at beginning & end of string
                    let text = raw_text.trim();
                    //check if trimmed text is not empty (raw_text was only spaces...)
                    if (text) {
                        const menuItems = this._historyMenuSection.section._getMenuItems();
                        matchedMenuItem = menuItems.find((menuItem) => 
                             menuItem.text === text
                        );
                        if (matchedMenuItem) {
                            this._historyMenuSection.section.moveMenuItem(matchedMenuItem, 0);
                        } else {
                            //create new mwnu item
                            matchedMenuItem = this._createMenuItem(text);
                            this._historyMenuSection.section.addMenuItem(matchedMenuItem, 0);
                            this._storeInCache(text, false);


                            //delete last element when reachiing max size
                            //delete in for loop in case of starting with a file containings more items than max size
                            if (menuItems.length >= _historySize-1) {                               
                                for (let index = _historySize-1; index < menuItems.length; index++) {
                                    this._removeFromCache(menuItems[index].text);
                                    this._destroyMenuItem(menuItems[index]);
                                }
                            }
                        }
                    }
                } else {
                    Main.notifyError(
                        _("Clipboard Indicator"),
                        _(
                            "Can't save clipboard item, illegal chars found '" +
                            _splitter +
                            "'"
                        )
                    );
                }
                if (this._currentMenuItem !== matchedMenuItem) {
                    this._currentMenuItem?.setOrnament(PopupMenu.Ornament.NONE);
                    this._currentMenuItem = matchedMenuItem;
                    this._currentMenuItem?.setOrnament(PopupMenu.Ornament.DOT);
                }
            }
        }
    }
);

const panelIndicator = {
    instance: null,
    state: {
        history: [],
    },
};

function init() {
    ExtensionUtils.initTranslations(Me.uuid);
}

function enable() {
    panelIndicator.instance = new PanelIndicator();
    Main.panel.addToStatusArea(`${Me.metadata.name}`, panelIndicator.instance);
}

function disable() {
    panelIndicator.instance.destroy();
    panelIndicator.instance = null;
}
