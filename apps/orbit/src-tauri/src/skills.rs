//! Project-scoped Claude Code skill installation and release checks.

use crate::files::{self, Expected, WriteResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

const PLAN: &str = "orbit-plan";
const SYNC: &str = "orbit-sync";
const IMPLEMENT: &str = "orbit-implement";
const NAMES: [&str; 3] = [PLAN, SYNC, IMPLEMENT];
const BUNDLED_VERSION: u32 = 2;
const MCP_VERSION: u32 = 1;
const PLAN_TEXT: &str = include_str!("../../../../skills/claude/orbit-plan/SKILL.md");
const SYNC_TEXT: &str = include_str!("../../../../skills/claude/orbit-sync/SKILL.md");
const IMPLEMENT_TEXT: &str = include_str!("../../../../skills/claude/orbit-implement/SKILL.md");
const STAMP: &str = ".orbit-install.json";
static INSTALL: Mutex<()> = Mutex::new(());

type Hashes = BTreeMap<String, String>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStatus {
    action: &'static str,
    version: u32,
    hashes: BTreeMap<String, Option<String>>,
    customized: Vec<String>,
    notice: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    mcp_version: u32,
    files: BTreeMap<String, RemoteFile>,
}

#[derive(Deserialize)]
struct RemoteFile {
    url: String,
    sha256: String,
}

struct Release {
    version: u32,
    hashes: Hashes,
    remote: Option<Manifest>,
    notice: Option<String>,
}

fn bundled_text(name: &str) -> &'static str {
    match name {
        PLAN => PLAN_TEXT,
        SYNC => SYNC_TEXT,
        _ => IMPLEMENT_TEXT,
    }
}

fn fetch(url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("Skill downloads require direct HTTPS URLs.".into());
    }
    let response = Command::new("curl")
        .args(["-q", "--fail", "--silent", "--show-error", "--proto", "=https",
            "--connect-timeout", "4", "--max-time", "10", "--max-filesize", "262144", "--", url])
        .output()
        .map_err(|e| format!("Could not start the skill download: {e}"))?;
    if !response.status.success() {
        return Err("The official skill release is unavailable. Try again from Install/Update Skills.".into());
    }
    String::from_utf8(response.stdout).map_err(|_| "The skill release is not valid UTF-8.".into())
}

fn load_manifest(url: &str) -> Result<Manifest, String> {
    let manifest: Manifest = serde_json::from_str(&fetch(url)?)
        .map_err(|_| "The official skills manifest is invalid.".to_string())?;
    if manifest.mcp_version != MCP_VERSION {
        return Err("This skill release requires a different version of Orbit.".into());
    }
    for name in NAMES {
        let file = manifest.files.get(name).ok_or_else(|| format!("The release is missing {name}."))?;
        if !file.url.starts_with("https://") || file.sha256.len() != 64 || !file.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("Invalid download metadata for {name}."));
        }
    }
    Ok(manifest)
}

fn bundled() -> Release {
    Release {
        version: BUNDLED_VERSION,
        hashes: NAMES.into_iter().map(|name| (name.into(), files::sha256_hex(bundled_text(name).as_bytes()))).collect(),
        remote: None,
        notice: None,
    }
}

fn release() -> Release {
    let url = std::env::var("ORBIT_SKILLS_MANIFEST_URL").ok()
        .or_else(|| option_env!("ORBIT_SKILLS_MANIFEST_URL").map(str::to_owned));
    let mut release = bundled();
    if let Some(url) = url {
        match load_manifest(&url) {
            Ok(remote) if remote.version >= release.version => {
                release.version = remote.version;
                release.hashes = NAMES.into_iter().map(|name| (name.into(), remote.files[name].sha256.to_ascii_lowercase())).collect();
                release.remote = Some(remote);
            }
            Ok(_) => {}
            Err(error) => release.notice = Some(error),
        }
    }
    release
}

