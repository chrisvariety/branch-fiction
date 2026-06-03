use std::collections::HashMap;
use std::fs::File;
use std::io::Read;

use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;

#[tauri::command]
pub fn read_epub_entries(path: String) -> Result<HashMap<String, String>, String> {
    let file = File::open(&path).map_err(|e| format!("open {path}: {e}"))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("read zip: {e}"))?;

    let mut entries = HashMap::with_capacity(zip.len());
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("entry {i}: {e}"))?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("read {name}: {e}"))?;
        entries.insert(name, BASE64.encode(&buf));
    }
    Ok(entries)
}
