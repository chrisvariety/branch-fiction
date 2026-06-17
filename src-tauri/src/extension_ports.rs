use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};

use axum::{
    Extension,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::IntoResponse,
};
use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

// Distinct loopback origins available to extension iframes at once, one pinned per extension.
pub const EXTENSION_PORT_POOL: usize = 16;

struct PortAlloc {
    ports: Vec<u16>,
    assigned: HashMap<String, u16>,
    // Least-recently-used first, for eviction when the pool is exhausted.
    order: VecDeque<String>,
    // The extension id a port's origin storage was last scrubbed for, this session.
    scrubbed_for: HashMap<u16, String>,
}

impl PortAlloc {
    fn touch(&mut self, id: &str) {
        if let Some(pos) = self.order.iter().position(|x| x == id) {
            let v = self.order.remove(pos).expect("position just found");
            self.order.push_back(v);
        }
    }

    fn allocate(&mut self, id: &str) -> (u16, bool) {
        if let Some(&port) = self.assigned.get(id) {
            self.touch(id);
            let scrubbed = self.scrubbed_for.get(&port).is_some_and(|s| s == id);
            return (port, !scrubbed);
        }
        let used: Vec<u16> = self.assigned.values().copied().collect();
        let port = match self.ports.iter().copied().find(|p| !used.contains(p)) {
            Some(p) => p,
            None => {
                let victim = self.order.pop_front().expect("pool full implies an entry");
                self.assigned.remove(&victim).expect("victim was assigned")
            }
        };
        self.assigned.insert(id.to_string(), port);
        self.order.push_back(id.to_string());
        let already = self.scrubbed_for.get(&port).is_some_and(|s| s == id);
        if !already {
            self.scrubbed_for.insert(port, id.to_string());
        }
        (port, !already)
    }
}

pub struct ExtensionPortState {
    inner: Mutex<PortAlloc>,
}

impl ExtensionPortState {
    pub fn new(ports: Vec<u16>) -> Self {
        Self {
            inner: Mutex::new(PortAlloc {
                ports,
                assigned: HashMap::new(),
                order: VecDeque::new(),
                scrubbed_for: HashMap::new(),
            }),
        }
    }

    pub fn owner_of(&self, port: u16) -> Option<String> {
        let alloc = self.inner.lock().expect("extension port state poisoned");
        alloc
            .assigned
            .iter()
            .find_map(|(id, &p)| (p == port).then(|| id.clone()))
    }
}

// Marker injected on each pool listener so asset handlers can confine a port to its owner.
#[derive(Clone, Copy)]
pub struct OwnerPort(pub u16);

// Allows the main port (no marker) for any extension, but a pool port only for its owner.
pub fn port_owns_extension(
    app: &AppHandle,
    owner: Option<Extension<OwnerPort>>,
    extension_id: &str,
) -> bool {
    let Some(Extension(OwnerPort(port))) = owner else {
        return true;
    };
    app.state::<ExtensionPortState>().owner_of(port).as_deref() == Some(extension_id)
}

#[derive(Serialize)]
pub struct AllocatedPort {
    pub port: u16,
    #[serde(rename = "needsClear")]
    pub needs_clear: bool,
}

#[tauri::command(rename_all = "camelCase")]
pub fn allocate_extension_port(
    state: tauri::State<'_, ExtensionPortState>,
    extension_id: String,
) -> Result<AllocatedPort, String> {
    if extension_id.is_empty() {
        return Err("extensionId is required".to_string());
    }
    let (port, needs_clear) = state
        .inner
        .lock()
        .expect("extension port state poisoned")
        .allocate(&extension_id);
    Ok(AllocatedPort { port, needs_clear })
}

// Inline body of the self-clear page; hashed for a strict script-src so nothing else can run.
const CLEANUP_SCRIPT: &str = r#"
(async () => {
  try {
    if (self.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (self.indexedDB && indexedDB.databases) {
      const dbs = await indexedDB.databases();
      await Promise.all(
        dbs.map((d) => d.name && new Promise((res) => {
          const req = indexedDB.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        }))
      );
    }
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  parent.postMessage({ __bfCleanup: location.port }, "*");
})();
"#;

// Built once: the page body plus a CSP whose hash is derived from the script, so they never drift.
fn cleanup_page() -> &'static (String, HeaderValue) {
    static PAGE: OnceLock<(String, HeaderValue)> = OnceLock::new();
    PAGE.get_or_init(|| {
        let digest = Sha256::digest(CLEANUP_SCRIPT.as_bytes());
        let hash = base64::engine::general_purpose::STANDARD.encode(digest);
        let csp = format!("default-src 'none'; script-src 'sha256-{hash}'");
        let body = format!(
            "<!doctype html><meta charset=\"utf-8\"><title>cleanup</title><script>{CLEANUP_SCRIPT}</script>"
        );
        (body, HeaderValue::from_str(&csp).expect("csp is ascii"))
    })
}

pub async fn cleanup_handler() -> impl IntoResponse {
    let (body, csp) = cleanup_page();
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CONTENT_SECURITY_POLICY, csp.clone());
    (StatusCode::OK, headers, body.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The script's text content must equal CLEANUP_SCRIPT verbatim or the CSP hash won't admit it.
    #[test]
    fn owner_of_tracks_assignment() {
        let state = ExtensionPortState::new(vec![5000, 5001]);
        let (port, _) = state.inner.lock().unwrap().allocate("@scope/a");
        assert_eq!(state.owner_of(port).as_deref(), Some("@scope/a"));
        assert_eq!(state.owner_of(4999), None);
    }

    #[test]
    fn cleanup_csp_hash_matches_inline_script() {
        let (body, csp) = cleanup_page();
        let digest = Sha256::digest(CLEANUP_SCRIPT.as_bytes());
        let hash = base64::engine::general_purpose::STANDARD.encode(digest);
        assert!(csp.to_str().unwrap().contains(&format!("'sha256-{hash}'")));
        assert!(body.contains(&format!("<script>{CLEANUP_SCRIPT}</script>")));
    }
}
