use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::{
    extract::{Path as AxumPath, State},
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use tauri::AppHandle;

// URL-safe slug words (ASCII alphanumerics only; joined with `-`).
const WORD_LIST: &[&str] = &[
    "amber", "apple", "atlas", "azure", "basil", "beach", "berry", "birch", "blade", "bloom",
    "blush", "bond", "brave", "brick", "brook", "candle", "canvas", "cedar", "charm", "cherry",
    "clover", "cloud", "coral", "cosmic", "crown", "daisy", "dawn", "delta", "drift", "dune",
    "dusk", "ember", "emerald", "fae", "fated", "fern", "fjord", "flame", "forest", "frost",
    "glade", "glow", "grove", "harbor", "hazel", "heart", "honey", "hush", "iris", "ivy", "jade",
    "kiss", "lace", "lemon", "lily", "lotus", "maple", "marble", "mate", "meadow", "midnight",
    "mint", "moon", "moonlit", "moss", "mystic", "oak", "oath", "olive", "otter", "pearl",
    "pebble", "petal", "pine", "prism", "promise", "quartz", "quill", "raven", "realm", "reed",
    "ribbon", "river", "rose", "ruby", "sage", "sand", "sapphire", "satin", "secret", "shadow",
    "shell", "sigh", "silk", "silver", "sky", "slate", "snow", "spark", "spell", "spruce", "star",
    "stone", "storm", "sugar", "swan", "sword", "thorn", "throne", "tide", "topaz", "tulip",
    "twilight", "valley", "velvet", "vine", "violet", "vow", "whisper", "willow", "wind", "wing",
    "wolf",
];

#[derive(Clone)]
pub struct PhoneShareEntry {
    pub extension_id: String,
    pub book_id: String,
    pub token: String,
    pub entry: String,
    pub extension_name: String,
}

#[derive(Default)]
pub struct PhoneShareInner {
    map: Mutex<HashMap<String, PhoneShareEntry>>,
}

pub type PhoneShareState = Arc<PhoneShareInner>;

pub fn new_state() -> PhoneShareState {
    Arc::new(PhoneShareInner::default())
}

// cloud shares = longer slug = slug guessing infeasible.
pub const LOCAL_SLUG_WORDS: usize = 3;
pub const CLOUD_SLUG_WORDS: usize = 5;

impl PhoneShareInner {
    pub fn register(&self, entry: PhoneShareEntry, word_count: usize) -> String {
        let mut map = self.map.lock().expect("phone share state poisoned");
        // Supersede any existing share for this (extension, book) rather than accumulating stale slugs.
        map.retain(|_, e| e.extension_id != entry.extension_id || e.book_id != entry.book_id);
        loop {
            let slug = generate_slug(word_count);
            if !map.contains_key(&slug) {
                map.insert(slug.clone(), entry);
                return slug;
            }
        }
    }

    pub fn lookup(&self, slug: &str) -> Option<PhoneShareEntry> {
        let map = self.map.lock().expect("phone share state poisoned");
        map.get(slug).cloned()
    }

    // True while a share is registered; gates non-loopback access to the HTTP server.
    pub fn has_active(&self) -> bool {
        let map = self.map.lock().expect("phone share state poisoned");
        !map.is_empty()
    }

    pub fn revoke_for_extension(&self, extension_id: &str) {
        let mut map = self.map.lock().expect("phone share state poisoned");
        map.retain(|_, entry| entry.extension_id != extension_id);
    }
}

fn generate_slug(word_count: usize) -> String {
    let mut bytes = vec![0u8; word_count * 4];
    getrandom::fill(&mut bytes).expect("getrandom failed for phone share slug");
    let words: Vec<&str> = (0..word_count)
        .map(|i| {
            let idx = u32::from_le_bytes([
                bytes[i * 4],
                bytes[i * 4 + 1],
                bytes[i * 4 + 2],
                bytes[i * 4 + 3],
            ]);
            WORD_LIST[idx as usize % WORD_LIST.len()]
        })
        .collect();
    words.join("-")
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

pub fn build_path_url(entry: &PhoneShareEntry) -> String {
    let token = encode_route_segment(&entry.token);
    let entry_path = encode_route_segment(&entry.entry);
    let name = encode_route_segment(&entry.extension_name);
    let extension = encode_route_segment(&entry.extension_id);
    let book = encode_route_segment(&entry.book_id);
    format!("/path.html?token={token}&entry={entry_path}&name={name}#/{extension}?bookId={book}")
}

pub async fn phone_share_redirect_handler(
    State(app): State<AppHandle>,
    AxumPath(slug): AxumPath<String>,
) -> Response {
    use tauri::Manager;
    let state = app.state::<PhoneShareState>();
    let Some(entry) = state.lookup(&slug) else {
        return (StatusCode::NOT_FOUND, "phone share not found").into_response();
    };
    let location = build_path_url(&entry);
    let mut resp = Response::new(axum::body::Body::empty());
    *resp.status_mut() = StatusCode::FOUND;
    if let Ok(v) = HeaderValue::from_str(&location) {
        resp.headers_mut().insert(header::LOCATION, v);
    }
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(extension: &str, book: &str) -> PhoneShareEntry {
        PhoneShareEntry {
            extension_id: extension.into(),
            book_id: book.into(),
            token: "jwt".into(),
            entry: "dist/index.html".into(),
            extension_name: "Extension".into(),
        }
    }

    #[test]
    fn local_slug_is_three_words_cloud_is_five() {
        let state = PhoneShareInner::default();
        let local = state.register(entry("@local/cyoa", "book-1"), LOCAL_SLUG_WORDS);
        assert_eq!(local.split('-').count(), 3);
        let cloud = state.register(entry("@local/cyoa", "book-2"), CLOUD_SLUG_WORDS);
        assert_eq!(cloud.split('-').count(), 5);
    }

    #[test]
    fn re_registering_same_extension_book_replaces() {
        let state = PhoneShareInner::default();
        let s1 = state.register(entry("@local/cyoa", "book-1"), LOCAL_SLUG_WORDS);
        let s2 = state.register(entry("@local/cyoa", "book-1"), LOCAL_SLUG_WORDS);
        assert!(state.lookup(&s1).is_none(), "old slug should be evicted");
        assert!(state.lookup(&s2).is_some());
    }

    #[test]
    fn revoke_for_extension_clears_all_books() {
        let state = PhoneShareInner::default();
        let s1 = state.register(entry("@local/cyoa", "book-1"), LOCAL_SLUG_WORDS);
        let s2 = state.register(entry("@local/cyoa", "book-2"), LOCAL_SLUG_WORDS);
        state.revoke_for_extension("@local/cyoa");
        assert!(state.lookup(&s1).is_none());
        assert!(state.lookup(&s2).is_none());
    }
}
