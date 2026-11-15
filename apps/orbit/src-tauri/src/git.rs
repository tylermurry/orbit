//! Read-only Git access via the Git executable.
//! Disable optional locks, terminal prompts and fsmonitor so inspection never refreshes the index.

use crate::files::{absolutize, decode_text, strip_verbatim};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum UnavailableReason {
    GitMissing,
    NotARepo,
    Error,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitContext {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<UnavailableReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rel_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_commit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub head_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detached: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracked_at_head: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_tree_differs: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shallow: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_dirty: Option<bool>,
}

impl GitContext {
    fn unavailable(reason: UnavailableReason, message: impl Into<String>) -> Self {
        GitContext {
            available: false,
            unavailable_reason: Some(reason),
            message: Some(message.into()),
            ..Default::default()
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RefKind {
    Head,
    Branch,
    Tag,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitRef {
    pub name: String,
    pub kind: RefKind,
    pub commit: String,
    pub subject: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileAtRevision {
    pub commit: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug)]
enum GitErr {
    Missing,
    Spawn(String),
    /// git ran but exited non-zero.
    Failed { code: Option<i32>, stderr: String },
}

struct Out {
    stdout: Vec<u8>,
}
impl Out {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).trim().to_string()
    }
}

const MISSING_MSG: &str =
    "The 'git' executable was not found. Install Git and make sure it is on your PATH to compare revisions.";

fn run_git(repo_dir: &Path, args: &[&str], stdin: Option<&str>) -> Result<Out, GitErr> {
    let mut cmd = Command::new("git");
    cmd.arg("-c")
        .arg("core.fsmonitor=false")
        .arg("--no-pager")
        .arg(if args.first() == Some(&"status") { "--no-literal-pathspecs" } else { "--literal-pathspecs" })
        .arg("-C")
        .arg(repo_dir)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        ErrorKind::NotFound => GitErr::Missing,
        _ => GitErr::Spawn(e.to_string()),
    })?;
    if let Some(input) = stdin {
        if let Some(mut si) = child.stdin.take() {
            let input = input.to_string();
            // Write on a thread to avoid pipe deadlocks with large outputs.
            std::thread::spawn(move || {
                let _ = si.write_all(input.as_bytes());
            });
        }
    }
    let output = child.wait_with_output().map_err(|e| GitErr::Spawn(e.to_string()))?;
    if output.status.success() {
        Ok(Out { stdout: output.stdout })
    } else {
        Err(GitErr::Failed {
            code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        })
    }
}

fn describe(e: &GitErr) -> String {
    match e {
        GitErr::Missing => MISSING_MSG.to_string(),
        GitErr::Spawn(m) => format!("Could not run git: {m}"),
        GitErr::Failed { stderr, .. } if !stderr.is_empty() => format!("git failed: {stderr}"),
        GitErr::Failed { code, .. } => format!("git failed (exit code {code:?})"),
    }
}

/// Canonicalize a path that may not exist yet (canonicalize the parent instead).
fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    if let Ok(c) = fs::canonicalize(path) {
        return Ok(c);
    }
    let parent = path.parent().ok_or("Invalid file path.")?;
    let name = path.file_name().ok_or("Invalid file path.")?;
    fs::canonicalize(parent)
        .map(|p| p.join(name))
        .map_err(|_| format!("Folder does not exist: {}", parent.display()))
}

fn rel_to_forward(root: &Path, file: &Path) -> Option<String> {
    let rel = file.strip_prefix(root).ok()?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Some(parts.join("/"))
}

fn is_not_repo(stderr: &str) -> bool {
    stderr.to_lowercase().contains("not a git repository")
}

