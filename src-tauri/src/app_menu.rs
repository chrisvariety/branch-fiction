use tauri::AppHandle;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

use crate::window_commands::{
    focus_or_open_main_window, open_new_book_window_impl, open_settings_window_impl,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let settings_item = MenuItemBuilder::new("Settings…")
        .id("settings")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let open_library_item = MenuItemBuilder::new("Open Library")
        .id("open-library")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let import_book_item = MenuItemBuilder::new("Import…")
        .id("import-book")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;

    let app_name = app.package_info().name.clone();

    let app_menu = SubmenuBuilder::new(app, app_name)
        .item(&settings_item)
        .separator()
        .hide()
        .hide_others()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&open_library_item)
        .item(&import_book_item)
        .separator()
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;

    // Must run after `set_menu`; macOS won't auto-add window items (Fill/Center/list) before the menu is attached.
    #[cfg(target_os = "macos")]
    window_menu.set_as_windows_menu_for_nsapp()?;

    app.on_menu_event(|app_handle, event| match event.id().as_ref() {
        "settings" => {
            if let Err(e) = open_settings_window_impl(app_handle, None, false) {
                eprintln!("menu: open settings failed: {e}");
            }
        }
        "open-library" => {
            if let Err(e) = focus_or_open_main_window(app_handle) {
                eprintln!("menu: open library failed: {e}");
            }
        }
        "import-book" => {
            if let Err(e) = open_new_book_window_impl(app_handle, false) {
                eprintln!("menu: open new book failed: {e}");
            }
        }
        _ => {}
    });

    Ok(())
}
