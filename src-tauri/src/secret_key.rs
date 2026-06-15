use keyring_core::{Entry, Error};

const ACCOUNT: &str = "secret-key";

pub fn install_default_store() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let store = apple_native_keyring_store::keychain::Store::new()
            .map_err(|e| format!("apple keychain init failed: {e}"))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "windows")]
    {
        let store = windows_native_keyring_store::Store::new()
            .map_err(|e| format!("windows credential manager init failed: {e}"))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "linux")]
    {
        let store = dbus_secret_service_keyring_store::Store::new()
            .map_err(|e| format!("secret-service init failed: {e}"))?;
        keyring_core::set_default_store(store);
    }
    Ok(())
}

pub fn load_or_create_secret_key(app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    let service = app.config().identifier.clone();
    let entry = Entry::new(&service, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_secret() {
        Ok(bytes) if bytes.len() == 32 => Ok(bytes),
        Ok(_) | Err(Error::NoEntry) => {
            let mut bytes = vec![0u8; 32];
            getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
            entry.set_secret(&bytes).map_err(|e| e.to_string())?;
            Ok(bytes)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_or_create_secret_key(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    load_or_create_secret_key(&app)
}