pub fn git_context(path: &str) -> GitContext {
    let file = match absolutize(path).and_then(|p| canonical_file(&p)) {
        Ok(f) => f,
        Err(m) => return GitContext::unavailable(UnavailableReason::Error, m),
    };
    let dir = match file.parent() {
        Some(d) => d.to_path_buf(),
        None => return GitContext::unavailable(UnavailableReason::Error, "Invalid file path."),
    };

    let top = match run_git(&dir, &["rev-parse", "--show-toplevel"], None) {
        Ok(o) => o.text(),
        Err(GitErr::Missing) => {
            return GitContext::unavailable(UnavailableReason::GitMissing, MISSING_MSG)
        }
        Err(GitErr::Failed { stderr, .. }) if is_not_repo(&stderr) => {
            return GitContext::unavailable(
                UnavailableReason::NotARepo,
                "This file is not inside a Git repository, so version comparison is unavailable.",
            )
        }
        Err(e) => return GitContext::unavailable(UnavailableReason::Error, describe(&e)),
    };
    if top.is_empty() {
        return GitContext::unavailable(
            UnavailableReason::Error,
            "Git reported no working tree for this file (bare repository?).",
        );
    }
    let root = match fs::canonicalize(&top) {
        Ok(r) => r,
        Err(e) => {
            return GitContext::unavailable(
                UnavailableReason::Error,
                format!("Cannot resolve repository root '{top}': {e}"),
            )
        }
    };
    let rel_path = match rel_to_forward(&root, &file) {
        Some(r) if !r.is_empty() => r,
        _ => {
            return GitContext::unavailable(
                UnavailableReason::Error,
                format!(
                    "The file {} is not inside the repository working tree {}.",
                    file.display(),
                    root.display()
                ),
            )
        }
    };

    let mut ctx = GitContext {
        available: true,
        repo_root: Some(strip_verbatim(&root.to_string_lossy())),
        rel_path: Some(rel_path.clone()),
        ..Default::default()
    };

    ctx.shallow = Some(
        run_git(&root, &["rev-parse", "--is-shallow-repository"], None)
            .map(|o| o.text() == "true")
            .unwrap_or(false),
    );

    ctx.implementation_dirty = run_git(
        &root,
        &["status", "--porcelain", "-z", "--untracked-files=all", "--", ".", ":(exclude,top)orbit.proposal.json"],
        None,
    ).ok().map(|out| !out.text().is_empty());

    // HEAD commit (None for an unborn branch).
    let head = run_git(&root, &["rev-parse", "--verify", "-q", "HEAD^{commit}"], None)
        .ok()
        .map(|o| o.text())
        .filter(|s| !s.is_empty());
    ctx.head_commit = head.clone();

    match &head {
        Some(_) => {
            let abbrev = run_git(&root, &["rev-parse", "--abbrev-ref", "HEAD"], None)
                .map(|o| o.text())
                .unwrap_or_default();
            if abbrev == "HEAD" || abbrev.is_empty() {
                ctx.detached = Some(true);
            } else {
                ctx.detached = Some(false);
                ctx.head_branch = Some(abbrev);
            }
        }
        None => {
            // Unborn: HEAD is a symbolic ref to a branch with no commits yet.
            ctx.head_branch = run_git(&root, &["symbolic-ref", "-q", "--short", "HEAD"], None)
                .ok()
                .map(|o| o.text())
                .filter(|s| !s.is_empty());
            ctx.detached = Some(false);
        }
    }

    match head {
        None => {
            ctx.tracked_at_head = Some(false);
            ctx.working_tree_differs = Some(true);
        }
        Some(commit) => match blob_at(&root, &commit, &rel_path) {
            Ok(Some(head_bytes)) => {
                ctx.tracked_at_head = Some(true);
                ctx.working_tree_differs = Some(match fs::read(&file) {
                    Ok(work) => work != head_bytes,
                    Err(_) => true,
                });
            }
            Ok(None) => {
                ctx.tracked_at_head = Some(false);
                ctx.working_tree_differs = Some(true);
            }
            Err(m) => {
                ctx.available = false;
                ctx.unavailable_reason = Some(UnavailableReason::Error);
                ctx.message = Some(m);
            }
        },
    }
    ctx
}

/// Raw bytes of `path` at `commit`, or None if the path does not exist there.
fn blob_at(root: &Path, commit: &str, rel_path: &str) -> Result<Option<Vec<u8>>, String> {
    let listing = run_git(root, &["ls-tree", "-z", commit, "--", rel_path], None).map_err(|e| describe(&e))?;
    let entry = listing.stdout.split(|b| *b == 0).next().unwrap_or_default();
    if entry.is_empty() {
        return Ok(None);
    }
    let entry_s = String::from_utf8_lossy(entry);
    let mode = entry_s.split(' ').next().unwrap_or("");
    if mode == "040000" || mode == "160000" {
        return Err(format!("'{rel_path}' is a directory or submodule at {commit}, not a file."));
    }
    let spec = format!("{commit}:{rel_path}");
    let out = run_git(root, &["show", &spec], None).map_err(|e| describe(&e))?;
    Ok(Some(out.stdout))
}

