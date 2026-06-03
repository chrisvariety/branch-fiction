use std::sync::Mutex;

use tauri::State;

/// Holds the active wake lock; refcounting on the renderer side; commands are idempotent.
#[derive(Default)]
pub struct KeepawakeState {
    handle: Mutex<Option<keepawake::KeepAwake>>,
}

#[tauri::command]
pub fn prevent_sleep(state: State<'_, KeepawakeState>) -> Result<(), String> {
    let mut slot = state.handle.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Ok(());
    }
    let awake = keepawake::Builder::default()
        .display(false)
        .idle(true)
        .sleep(true)
        .reason("Background work in progress")
        .app_name("Branch Fiction")
        .app_reverse_domain("com.lexikon.branchfiction")
        .create()
        .map_err(|e| e.to_string())?;
    *slot = Some(awake);
    Ok(())
}

#[tauri::command]
pub fn allow_sleep(state: State<'_, KeepawakeState>) -> Result<(), String> {
    let mut slot = state.handle.lock().map_err(|e| e.to_string())?;
    *slot = None;
    Ok(())
}
