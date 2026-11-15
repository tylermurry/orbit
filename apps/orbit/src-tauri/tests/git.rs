use orbit_lib::git::*;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::{tempdir, TempDir};

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args(["-c", "user.name=T", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .expect("git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct Repo {
    _tmp: TempDir,
    root: PathBuf,
}

fn init() -> Repo {
    let tmp = tempdir().unwrap();
    let root = fs::canonicalize(tmp.path()).unwrap().join("my repo é");
    fs::create_dir(&root).unwrap();
    git(&root, &["init", "-q", "-b", "main"]);
    Repo { _tmp: tmp, root }
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

/// Repo with contract.json committed on main (v1), tag v1, branch feature (v2), back on main.
fn populated() -> (Repo, PathBuf, String) {
    let r = init();
    let f = r.root.join("sub dir").join("contract.json");
    fs::create_dir_all(f.parent().unwrap()).unwrap();
    fs::write(&f, "{\"v\":1}\n").unwrap();
    git(&r.root, &["add", "-A"]);
    git(&r.root, &["commit", "-q", "-m", "first commit"]);
    let first = git(&r.root, &["rev-parse", "HEAD"]);
    git(&r.root, &["tag", "v1"]);
    git(&r.root, &["tag", "-a", "v1-annot", "-m", "annotated"]);
    git(&r.root, &["checkout", "-q", "-b", "feature"]);
    fs::write(&f, "{\"v\":2}\n").unwrap();
    git(&r.root, &["commit", "-q", "-am", "second: change"]);
    git(&r.root, &["checkout", "-q", "main"]);
    (r, f, first)
}

#[test]
fn refs_listing() {
    let (r, _f, first) = populated();
    let refs = git_list_refs(s(&r.root)).unwrap();
    assert_eq!(refs[0].name, "HEAD");
    assert_eq!(refs[0].kind, RefKind::Head);
    assert_eq!(refs[0].commit, first);
    let find = |n: &str| refs.iter().find(|x| x.name == n).unwrap_or_else(|| panic!("missing {n}"));
    assert_eq!(find("main").kind, RefKind::Branch);
    assert_eq!(find("main").subject, "first commit");
    assert_eq!(find("feature").subject, "second: change");
    assert_eq!(find("v1").kind, RefKind::Tag);
    assert_eq!(find("v1").commit, first);
    assert_eq!(find("v1-annot").commit, first, "annotated tag peeled to commit");
    assert_eq!(find("v1-annot").subject, "first commit");
    assert!(find("main").date.contains('T'));
    let json = serde_json::to_value(find("v1")).unwrap();
    assert_eq!(json["kind"], "tag");
}

#[test]
fn read_at_branch_tag_sha_head() {
    let (r, f, first) = populated();
    let rel = "sub dir/contract.json";
    let at = |rev: &str| git_read_file_at(s(&r.root), rev, rel).unwrap();
    assert_eq!(at("main").text.as_deref(), Some("{\"v\":1}\n"));
    assert_eq!(at("feature").text.as_deref(), Some("{\"v\":2}\n"));
    assert_eq!(at("v1").commit, first);
    assert_eq!(at("HEAD").commit, first);
    assert_eq!(at(&first[..8]).commit, first);
    assert_eq!(at("v1-annot").text.as_deref(), Some("{\"v\":1}\n"));
    // context agrees on relPath
    let ctx = git_context(s(&f));
    assert_eq!(ctx.rel_path.as_deref(), Some(rel));
}

#[test]
fn bom_stripped_at_revision() {
    let r = init();
    fs::write(r.root.join("b.json"), b"\xEF\xBB\xBF{}").unwrap();
    git(&r.root, &["add", "-A"]);
    git(&r.root, &["commit", "-q", "-m", "bom"]);
    assert_eq!(git_read_file_at(s(&r.root), "HEAD", "b.json").unwrap().text.as_deref(), Some("{}"));
}

#[test]
fn missing_path_and_bad_rev() {
    let (r, _f, _first) = populated();
    let res = git_read_file_at(s(&r.root), "main", "nope.json").unwrap();
    assert!(!res.exists && res.text.is_none() && res.commit.len() == 40);
    let err = git_read_file_at(s(&r.root), "no-such-branch", "sub dir/contract.json").unwrap_err();
    assert!(err.contains("Cannot resolve revision 'no-such-branch'"), "{err}");
    assert!(git_read_file_at(s(&r.root), "--output=x", "a").unwrap_err().contains("not a valid revision"));
    assert!(git_read_file_at(s(&r.root), "", "a").is_err());
    assert!(git_read_file_at(s(&r.root), "main", "sub dir").unwrap_err().contains("directory"));
}

#[test]
fn context_clean_modified_and_untracked() {
    let (r, f, first) = populated();
    let c = git_context(s(&f));
    assert!(c.available);
    assert_eq!(c.repo_root.as_deref(), Some(s(&r.root)));
    assert_eq!(c.head_commit.as_deref(), Some(first.as_str()));
    assert_eq!(c.head_branch.as_deref(), Some("main"));
    assert_eq!(c.detached, Some(false));
    assert_eq!(c.tracked_at_head, Some(true));
    assert_eq!(c.working_tree_differs, Some(false));
    assert_eq!(c.shallow, Some(false));

    fs::write(&f, "{\"v\":99}\n").unwrap();
    assert_eq!(git_context(s(&f)).working_tree_differs, Some(true));

    let u = r.root.join("untracked.json");
    fs::write(&u, "{}").unwrap();
    let c = git_context(s(&u));
    assert!(c.available);
    assert_eq!(c.tracked_at_head, Some(false));
    assert_eq!(c.working_tree_differs, Some(true));
    assert_eq!(c.rel_path.as_deref(), Some("untracked.json"));
    // not-yet-existing file (e.g. before Save As)
    let c = git_context(s(&r.root.join("later.json")));
    assert!(c.available);
    assert_eq!(c.tracked_at_head, Some(false));
}

#[test]
fn detached_head() {
    let (r, f, first) = populated();
    git(&r.root, &["checkout", "-q", "--detach", "feature"]);
    let c = git_context(s(&f));
    assert_eq!(c.detached, Some(true));
    assert_eq!(c.head_branch, None);
    assert_ne!(c.head_commit.as_deref(), Some(first.as_str()));
    assert_eq!(c.working_tree_differs, Some(false));
}

#[test]
fn unborn_repo() {
    let r = init();
    let f = r.root.join("c.json");
    fs::write(&f, "{}").unwrap();
    let c = git_context(s(&f));
    assert!(c.available);
    assert_eq!(c.head_commit, None);
    assert_eq!(c.head_branch.as_deref(), Some("main"));
    assert_eq!(c.tracked_at_head, Some(false));
    assert_eq!(c.working_tree_differs, Some(true));
    assert!(git_list_refs(s(&r.root)).unwrap().is_empty());
    let err = git_read_file_at(s(&r.root), "HEAD", "c.json").unwrap_err();
    assert!(err.contains("no commits"), "{err}");
}

#[test]
fn non_repo_and_missing_dir() {
    let d = tempdir().unwrap();
    let f = d.path().join("x.json");
    fs::write(&f, "{}").unwrap();
    let c = git_context(s(&f));
    assert!(!c.available);
    assert_eq!(c.unavailable_reason, Some(UnavailableReason::NotARepo));
    assert!(c.message.is_some());
    let c = git_context(s(&d.path().join("missing").join("x.json")));
    assert_eq!(c.unavailable_reason, Some(UnavailableReason::Error));
    let json = serde_json::to_value(git_context(s(&f))).unwrap();
    assert_eq!(json["unavailableReason"], "not-a-repo");
}

#[test]
fn shallow_clone() {
    let (r, _f, _first) = populated();
    let tmp = tempdir().unwrap();
    let dst = fs::canonicalize(tmp.path()).unwrap().join("clone");
    let url = format!("file://{}", s(&r.root));
    git(tmp.path(), &["clone", "-q", "--depth", "1", "--no-local", &url, s(&dst)]);
    let c = git_context(s(&dst.join("sub dir").join("contract.json")));
    assert!(c.available);
    assert_eq!(c.shallow, Some(true));
}

#[cfg(unix)]
#[test]
fn symlinked_repo_path_is_resolved_consistently() {
    let (r, _f, _first) = populated();
    let tmp = tempdir().unwrap();
    let link = tmp.path().join("link");
    std::os::unix::fs::symlink(&r.root, &link).unwrap();
    let c = git_context(s(&link.join("sub dir").join("contract.json")));
    assert!(c.available);
    assert_eq!(c.repo_root.as_deref(), Some(s(&r.root)));
    assert_eq!(c.rel_path.as_deref(), Some("sub dir/contract.json"));
}

// ---------- AC-13: mechanical read-only proof ----------

fn snapshot(root: &Path) -> BTreeMap<String, String> {
    use sha2::{Digest, Sha256};
    let mut map = BTreeMap::new();
    fn walk(base: &Path, dir: &Path, map: &mut BTreeMap<String, String>) {
        for e in fs::read_dir(dir).unwrap() {
            let e = e.unwrap();
            let p = e.path();
            let rel = p.strip_prefix(base).unwrap().to_string_lossy().into_owned();
            let ft = e.file_type().unwrap();
            if ft.is_dir() {
                map.insert(format!("{rel}/"), "dir".into());
                walk(base, &p, map);
            } else if ft.is_symlink() {
                map.insert(rel, format!("link:{}", fs::read_link(&p).unwrap().display()));
            } else {
                let h = Sha256::digest(fs::read(&p).unwrap());
                let mtime = fs::metadata(&p).unwrap().modified().unwrap();
                map.insert(rel, format!("{h:x}@{mtime:?}"));
            }
        }
    }
    walk(root, root, &mut map);
    map
}

fn exercise_all(r: &Repo, files: &[&Path]) {
    for _ in 0..5 {
        for f in files {
            let _ = git_context(s(f));
        }
        let _ = git_list_refs(s(&r.root));
        for rev in ["HEAD", "main", "feature", "v1", "v1-annot", "bogus"] {
            let _ = git_read_file_at(s(&r.root), rev, "sub dir/contract.json");
            let _ = git_read_file_at(s(&r.root), rev, "missing.json");
        }
    }
}

#[test]
fn ac13_git_dir_and_worktree_byte_identical() {
    let (r, f, _first) = populated();
    // Dirty the worktree: modified tracked file (git status would refresh/rewrite the index),
    // an untracked file, plus a stat-dirty-but-identical file (touch via rewrite of same bytes).
    fs::write(&f, "{\"v\":\"dirty\"}\n").unwrap();
    let untracked = r.root.join("untracked.json");
    fs::write(&untracked, "{}").unwrap();
    let same = r.root.join("same.json");
    fs::write(&same, "x").unwrap();
    git(&r.root, &["add", "same.json"]);
    git(&r.root, &["commit", "-q", "-m", "add same"]);
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(&same, "x").unwrap(); // new mtime, same content: index is stale-stat

    let before_git = snapshot(&r.root.join(".git"));
    let before_tree = snapshot(&r.root);
    assert!(before_git.contains_key("index") && before_git.contains_key("HEAD"));

    exercise_all(&r, &[&f, &untracked, &same]);

    assert_eq!(snapshot(&r.root.join(".git")), before_git, ".git changed");
    assert_eq!(snapshot(&r.root), before_tree, "worktree changed");

    // Detached HEAD and a repo with packed refs.
    git(&r.root, &["pack-refs", "--all"]);
    git(&r.root, &["checkout", "-q", "--detach", "v1"]);
    fs::write(&f, "{\"v\":\"dirty2\"}\n").unwrap();
    let before_git = snapshot(&r.root.join(".git"));
    let before_tree = snapshot(&r.root);
    assert!(before_git.contains_key("packed-refs"));
    exercise_all(&r, &[&f, &untracked, &same]);
    assert_eq!(snapshot(&r.root.join(".git")), before_git, ".git changed (detached/packed)");
    assert_eq!(snapshot(&r.root), before_tree, "worktree changed (detached/packed)");
}

#[test]
fn ac13_unborn_repo_untouched() {
    let r = init();
    let f = r.root.join("c.json");
    fs::write(&f, "{}").unwrap();
    let before = snapshot(&r.root);
    for _ in 0..5 {
        let _ = git_context(s(&f));
        let _ = git_list_refs(s(&r.root));
        let _ = git_read_file_at(s(&r.root), "HEAD", "c.json");
    }
    assert_eq!(snapshot(&r.root), before);
}

/// Negative control: the snapshot harness really does detect `git status` rewriting the index.
#[test]
fn ac13_control_git_status_is_detected() {
    let (r, _f, _first) = populated();
    let same = r.root.join("sub dir").join("contract.json");
    std::thread::sleep(std::time::Duration::from_millis(1100));
    let content = fs::read(&same).unwrap();
    fs::write(&same, content).unwrap(); // stat-dirty, content-identical
    let before = snapshot(&r.root.join(".git"));
    git(&r.root, &["status", "--short"]);
    assert_ne!(snapshot(&r.root.join(".git")), before, "harness failed to detect index refresh");
}

#[test]
fn merge_base_of_feature_and_main() {
    let (r, _f, first) = populated();
    assert_eq!(git_merge_base(s(&r.root), "feature", "main").unwrap(), Some(first.clone()));
    assert_eq!(git_merge_base(s(&r.root), "HEAD", "main").unwrap(), Some(first));
    assert!(git_merge_base(s(&r.root), "nope", "main").is_err());
}

#[test]
fn implementation_status_ignores_only_the_proposal_file() {
    let (r, f, _) = populated();
    assert_eq!(git_context(s(&f)).implementation_dirty, Some(false));
    fs::write(r.root.join("orbit.proposal.json"), "{}").unwrap();
    assert_eq!(git_context(s(&f)).implementation_dirty, Some(false));
    fs::write(r.root.join("new-code.rs"), "fn main() {}").unwrap();
    assert_eq!(git_context(s(&f)).implementation_dirty, Some(true));
}