fn resolve_commit(root: &Path, rev: &str) -> Result<String, String> {
    let rev = rev.trim();
    if rev.is_empty() {
        return Err("No revision was given. Choose a branch, tag, commit SHA or HEAD.".into());
    }
    if rev.starts_with('-') {
        return Err(format!("'{rev}' is not a valid revision."));
    }
    let spec = format!("{rev}^{{commit}}");
    match run_git(root, &["rev-parse", "--verify", "-q", &spec], None) {
        Ok(o) if !o.text().is_empty() => Ok(o.text()),
        Ok(_) | Err(GitErr::Failed { .. }) => {
            let unborn = run_git(root, &["rev-parse", "--verify", "-q", "HEAD^{commit}"], None).is_err();
            if rev == "HEAD" && unborn {
                Err("This repository has no commits yet, so there is no HEAD to compare against. Make a first commit, or compare against the working tree only.".into())
            } else {
                Err(format!(
                    "Cannot resolve revision '{rev}' to a commit. Check the branch/tag name or SHA; in a shallow clone the commit may not be present locally."
                ))
            }
        }
        Err(e) => Err(describe(&e)),
    }
}

pub fn git_read_file_at(repo_root: &str, rev: &str, rel_path: &str) -> Result<GitFileAtRevision, String> {
    let root = absolutize(repo_root)?;
    let commit = resolve_commit(&root, rev)?;
    match blob_at(&root, &commit, rel_path)? {
        None => Ok(GitFileAtRevision { commit, exists: false, text: None }),
        Some(bytes) => {
            let text = decode_text(&bytes)
                .map_err(|_| format!("'{rel_path}' at {rev} is not valid UTF-8 text."))?;
            Ok(GitFileAtRevision { commit, exists: true, text: Some(text) })
        }
    }
}

pub fn git_list_refs(repo_root: &str) -> Result<Vec<GitRef>, String> {
    let root = absolutize(repo_root)?;
    let mut raw: Vec<(String, RefKind, String)> = Vec::new(); // name, kind, commit

    if let Ok(o) = run_git(&root, &["rev-parse", "--verify", "-q", "HEAD^{commit}"], None) {
        if !o.text().is_empty() {
            raw.push(("HEAD".into(), RefKind::Head, o.text()));
        }
    }
    for (prefix, kind, strip) in [("refs/heads", RefKind::Branch, 2), ("refs/tags", RefKind::Tag, 2)] {
        let fmt = format!(
            "--format=%(refname:lstrip={strip})%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)"
        );
        let out = run_git(&root, &["for-each-ref", "--sort=-committerdate", &fmt, prefix], None)
            .map_err(|e| describe(&e))?;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 5 {
                continue;
            }
            let commit = if f[1] == "commit" {
                f[2]
            } else if f[1] == "tag" && f[3] == "commit" {
                f[4]
            } else {
                continue; // tag of a tree/blob or nested tag: not comparable
            };
            raw.push((f[0].to_string(), kind, commit.to_string()));
        }
    }

    let mut info: HashMap<String, (String, String)> = HashMap::new();
    if !raw.is_empty() {
        let mut shas: Vec<&str> = raw.iter().map(|r| r.2.as_str()).collect();
        shas.sort_unstable();
        shas.dedup();
        let input = shas.join("\n") + "\n";
        let out = run_git(
            &root,
            &["log", "--no-walk=unsorted", "--stdin", "--format=%H%x00%s%x00%cI"],
            Some(&input),
        )
        .map_err(|e| describe(&e))?;
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() == 3 {
                info.insert(f[0].to_string(), (f[1].to_string(), f[2].to_string()));
            }
        }
    }

    Ok(raw
        .into_iter()
        .filter_map(|(name, kind, commit)| {
            let (subject, date) = info.get(&commit)?.clone();
            Some(GitRef { name, kind, commit, subject, date })
        })
        .collect())
}

pub fn git_merge_base(repo_root: &str, a: &str, b: &str) -> Result<Option<String>, String> {
    let root = absolutize(repo_root)?;
    let ca = resolve_commit(&root, a)?;
    let cb = resolve_commit(&root, b)?;
    match run_git(&root, &["merge-base", &ca, &cb], None) {
        Ok(o) if !o.text().is_empty() => Ok(Some(o.text())),
        // exit 1 with no output: no common ancestor
        Ok(_) | Err(GitErr::Failed { code: Some(1), .. }) => Ok(None),
        Err(e) => Err(describe(&e)),
    }
}
