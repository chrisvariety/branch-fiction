use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::Url;
use serde::{Deserialize, Serialize};

const STAGING_PREFIX: &str = "branch-extension-fetch-";
const MAX_ZIPBALL_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
const MAX_UNCOMPRESSED_BYTES: u64 = 200 * 1024 * 1024; // 200 MB
const MAX_ENTRIES: usize = 10_000;
const USER_AGENT: &str = "branch-fiction-extension-installer";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedExtension {
    pub path: String,
    pub provenance: Provenance,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Provenance {
    #[serde(rename = "github")]
    Github {
        url: String,
        owner: String,
        repo: String,
        #[serde(rename = "ref")]
        ref_: String,
        sha: String,
        subdir: Option<String>,
    },
}

struct ParsedGithubUrl {
    owner: String,
    repo: String,
    ref_: Option<String>,
    subdir: Option<String>,
}

fn parse_github_url(input: &str) -> Result<ParsedGithubUrl, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    let url = Url::parse(trimmed).map_err(|e| format!("invalid URL: {e}"))?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err("only http(s) URLs are supported".to_string());
    }
    let host = url.host_str().unwrap_or("");
    if host != "github.com" && host != "www.github.com" {
        return Err(format!("only github.com URLs are supported (got {host})"));
    }
    let segments: Vec<&str> = url
        .path_segments()
        .ok_or_else(|| "URL has no path".to_string())?
        .filter(|s| !s.is_empty())
        .collect();
    if segments.len() < 2 {
        return Err("expected /owner/repo in URL".to_string());
    }
    let owner = segments[0].to_string();
    let repo = segments[1].trim_end_matches(".git").to_string();
    if owner.is_empty() || repo.is_empty() {
        return Err("expected /owner/repo in URL".to_string());
    }
    if segments.len() == 2 {
        return Ok(ParsedGithubUrl {
            owner,
            repo,
            ref_: None,
            subdir: None,
        });
    }
    let kind = segments[2];
    if kind != "tree" {
        return Err(format!(
            "unsupported URL shape /{kind}/… — paste a github.com/owner/repo or github.com/owner/repo/tree/<ref>/<subdir> URL"
        ));
    }
    if segments.len() < 4 {
        return Err("expected /owner/repo/tree/<ref> in URL".to_string());
    }
    let ref_ = segments[3].to_string();
    let subdir = if segments.len() > 4 {
        Some(segments[4..].join("/"))
    } else {
        None
    };
    Ok(ParsedGithubUrl {
        owner,
        repo,
        ref_: Some(ref_),
        subdir,
    })
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("build http client: {e}"))
}

#[derive(Deserialize)]
struct CommitResp {
    sha: String,
}

async fn resolve_sha(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    ref_: &str,
) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/commits/{ref_}");
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("resolve ref {ref_}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(300).collect();
        if status.as_u16() == 404 {
            return Err(format!(
                "GitHub returned 404 for {owner}/{repo} @ {ref_}. Check the URL is correct and the repo is public."
            ));
        }
        return Err(format!(
            "GitHub commits API returned HTTP {}: {snippet}",
            status.as_u16()
        ));
    }
    let parsed: CommitResp = resp
        .json()
        .await
        .map_err(|e| format!("parse commit JSON: {e}"))?;
    Ok(parsed.sha)
}

