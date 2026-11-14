//! File access: reads with content hashing and conflict-checked atomic writes.
//!
//! Wire encoding of the write precondition (`Expected`), mirroring `writeFileAtomic` in
//! `src/host/types.ts`:
//!   * `{ "kind": "any" }`                 <- TS `undefined`: write unconditionally
//!   * `{ "kind": "absent" }`              <- TS `null`: write only if the file does NOT exist
//!   * `{ "kind": "sha256", "value": hex }` <- TS string: write only if on-disk sha256 matches

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub path: String,
    pub text: String,
    pub sha256: String,
    pub modified_ms: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_ms: Option<f64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Expected {
    Any,
    Absent,
    Sha256(String),
}

#[derive(Debug, Clone, PartialEq)]
pub enum WriteResult {
    Ok { sha256: String, modified_ms: f64 },
    Conflict { current: FileStat },
    Error { message: String },
}

impl Serialize for WriteResult {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let v: Value = match self {
            WriteResult::Ok { sha256, modified_ms } => {
                json!({ "ok": true, "sha256": sha256, "modifiedMs": modified_ms })
            }
            WriteResult::Conflict { current } => {
                json!({ "ok": false, "reason": "conflict", "current": current })
            }
            WriteResult::Error { message } => {
                json!({ "ok": false, "reason": "error", "message": message })
            }
        };
        v.serialize(s)
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Make a path absolute without resolving symlinks.
pub fn absolutize(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("No file path was given.".into());
    }
    let p = Path::new(path);
    if p.is_absolute() {
        Ok(p.to_path_buf())
    } else {
        std::env::current_dir()
            .map(|d| d.join(p))
            .map_err(|e| format!("Cannot resolve relative path '{path}': {e}"))
    }
}

fn modified_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)
}

/// Decode bytes as UTF-8 text with any leading BOM removed.
pub fn decode_text(bytes: &[u8]) -> Result<String, std::string::FromUtf8Error> {
    String::from_utf8(strip_bom(bytes).to_vec())
}

pub fn read_file(path: &str) -> Result<FileSnapshot, String> {
    let p = absolutize(path)?;
    let bytes = fs::read(&p).map_err(|e| match e.kind() {
        ErrorKind::NotFound => format!("File not found: {}", p.display()),
        ErrorKind::PermissionDenied => format!("Permission denied reading {}", p.display()),
        _ => format!("Cannot read {}: {e}", p.display()),
    })?;
    let meta = fs::metadata(&p).map_err(|e| format!("Cannot stat {}: {e}", p.display()))?;
    let text = decode_text(&bytes)
        .map_err(|_| format!("{} is not valid UTF-8 text and cannot be opened.", p.display()))?;
    Ok(FileSnapshot {
        path: p.to_string_lossy().into_owned(),
        text,
        sha256: sha256_hex(&bytes),
        modified_ms: modified_ms(&meta),
    })
}

pub fn stat_file(path: &str) -> Result<FileStat, String> {
    let p = absolutize(path)?;
    let path_s = p.to_string_lossy().into_owned();
    match fs::read(&p) {
        Ok(bytes) => {
            let meta = fs::metadata(&p).map_err(|e| format!("Cannot stat {path_s}: {e}"))?;
            Ok(FileStat {
                path: path_s,
                exists: true,
                sha256: Some(sha256_hex(&bytes)),
                modified_ms: Some(modified_ms(&meta)),
            })
        }
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(FileStat {
            path: path_s,
            exists: false,
            sha256: None,
            modified_ms: None,
        }),
        Err(e) => Err(format!("Cannot read {path_s}: {e}")),
    }
}

fn temp_name(target: &Path) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let base = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into());
    format!(".{base}.orbit-tmp-{}-{nanos}", std::process::id())
}

#[cfg(unix)]
fn sync_dir(dir: &Path) {
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
}
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) {}

struct TempGuard(Option<PathBuf>);
impl Drop for TempGuard {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            let _ = fs::remove_file(p);
        }
    }
}

pub fn write_file_atomic(path: &str, text: &str, expected: &Expected) -> WriteResult {
    match write_inner(path, text, expected) {
        Ok(r) => r,
        Err(message) => WriteResult::Error { message },
    }
}

