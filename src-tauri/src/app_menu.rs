use tauri::AppHandle;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

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

    let check_updates_item = MenuItemBuilder::new("Check for Updates…")
        .id("check-for-updates")
        .build(app)?;

    let app_name = app.package_info().name.clone();

    let app_menu = SubmenuBuilder::new(app, app_name)
        .item(&check_updates_item)
        .separator()
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

    // GTK filters minimize/maximize out of predefined menus, leaving an empty submenu on Linux.
    #[cfg(not(target_os = "linux"))]
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;

    let menu_builder = MenuBuilder::new(app).items(&[&app_menu, &file_menu, &edit_menu]);
    #[cfg(not(target_os = "linux"))]
    let menu_builder = menu_builder.item(&window_menu);
    let menu = menu_builder.build()?;

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
        "check-for-updates" => check_for_updates(app_handle),
        _ => {}
    });

    Ok(())
}

// Runs the updater off the main thread so the blocking dialogs don't deadlock it.
fn check_for_updates(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let update = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(e) => {
                eprintln!("menu: updater unavailable: {e}");
                return;
            }
        };

        match update {
            Ok(Some(update)) => {
                let install = app
                    .dialog()
                    .message(format!(
                        "Branch Fiction {} is available. Install it and restart now?",
                        update.version
                    ))
                    .title("Update Available")
                    .kind(MessageDialogKind::Info)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Install and Restart".to_string(),
                        "Later".to_string(),
                    ))
                    .blocking_show();

                if !install {
                    return;
                }

                if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                    show_update_error(&app, format!("Update failed: {e}"));
                    return;
                }

                app.restart();
            }
            Ok(None) => {
                app.dialog()
                    .message("You're running the latest version.")
                    .title("Check for Updates")
                    .blocking_show();
            }
            Err(e) => show_update_error(&app, format!("Couldn't check for updates: {e}")),
        }
    });
}

fn show_update_error(app: &AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("Check for Updates")
        .kind(MessageDialogKind::Error)
        .blocking_show();
}