async fn download_zipball(
    client: &reqwest::Client,
    owner: &str,
    repo: &str,
    sha: &str,
) -> Result<Vec<u8>, String> {
    let url = format!("https://api.github.com/repos/{owner}/{repo}/zipball/{sha}");
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("download zipball: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("zipball returned HTTP {}", status.as_u16()));
    }
    if let Some(len) = resp.content_length()
        && len > MAX_ZIPBALL_BYTES
    {
        return Err(format!(
            "zipball is {} bytes; limit is {} bytes",
            len, MAX_ZIPBALL_BYTES
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read zipball body: {e}"))?;
    if bytes.len() as u64 > MAX_ZIPBALL_BYTES {
        return Err(format!(
            "zipball is {} bytes; limit is {} bytes",
            bytes.len(),
            MAX_ZIPBALL_BYTES
        ));
    }
    Ok(bytes.to_vec())
}

fn make_staging_dir() -> Result<PathBuf, String> {
    let id = uuid::Uuid::new_v4();
    let dir = std::env::temp_dir().join(format!("{STAGING_PREFIX}{id}"));
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir staging: {e}"))?;
    Ok(dir)
}

fn is_metadata_path(name: &str) -> bool {
    name.split('/')
        .any(|seg| seg == "__MACOSX" || seg.starts_with("._"))
}

fn detect_zip_root(archive: &zip::ZipArchive<Cursor<&[u8]>>) -> Result<String, String> {
    let mut root: Option<String> = None;
    for name in archive.file_names() {
        if name.is_empty() || is_metadata_path(name) {
            continue;
        }
        let Some(first) = name.split('/').next().filter(|s| !s.is_empty()) else {
            continue;
        };
        match &root {
            None => root = Some(first.to_string()),
            Some(existing) if existing == first => {}
            Some(existing) => {
                return Err(format!(
                    "zipball has multiple top-level entries ({existing}, {first})"
                ));
            }
        }
    }
    root.ok_or_else(|| "zipball was empty".to_string())
}

fn require_manifest_in_archive(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    root: &str,
    subdir: Option<&str>,
) -> Result<(), String> {
    let path = match subdir {
        Some(s) => format!("{root}/{s}/manifest.json"),
        None => format!("{root}/manifest.json"),
    };
    archive.by_name(&path).map(|_| ()).map_err(|_| {
        let label = subdir.unwrap_or("the repository root");
        format!(
            "No manifest.json found at {label}. If the extension lives in a subdirectory, paste a github.com/owner/repo/tree/<ref>/<subdir> URL pointing at the extension folder."
        )
    })
}

fn extract_zip(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, dest: &Path) -> Result<(), String> {
    if archive.len() > MAX_ENTRIES {
        return Err(format!(
            "zipball has {} entries; limit is {}",
            archive.len(),
            MAX_ENTRIES
        ));
    }

    let canonical_dest =
        fs::canonicalize(dest).map_err(|e| format!("canonicalize staging: {e}"))?;
    let mut total_uncompressed: u64 = 0;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("read zip entry {i}: {e}"))?;
        let raw_name = entry.name().to_string();

        if is_metadata_path(&raw_name) {
            continue;
        }

        let path = entry
            .enclosed_name()
            .ok_or_else(|| format!("zip contains unsafe entry name: {raw_name}"))?;

        if entry.is_symlink() {
            return Err(format!("zipball contains a symlink ({raw_name})"));
        }

        let target = dest.join(&path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let canonical_parent = match target.parent() {
            Some(p) => {
                fs::canonicalize(p).map_err(|e| format!("canonicalize {}: {e}", p.display()))?
            }
            None => canonical_dest.clone(),
        };
        if !canonical_parent.starts_with(&canonical_dest) {
            return Err(format!("zip-slip: {raw_name} escapes staging dir"));
        }

        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|e| format!("mkdir {}: {e}", target.display()))?;
            continue;
        }

        // Bomb guard: cap total uncompressed bytes via Read::take, even if entry.size() lies.
        let remaining = MAX_UNCOMPRESSED_BYTES.saturating_sub(total_uncompressed);
        let limit = remaining.saturating_add(1);
        let mut out =
            fs::File::create(&target).map_err(|e| format!("create {}: {e}", target.display()))?;
        let written = std::io::copy(&mut entry.by_ref().take(limit), &mut out)
            .map_err(|e| format!("write {}: {e}", target.display()))?;
        if written > remaining {
            return Err(format!(
                "uncompressed contents exceed {MAX_UNCOMPRESSED_BYTES} byte cap (possible zip bomb)"
            ));
        }
        total_uncompressed = total_uncompressed.saturating_add(written);
    }
    Ok(())
}

const MAX_MANIFEST_BYTES: usize = 256 * 1024;