fn write_inner(path: &str, text: &str, expected: &Expected) -> Result<WriteResult, String> {
    let requested = absolutize(path)?;
    // Write through symlinks so the link itself is preserved.
    let target = match fs::canonicalize(&requested) {
        Ok(p) => p,
        Err(_) => requested.clone(),
    };
    let dir = target
        .parent()
        .ok_or_else(|| format!("Invalid target path: {}", requested.display()))?
        .to_path_buf();
    if !dir.is_dir() {
        return Err(format!("Folder does not exist: {}", dir.display()));
    }

    // Precondition check against what is on disk right now.
    if !matches!(expected, Expected::Any) {
        let current = stat_file(&target.to_string_lossy())?;
        let ok = match expected {
            Expected::Any => true,
            Expected::Absent => !current.exists,
            Expected::Sha256(s) => current.exists && current.sha256.as_deref() == Some(s.as_str()),
        };
        if !ok {
            let mut current = current;
            current.path = requested.to_string_lossy().into_owned();
            return Ok(WriteResult::Conflict { current });
        }
    }

    let existing_meta = fs::metadata(&target).ok();
    let tmp_path = dir.join(temp_name(&target));
    let mut guard = TempGuard(Some(tmp_path.clone()));
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|e| format!("Cannot create temporary file in {}: {e}", dir.display()))?;
        f.write_all(text.as_bytes())
            .map_err(|e| format!("Cannot write {}: {e}", tmp_path.display()))?;
        if let Some(m) = &existing_meta {
            let _ = fs::set_permissions(&tmp_path, m.permissions());
        }
        f.sync_all()
            .map_err(|e| format!("Cannot flush {}: {e}", tmp_path.display()))?;
    }

    if matches!(expected, Expected::Absent) {
        // Atomic no-clobber publish: hard_link fails if the target appeared meanwhile.
        match fs::hard_link(&tmp_path, &target) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                let mut current = stat_file(&target.to_string_lossy())?;
                current.path = requested.to_string_lossy().into_owned();
                return Ok(WriteResult::Conflict { current });
            }
            // Filesystem without hard links: fall back to rename (checked above).
            Err(_) => fs::rename(&tmp_path, &target)
                .map_err(|e| format!("Cannot replace {}: {e}", target.display()))?,
        }
    } else {
        // std::fs::rename replaces the destination atomically (MoveFileEx REPLACE_EXISTING on Windows).
        fs::rename(&tmp_path, &target)
            .map_err(|e| format!("Cannot replace {}: {e}", target.display()))?;
    }
    // After rename the temp is gone (no-op); after hard_link this removes the extra name.
    if let Some(p) = guard.0.take() {
        let _ = fs::remove_file(p);
    }
    sync_dir(&dir);

    let meta = fs::metadata(&target).map_err(|e| format!("Cannot stat {}: {e}", target.display()))?;
    Ok(WriteResult::Ok {
        sha256: sha256_hex(text.as_bytes()),
        modified_ms: modified_ms(&meta),
    })
}

/// First non-flag argument ending in `.json`, else the `ORBIT_FILE` value; absolute path.
pub fn initial_file_from(args: &[String], env_file: Option<String>) -> Option<String> {
    let from_args = args
        .iter()
        .skip(1)
        .find(|a| !a.starts_with('-') && a.to_lowercase().ends_with(".json"))
        .cloned();
    let chosen = from_args.or_else(|| env_file.filter(|s| !s.is_empty()))?;
    let abs = absolutize(&chosen).ok()?;
    let abs = fs::canonicalize(&abs).unwrap_or(abs);
    Some(strip_verbatim(&abs.to_string_lossy()))
}

pub fn strip_verbatim(s: &str) -> String {
    s.strip_prefix(r"\\?\").unwrap_or(s).to_string()
}

/// Open an existing file in the default editor (currently JetBrains WebStorm). Arguments are passed directly to the
/// process (never through a shell), and only existing regular files are accepted.
pub fn open_in_editor(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_file() {
        return Err(format!("Cannot open {path}: the file does not exist."));
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").args(["-a", "WebStorm", path]).status();
    #[cfg(not(target_os = "macos"))]
    let status = std::process::Command::new("webstorm").arg(path).status();
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err("Could not open the file in WebStorm. Is WebStorm installed?".to_string()),
        Err(e) => Err(format!("Could not launch WebStorm: {e}")),
    }
}
