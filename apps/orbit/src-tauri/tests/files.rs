use orbit_lib::files::*;
use std::fs;
use tempfile::tempdir;

fn names(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

#[test]
fn read_strips_bom_and_hashes_raw_bytes() {
    let d = tempdir().unwrap();
    let p = d.path().join("a.json");
    let raw = b"\xEF\xBB\xBF{\"a\":1}\r\n";
    fs::write(&p, raw).unwrap();
    let snap = read_file(p.to_str().unwrap()).unwrap();
    assert_eq!(snap.text, "{\"a\":1}\r\n");
    assert_eq!(snap.sha256, sha256_hex(raw));
    assert!(snap.modified_ms > 0.0);
    let st = stat_file(p.to_str().unwrap()).unwrap();
    assert!(st.exists);
    assert_eq!(st.sha256.as_deref(), Some(snap.sha256.as_str()));
}

#[test]
fn stat_missing_and_read_missing() {
    let d = tempdir().unwrap();
    let p = d.path().join("nope.json");
    let st = stat_file(p.to_str().unwrap()).unwrap();
    assert!(!st.exists && st.sha256.is_none() && st.modified_ms.is_none());
    assert!(read_file(p.to_str().unwrap()).unwrap_err().contains("not found"));
}

#[test]
fn write_success_with_matching_sha() {
    let d = tempdir().unwrap();
    let p = d.path().join("a.json");
    fs::write(&p, "old").unwrap();
    let r = write_file_atomic(p.to_str().unwrap(), "new", &Expected::Sha256(sha256_hex(b"old")));
    match r {
        WriteResult::Ok { sha256, .. } => assert_eq!(sha256, sha256_hex(b"new")),
        other => panic!("{other:?}"),
    }
    assert_eq!(fs::read_to_string(&p).unwrap(), "new");
    assert_eq!(names(d.path()), vec!["a.json"]);
}

#[test]
fn write_conflict_on_changed_sha_writes_nothing() {
    let d = tempdir().unwrap();
    let p = d.path().join("a.json");
    fs::write(&p, "changed externally").unwrap();
    let r = write_file_atomic(p.to_str().unwrap(), "mine", &Expected::Sha256(sha256_hex(b"old")));
    match r {
        WriteResult::Conflict { current } => {
            assert!(current.exists);
            assert_eq!(current.sha256, Some(sha256_hex(b"changed externally")));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(fs::read_to_string(&p).unwrap(), "changed externally");
    assert_eq!(names(d.path()), vec!["a.json"]);
}

#[test]
fn write_conflict_when_file_disappeared() {
    let d = tempdir().unwrap();
    let p = d.path().join("gone.json");
    let r = write_file_atomic(p.to_str().unwrap(), "x", &Expected::Sha256(sha256_hex(b"old")));
    match r {
        WriteResult::Conflict { current } => assert!(!current.exists),
        other => panic!("{other:?}"),
    }
    assert!(names(d.path()).is_empty());
}

#[test]
fn absent_expectation_refuses_existing_file_but_creates_new() {
    let d = tempdir().unwrap();
    let p = d.path().join("a.json");
    fs::write(&p, "keep").unwrap();
    assert!(matches!(
        write_file_atomic(p.to_str().unwrap(), "x", &Expected::Absent),
        WriteResult::Conflict { .. }
    ));
    assert_eq!(fs::read_to_string(&p).unwrap(), "keep");
    assert_eq!(names(d.path()), vec!["a.json"]);

    let q = d.path().join("new file é.json");
    assert!(matches!(
        write_file_atomic(q.to_str().unwrap(), "fresh", &Expected::Absent),
        WriteResult::Ok { .. }
    ));
    assert_eq!(fs::read_to_string(&q).unwrap(), "fresh");
    assert_eq!(names(d.path()).len(), 2, "no stray temp files");
}

#[test]
fn any_overwrites_unconditionally_and_leaves_no_temp() {
    let d = tempdir().unwrap();
    let p = d.path().join("a.json");
    fs::write(&p, "old").unwrap();
    assert!(matches!(write_file_atomic(p.to_str().unwrap(), "new", &Expected::Any), WriteResult::Ok { .. }));
    assert_eq!(fs::read_to_string(&p).unwrap(), "new");
    assert_eq!(names(d.path()), vec!["a.json"]);
}

#[test]
fn write_into_missing_folder_is_error() {
    let d = tempdir().unwrap();
    let p = d.path().join("nodir").join("a.json");
    assert!(matches!(write_file_atomic(p.to_str().unwrap(), "x", &Expected::Any), WriteResult::Error { .. }));
}

#[cfg(unix)]
#[test]
fn preserves_permissions_and_symlink() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let d = tempdir().unwrap();
    let real = d.path().join("real.json");
    fs::write(&real, "old").unwrap();
    fs::set_permissions(&real, fs::Permissions::from_mode(0o640)).unwrap();
    let link = d.path().join("link.json");
    symlink(&real, &link).unwrap();
    assert!(matches!(write_file_atomic(link.to_str().unwrap(), "new", &Expected::Any), WriteResult::Ok { .. }));
    assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
    assert_eq!(fs::read_to_string(&real).unwrap(), "new");
    assert_eq!(fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o640);
}

#[test]
fn write_result_json_shape() {
    let ok = serde_json::to_value(WriteResult::Ok { sha256: "ab".into(), modified_ms: 5.0 }).unwrap();
    assert_eq!(ok["ok"], true);
    assert_eq!(ok["modifiedMs"], 5.0);
    let c = serde_json::to_value(WriteResult::Conflict {
        current: FileStat { path: "/x".into(), exists: false, sha256: None, modified_ms: None },
    })
    .unwrap();
    assert_eq!(c["reason"], "conflict");
    assert_eq!(c["current"]["exists"], false);
    assert!(c["current"].get("sha256").is_none());
    let e: Expected = serde_json::from_str(r#"{"kind":"sha256","value":"ff"}"#).unwrap();
    assert!(matches!(e, Expected::Sha256(s) if s == "ff"));
    assert!(matches!(serde_json::from_str::<Expected>(r#"{"kind":"absent"}"#).unwrap(), Expected::Absent));
    assert!(matches!(serde_json::from_str::<Expected>(r#"{"kind":"any"}"#).unwrap(), Expected::Any));
}

#[test]
fn initial_file_resolution() {
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(initial_file_from(&a(&["orbit"]), None), None);
    assert_eq!(initial_file_from(&a(&["orbit", "--flag", "/x/y.json"]), None).as_deref(), Some("/x/y.json"));
    assert_eq!(initial_file_from(&a(&["orbit", "notes.txt"]), Some("/e/env.json".into())).as_deref(), Some("/e/env.json"));
    let rel = initial_file_from(&a(&["orbit", "rel.JSON"]), None).unwrap();
    assert!(std::path::Path::new(&rel).is_absolute());
    assert_eq!(initial_file_from(&a(&["orbit"]), Some(String::new())), None);
}