#[tauri::command]
pub async fn check_github_manifest(url: String) -> Result<String, String> {
    let parsed = parse_github_url(&url)?;
    if let Some(sub) = parsed.subdir.as_ref() {
        for part in sub.split('/') {
            if part.is_empty() || part == ".." || part == "." {
                return Err(format!("invalid subdir segment: {part}"));
            }
        }
    }
    let ref_used = parsed.ref_.clone().unwrap_or_else(|| "HEAD".to_string());
    let path = match parsed.subdir.as_ref() {
        Some(s) => format!("{s}/manifest.json"),
        None => "manifest.json".to_string(),
    };
    let raw_url = format!(
        "https://raw.githubusercontent.com/{}/{}/{}/{}",
        parsed.owner, parsed.repo, ref_used, path
    );
    let client = http_client()?;
    let resp = client
        .get(&raw_url)
        .send()
        .await
        .map_err(|e| format!("fetch manifest: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        if status.as_u16() == 404 {
            return Err(format!(
                "manifest.json not found at {}/{}@{ref_used}/{path}",
                parsed.owner, parsed.repo
            ));
        }
        return Err(format!("manifest fetch returned HTTP {}", status.as_u16()));
    }
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("read manifest body: {e}"))?;
    if body.len() > MAX_MANIFEST_BYTES {
        return Err(format!(
            "manifest.json is {} bytes; limit is {MAX_MANIFEST_BYTES}",
            body.len()
        ));
    }
    String::from_utf8(body.to_vec()).map_err(|e| format!("manifest is not valid UTF-8: {e}"))
}

#[tauri::command]
pub async fn fetch_extension_from_github(url: String) -> Result<FetchedExtension, String> {
    let parsed = parse_github_url(&url)?;
    if let Some(sub) = parsed.subdir.as_ref() {
        for part in sub.split('/') {
            if part.is_empty() || part == ".." || part == "." {
                return Err(format!("invalid subdir segment: {part}"));
            }
        }
    }

    let client = http_client()?;
    let ref_used = parsed.ref_.clone().unwrap_or_else(|| "HEAD".to_string());
    let sha = resolve_sha(&client, &parsed.owner, &parsed.repo, &ref_used).await?;
    let bytes = download_zipball(&client, &parsed.owner, &parsed.repo, &sha).await?;

    let mut archive = zip::ZipArchive::new(Cursor::new(bytes.as_slice()))
        .map_err(|e| format!("open zip: {e}"))?;
    let root = detect_zip_root(&archive)?;
    require_manifest_in_archive(&mut archive, &root, parsed.subdir.as_deref())?;

    let staging = make_staging_dir()?;
    let extract_result = (|| -> Result<String, String> {
        extract_zip(&mut archive, &staging)?;
        let mut final_path = staging.join(&root);
        if let Some(sub) = parsed.subdir.as_ref() {
            for part in sub.split('/') {
                final_path = final_path.join(part);
            }
        }
        Ok(final_path.to_string_lossy().into_owned())
    })();

    let final_path = match extract_result {
        Ok(p) => p,
        Err(e) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(e);
        }
    };

    Ok(FetchedExtension {
        path: final_path,
        provenance: Provenance::Github {
            url,
            owner: parsed.owner,
            repo: parsed.repo,
            ref_: ref_used,
            sha,
            subdir: parsed.subdir,
        },
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn cleanup_extension_fetch(staging_path: String) -> Result<(), String> {
    let path = PathBuf::from(&staging_path);
    let canonical = match fs::canonicalize(&path) {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };

    let temp_root = std::env::temp_dir();
    let canonical_temp = fs::canonicalize(&temp_root).unwrap_or(temp_root);
    if !canonical.starts_with(&canonical_temp) {
        return Err(format!(
            "refusing to clean path outside temp dir: {}",
            canonical.display()
        ));
    }

    let mut cur: &Path = canonical.as_path();
    let mut staging_root: Option<&Path> = None;
    while let Some(file_name) = cur.file_name() {
        let name = file_name.to_string_lossy().into_owned();
        if name.starts_with(STAGING_PREFIX) {
            staging_root = Some(cur);
            break;
        }
        cur = match cur.parent() {
            Some(p) => p,
            None => break,
        };
    }
    let staging_root = staging_root.ok_or_else(|| {
        format!(
            "path is not inside an extension staging dir: {}",
            canonical.display()
        )
    })?;
    fs::remove_dir_all(staging_root).map_err(|e| format!("rm staging: {e}"))?;
    Ok(())
}