/// Resolve the root from the open contract, using the same repository boundary as Claude's terminal.
fn skill_root(contract: &str) -> Result<PathBuf, String> {
    let contract = fs::canonicalize(files::absolutize(contract)?)
        .map_err(|e| format!("Cannot find the open contract: {e}"))?;
    if !contract.is_file() {
        return Err("Open a saved Orbit contract first.".into());
    }
    let git = crate::git::git_context(&contract.to_string_lossy());
    let project = git.repo_root.map(PathBuf::from)
        .or_else(|| contract.parent().map(Path::to_path_buf))
        .ok_or("Could not find the project root.")?;
    let claude = project.join(".claude");
    let root = claude.join("skills");
    for directory in [&claude, &root, &root.join(PLAN), &root.join(SYNC), &root.join(IMPLEMENT)] {
        match fs::symlink_metadata(directory) {
            Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
                return Err(format!("Expected a project directory at {}.", directory.display()));
            }
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(format!("Cannot inspect {}: {e}", directory.display())),
        }
    }
    Ok(root)
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => fs::read_to_string(path)
            .map(Some).map_err(|e| format!("Cannot read {}: {e}", path.display())),
        Ok(_) => Err(format!("Expected a regular file at {}.", path.display())),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot inspect {}: {e}", path.display())),
    }
}

fn skill_file(root: &Path, name: &str) -> PathBuf {
    root.join(name).join("SKILL.md")
}

fn stamp_file(root: &Path) -> PathBuf {
    root.join(PLAN).join(STAMP)
}

fn hash(text: Option<&String>) -> Option<String> {
    text.map(|text| files::sha256_hex(text.as_bytes()))
}

fn inspect(root: &Path, release: &Release) -> Result<SkillStatus, String> {
    let stamp: Hashes = read(&stamp_file(root))?.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let mut hashes = BTreeMap::new();
    let mut customized = Vec::new();
    let mut update = false;
    for name in NAMES {
        let installed = read(&skill_file(root, name))?;
        let actual = hash(installed.as_ref());
        if let Some(value) = &actual {
            if *value != release.hashes[name] && release.notice.is_none() {
                update = true;
                if stamp.get(name) != Some(value) && *value != files::sha256_hex(bundled_text(name).as_bytes()) {
                    customized.push(name.into());
                }
            }
        }
        hashes.insert(name.into(), actual);
    }
    let action = if hashes.values().any(Option::is_none) { "install" }
        else if update { "update" }
        else if release.notice.is_some() { "unavailable" }
        else { "current" };
    Ok(SkillStatus { action, version: release.version, hashes, customized, notice: release.notice.clone() })
}

pub fn status(contract: &str) -> Result<SkillStatus, String> {
    inspect(&skill_root(contract)?, &release())
}

fn write(path: &Path, text: &str, previous: Option<&String>) -> Result<(), String> {
    let expected = hash(previous).map(Expected::Sha256).unwrap_or(Expected::Absent);
    match files::write_file_atomic(&path.to_string_lossy(), text, &expected) {
        WriteResult::Ok { .. } => Ok(()),
        WriteResult::Conflict { .. } => Err(format!("{} changed during install. Check again.", path.display())),
        WriteResult::Error { message } => Err(message),
    }
}

