mod app_backup;
mod app_menu;
mod backup_crypto;
mod book_archive;
mod book_seeds;
mod bundled_extensions;
mod cloud_backup;
mod cloud_link;
mod cloud_state;
mod db_path;
mod epub_reader;
mod extension_assets;
mod extension_auth;
mod extension_data_proxy;
mod extension_db;
mod extension_dev;
mod extension_fetcher;
mod extension_installer;
mod extension_ports;
mod extension_proxy;
mod extension_runtime;
mod extension_sdk;
mod extension_signature;
mod extension_slots;
mod extension_task_sse;
mod html_to_markdown;
mod http_server;
mod import_db;
mod iroh_share;
mod keepawake;
mod langsmith;
mod migrations;
mod phone_share;
mod pipeline_bridge;
mod pipeline_worker;
mod provider_catalog;
mod provider_proxy;
mod provider_resolve;
mod provider_secret;
mod provider_slots;
mod secret_key;
mod test_provider;
mod window_commands;

use app_backup::{create_app_backup, restore_app_backup};
use book_archive::{export_book_archive, import_book_archive, inspect_book_archive};
use book_seeds::apply_book_seeds;
use bundled_extensions::list_bundled_extension_dirs;
use cloud_backup::{
    create_backup_recovery_key, create_cloud_backup, delete_cloud_backup, get_backup_recovery_key,
    list_cloud_backups, restore_cloud_backup, set_backup_recovery_key,
};
use cloud_link::link_cloud_account;
use cloud_state::CloudState;
use epub_reader::read_epub_entries;
use extension_auth::{
    ExtensionAuth, mint_extension_session_token, new_state as new_extension_auth_state,
    revoke_extension_session_tokens,
};
use extension_dev::{
    ExtensionDevState, extension_dev_client_revoke, extension_dev_clients_list,
    extension_dev_code_create,
};
use extension_fetcher::{
    check_github_manifest, cleanup_extension_fetch, fetch_extension_from_github,
};
use extension_installer::{
    commit_extension_install, install_extension_files, read_extension_manifest_at,
    uninstall_extension,
};
use extension_ports::allocate_extension_port;
use extension_runtime::ExtensionRuntimeState;
use extension_sdk::{ExtensionSdkState, set_extension_sdk_source};
use extension_signature::verify_extension_signature_cmd;
use extension_slots::{auto_configure_cloud_extensions, set_extension_provider_model};
use html_to_markdown::convert_html_to_markdown;
use http_server::{HttpPortState, get_http_port};
use import_db::{
    ensure_import_db, read_model_projection, read_pipeline_step_usages_for_import,
    read_pipeline_steps_for_import, read_selection_entities, update_selection_entities,
};
use keepawake::{KeepawakeState, allow_sleep, prevent_sleep};
use phone_share::{PhoneShareState, new_state as new_phone_share_state};
use pipeline_bridge::PipelineBridgeState;
use pipeline_worker::{
    PipelineWorkerState, cancel_book_import, is_book_import_running, list_running_book_imports,
    recheck_book_entity_minor, start_book_import,
};
use provider_catalog::get_provider_catalog;
use provider_slots::remove_provider;
use secret_key::{get_or_create_secret_key, install_default_store};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use test_provider::{TestProviderState, test_provider_config};
use window_commands::{
    close_path_window, get_cloud_phone_url, get_path_phone_url, open_book_window,
    open_import_window, open_new_book_window, open_path_window, open_settings_window,
};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:branch-fiction.db", migrations::tauri_plugin_migrations())
                .build(),
        )
        .manage(CloudState::default())
        .manage(KeepawakeState::default())
        .manage(PipelineBridgeState::default())
        .manage(PipelineWorkerState::default())
        .manage(ExtensionRuntimeState::default())
        .manage::<ExtensionAuth>(new_extension_auth_state())
        .manage::<PhoneShareState>(new_phone_share_state())
        .manage(ExtensionDevState::default())
        .manage(ExtensionSdkState::default())
        .manage(TestProviderState::default())
        .setup(|app| {
            app_backup::apply_pending_restore(app.handle());
            install_default_store().expect("failed to initialize OS keychain store");
            let port = http_server::spawn(app.handle())
                .expect("failed to start embedded http server");
            app.manage(HttpPortState(port));
            app_menu::setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            open_settings_window,
            open_new_book_window,
            open_import_window,
            open_book_window,
            get_path_phone_url,
            get_cloud_phone_url,
            get_http_port,
            allocate_extension_port,
            get_or_create_secret_key,
            prevent_sleep,
            allow_sleep,
            read_epub_entries,
            convert_html_to_markdown,
            start_book_import,
            recheck_book_entity_minor,
            cancel_book_import,
            list_running_book_imports,
            is_book_import_running,
            read_pipeline_steps_for_import,
            read_pipeline_step_usages_for_import,
            read_selection_entities,
            update_selection_entities,
            ensure_import_db,
            export_book_archive,
            inspect_book_archive,
            import_book_archive,
            create_app_backup,
            restore_app_backup,
            get_backup_recovery_key,
            create_backup_recovery_key,
            set_backup_recovery_key,
            create_cloud_backup,
            list_cloud_backups,
            restore_cloud_backup,
            delete_cloud_backup,
            read_model_projection,
            test_provider_config,
            get_provider_catalog,
            read_extension_manifest_at,
            verify_extension_signature_cmd,
            install_extension_files,
            uninstall_extension,
            fetch_extension_from_github,
            check_github_manifest,
            cleanup_extension_fetch,
            list_bundled_extension_dirs,
            apply_book_seeds,
            mint_extension_session_token,
            revoke_extension_session_tokens,
            extension_dev_code_create,
            extension_dev_clients_list,
            extension_dev_client_revoke,
            set_extension_sdk_source,
            open_path_window,
            close_path_window,
            link_cloud_account,
            commit_extension_install,
            remove_provider,
            set_extension_provider_model,
            auto_configure_cloud_extensions
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<PipelineWorkerState>();
                let running_count = state
                    .children
                    .lock()
                    .map(|m| m.len())
                    .unwrap_or(0);
                if running_count == 0 {
                    return;
                }

                api.prevent_exit();

                let app = app_handle.clone();
                app_handle
                    .dialog()
                    .message(if running_count == 1 {
                        "A book import is still running. Quitting now will cancel it. You can resume it later.".to_string()
                    } else {
                        format!(
                            "{running_count} book imports are still running. Quitting now will cancel them. You can resume them later."
                        )
                    })
                    .title("Import in Progress")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Quit Anyway".to_string(),
                        "Cancel".to_string(),
                    ))
                    .show(move |proceed| {
                        if !proceed {
                            return;
                        }
                        let state = app.state::<PipelineWorkerState>();
                        let senders: Vec<tokio::sync::oneshot::Sender<()>> =
                            match state.children.lock() {
                                Ok(mut map) => map.drain().map(|(_, tx)| tx).collect(),
                                _ => Vec::new(),
                            };
                        for tx in senders {
                            let _ = tx.send(());
                        }
                        app.exit(0);
                    });
            }
        });
}
