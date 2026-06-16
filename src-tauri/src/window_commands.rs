use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, webview::Color};

use crate::http_server::HttpPortState;
use crate::phone_share::{PhoneShareEntry, PhoneShareState};

fn theme_background(dark: bool) -> Color {
    if dark {
        // matches --background in .dark (oklch(14.7% 0.004 49.3))
        Color(0x1c, 0x19, 0x16, 0xff)
    } else {
        // matches --background in :root (oklch(99.5% 0.001 67.8))
        Color(0xfd, 0xfc, 0xfb, 0xff)
    }
}

/// Returns a short LAN URL for phone-share QR; params are held in-memory, not baked into the QR.
#[tauri::command(rename_all = "camelCase")]
pub fn get_path_phone_url(
    http_port: State<'_, HttpPortState>,
    phone_share: State<'_, PhoneShareState>,
    extension_id: String,
    book_id: String,
    token: String,
    entry: String,
    extension_name: String,
) -> Result<String, String> {
    if extension_id.is_empty() {
        return Err("extensionId is required".to_string());
    }
    if book_id.is_empty() {
        return Err("bookId is required".to_string());
    }
    if token.is_empty() {
        return Err("token is required".to_string());
    }
    if entry.is_empty() {
        return Err("entry is required".to_string());
    }
    let ip = local_ip_address::local_ip().map_err(|e| e.to_string())?;
    let port = if cfg!(debug_assertions) {
        1420
    } else {
        http_port.0
    };
    let slug = phone_share.register(PhoneShareEntry {
        extension_id,
        book_id,
        token,
        entry,
        extension_name,
    });
    Ok(format!("http://{ip}:{port}/p/{slug}"))
}

pub fn focus_or_open_main_window(app_handle: &AppHandle) -> Result<(), String> {
    let label = "main";

    if let Some(existing) = app_handle.get_webview_window(label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let builder =
        WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("index.html".into()))
            .title("Library")
            .inner_size(800.0, 600.0)
            .min_inner_size(600.0, 400.0)
            .background_color(theme_background(false));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

pub fn open_settings_window_impl(
    app_handle: &AppHandle,
    route: Option<String>,
    dark: bool,
) -> Result<(), String> {
    let label = "settings";
    let route = route.unwrap_or_else(|| "/general".to_string());

    if let Some(existing) = app_handle.get_webview_window(label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        app_handle
            .emit_to(label, "settings:navigate", route)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url_path = format!("settings.html#{}", route);

    let builder = WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(820.0, 560.0)
        .min_inner_size(600.0, 400.0)
        .center()
        .background_color(theme_background(dark));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn open_settings_window(
    app_handle: AppHandle,
    route: Option<String>,
    dark: Option<bool>,
) -> Result<(), String> {
    open_settings_window_impl(&app_handle, route, dark.unwrap_or(false))
}

// 960×720: 50/50 split with 2:3 cover on left (480px wide) at 720px tall.
const BOOK_IMPORT_SIZE: (f64, f64) = (960.0, 720.0);
const BOOK_IMPORT_MIN_SIZE: (f64, f64) = (700.0, 480.0);

/// New book import window; singleton — reuses the existing window if already open.
pub fn open_new_book_window_impl(app_handle: &AppHandle, dark: bool) -> Result<(), String> {
    let label = "new-book";

    if let Some(existing) = app_handle.get_webview_window(label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let builder =
        WebviewWindowBuilder::new(app_handle, label, WebviewUrl::App("new-book.html".into()))
            .title("New Book")
            .inner_size(BOOK_IMPORT_SIZE.0, BOOK_IMPORT_SIZE.1)
            .min_inner_size(BOOK_IMPORT_MIN_SIZE.0, BOOK_IMPORT_MIN_SIZE.1)
            .center()
            .background_color(theme_background(dark));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn open_new_book_window(app_handle: AppHandle, dark: Option<bool>) -> Result<(), String> {
    open_new_book_window_impl(&app_handle, dark.unwrap_or(false))
}

fn import_label(book_import_id: &str) -> String {
    let safe = book_import_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    format!("import__{safe}")
}

/// In-progress import window; one per import, keyed by import id; reuses the window if already open.
pub fn open_import_window_impl(
    app_handle: &AppHandle,
    book_import_id: &str,
    dark: bool,
) -> Result<(), String> {
    if book_import_id.is_empty() {
        return Err("bookImportId is required".to_string());
    }
    let label = import_label(book_import_id);

    if let Some(existing) = app_handle.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let route = format!("/{}", encode_route_segment(book_import_id));
    let url_path = format!("new-book.html#{route}");

    let builder = WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::App(url_path.into()))
        .title("Book Import")
        .inner_size(BOOK_IMPORT_SIZE.0, BOOK_IMPORT_SIZE.1)
        .min_inner_size(BOOK_IMPORT_MIN_SIZE.0, BOOK_IMPORT_MIN_SIZE.1)
        .center()
        .background_color(theme_background(dark));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_import_window(
    app_handle: AppHandle,
    book_import_id: String,
    dark: Option<bool>,
) -> Result<(), String> {
    open_import_window_impl(&app_handle, &book_import_id, dark.unwrap_or(false))
}

pub fn open_book_window_impl(
    app_handle: &AppHandle,
    book_id: &str,
    dark: bool,
) -> Result<(), String> {
    if book_id.is_empty() {
        return Err("bookId is required".to_string());
    }
    let safe_id = book_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let label = format!("book__{safe_id}");

    let encoded_id = encode_route_segment(book_id);
    let route = format!("/{encoded_id}");

    if let Some(existing) = app_handle.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        app_handle
            .emit_to(label.as_str(), "book:navigate", route)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url_path = format!("book.html#{route}");

    let builder = WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::App(url_path.into()))
        .title("Book")
        .inner_size(720.0, 560.0)
        .min_inner_size(480.0, 380.0)
        .center()
        .background_color(theme_background(dark));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_book_window(
    app_handle: AppHandle,
    book_id: String,
    dark: Option<bool>,
) -> Result<(), String> {
    open_book_window_impl(&app_handle, &book_id, dark.unwrap_or(false))
}

fn encode_route_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let c = b as char;
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn path_label(extension_id: &str) -> String {
    let safe = extension_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    format!("path__{safe}")
}

#[tauri::command(rename_all = "camelCase")]
pub async fn open_path_window(
    app_handle: AppHandle,
    extension_id: String,
    book_id: String,
    dark: Option<bool>,
) -> Result<(), String> {
    if extension_id.is_empty() {
        return Err("extensionId is required".to_string());
    }
    if book_id.is_empty() {
        return Err("bookId is required".to_string());
    }
    let label = path_label(&extension_id);

    let encoded_id = encode_route_segment(&extension_id);
    let route = format!("/{encoded_id}?bookId={}", encode_route_segment(&book_id));

    if let Some(existing) = app_handle.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        app_handle
            .emit_to(label.as_str(), "path:navigate", route)
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let url_path = format!("path.html#{route}");

    let builder = WebviewWindowBuilder::new(&app_handle, &label, WebviewUrl::App(url_path.into()))
        .title("Extension")
        .inner_size(900.0, 700.0)
        .min_inner_size(420.0, 320.0)
        .center()
        .background_color(theme_background(dark.unwrap_or(false)));

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    builder.build().map_err(|e| e.to_string())?;

    Ok(())
}