pub fn install(contract: &str, checked: SkillStatusRequest, replace_custom: bool) -> Result<SkillStatus, String> {
    let _guard = INSTALL.lock().map_err(|_| "A skills install could not finish. Restart Orbit and retry.")?;
    let root = skill_root(contract)?;
    let release = release();
    let state = inspect(&root, &release)?;
    if state.version != checked.version || state.hashes != checked.hashes || state.action != checked.action {
        return Err("The installed skills or release changed. Check again before installing.".into());
    }
    if state.action == "unavailable" {
        return Err(state.notice.unwrap_or_else(|| "Could not check the release.".into()));
    }
    if !replace_custom && !state.customized.is_empty() && state.action == "update" {
        return Err("Confirm replacement of the customized skills first.".into());
    }

    let stamp_path = stamp_file(&root);
    let previous_stamp = read(&stamp_path)?;
    let mut stamp: Hashes = previous_stamp.as_ref().and_then(|s| serde_json::from_str(s).ok()).unwrap_or_default();
    let mut changes = Vec::new();
    for name in NAMES {
        let current = &state.hashes[name];
        if current.as_ref() == Some(&release.hashes[name]) || (state.action == "install" && current.is_some()) {
            continue;
        }
        let text = if let Some(remote) = &release.remote { fetch(&remote.files[name].url)? } else { bundled_text(name).into() };
        if files::sha256_hex(text.as_bytes()) != release.hashes[name] {
            return Err(format!("The downloaded {name} did not match the official release."));
        }
        let path = skill_file(&root, name);
        let before = read(&path)?;
        if hash(before.as_ref()) != *current {
            return Err(format!("{name} changed during install. Check again."));
        }
        stamp.insert(name.into(), release.hashes[name].clone());
        changes.push((path, before, text));
    }

    if !changes.is_empty() {
        let stamp_text = serde_json::to_string_pretty(&stamp).map_err(|e| e.to_string())? + "\n";
        changes.push((stamp_path, previous_stamp, stamp_text));
        for (path, _, _) in &changes {
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
        }
        for (i, (path, before, text)) in changes.iter().enumerate() {
            if let Err(error) = write(path, text, before.as_ref()) {
                for (path, original, installed) in changes[..i].iter().rev() {
                    if let Some(original) = original {
                        let _ = write(path, original, Some(installed));
                    } else if read(path).ok().flatten().as_ref() == Some(installed) {
                        let _ = fs::remove_file(path);
                    }
                }
                return Err(error);
            }
        }
    }
    inspect(&root, &release)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStatusRequest {
    action: String,
    version: u32,
    hashes: BTreeMap<String, Option<String>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(state: &SkillStatus) -> SkillStatusRequest {
        SkillStatusRequest { action: state.action.into(), version: state.version, hashes: state.hashes.clone() }
    }

    #[test]
    fn installs_only_missing_project_skills_and_preserves_local_edits() {
        let temp = tempfile::tempdir().unwrap();
        let contract = temp.path().join("orbit.json");
        fs::write(&contract, "{}").unwrap();
        let contract = contract.to_str().unwrap();
        let root = skill_root(contract).unwrap();
        assert_eq!(root, fs::canonicalize(temp.path()).unwrap().join(".claude/skills"));
        let plan = skill_file(&root, PLAN);
        fs::create_dir_all(plan.parent().unwrap()).unwrap();
        fs::write(&plan, "Customized plan").unwrap();
        let state = status(contract).unwrap();
        assert_eq!(state.action, "install");
        let installed = install(contract, request(&state), false).unwrap();
        assert_eq!(installed.action, "update");
        assert_eq!(installed.customized, [PLAN]);
        assert_eq!(fs::read_to_string(&plan).unwrap(), "Customized plan");
        assert_eq!(fs::read_to_string(skill_file(&root, SYNC)).unwrap(), SYNC_TEXT);
        assert!(install(contract, request(&installed), false).is_err());
        let updated = install(contract, request(&installed), true).unwrap();
        assert_eq!(updated.action, "current");
    }

    #[test]
    fn detects_edits_after_the_install_prompt() {
        let temp = tempfile::tempdir().unwrap();
        let contract = temp.path().join("orbit.json");
        fs::write(&contract, "{}").unwrap();
        let contract = contract.to_str().unwrap();
        let checked = status(contract).unwrap();
        let plan = skill_file(&skill_root(contract).unwrap(), PLAN);
        fs::create_dir_all(plan.parent().unwrap()).unwrap();
        fs::write(&plan, "Created after the check").unwrap();
        assert!(install(contract, request(&checked), true).is_err());
        assert_eq!(fs::read_to_string(plan).unwrap(), "Created after the check");
    }
}
