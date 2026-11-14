use orbit_lib::terminal::{CommandBuilder, Terminals};
use std::sync::mpsc;
use std::time::Duration;
use tauri::ipc::{Channel, InvokeResponseBody};

fn channels() -> (Channel<InvokeResponseBody>, Channel<Option<u32>>, mpsc::Receiver<Vec<u8>>, mpsc::Receiver<Option<u32>>) {
    let (dtx, drx) = mpsc::channel();
    let (etx, erx) = mpsc::channel();
    let data = Channel::new(move |b| {
        if let InvokeResponseBody::Raw(v) = b {
            let _ = dtx.send(v);
        }
        Ok(())
    });
    let exit = Channel::new(move |b| {
        if let InvokeResponseBody::Json(j) = b {
            let _ = etx.send(serde_json::from_str(&j).unwrap());
        }
        Ok(())
    });
    (data, exit, drx, erx)
}

fn collect(rx: &mpsc::Receiver<Vec<u8>>, until: &str) -> String {
    let mut out = String::new();
    while !out.contains(until) {
        match rx.recv_timeout(Duration::from_secs(10)) {
            Ok(b) => out.push_str(&String::from_utf8_lossy(&b)),
            Err(_) => break,
        }
    }
    out
}

#[cfg(unix)]
#[test]
fn runs_in_the_folder_echoes_input_and_reports_exit() {
    let dir = tempfile::tempdir().unwrap();
    let cwd = std::fs::canonicalize(dir.path()).unwrap().to_string_lossy().to_string();
    let terms = Terminals::new();
    let (data, exit, drx, erx) = channels();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", "pwd; printf 'cols=%s\\n' \"$(tput cols)\"; read line; echo \"got:$line\"; exit 3"]);
    let id = terms.open_command(cmd, &cwd, 101, 30, data, exit).unwrap();
    let first = collect(&drx, "cols=");
    assert!(first.contains(&cwd), "{first}");
    terms.write(id, "hello\r").unwrap();
    let rest = collect(&drx, "got:hello");
    assert!(rest.contains("got:hello"), "{rest}");
    assert_eq!(erx.recv_timeout(Duration::from_secs(10)).unwrap(), Some(3));
    assert!(terms.write(id, "x").is_err(), "a finished terminal is gone");
}

#[cfg(unix)]
#[test]
fn close_kills_the_process() {
    let dir = tempfile::tempdir().unwrap();
    let terms = Terminals::new();
    let (data, exit, _drx, erx) = channels();
    let mut cmd = CommandBuilder::new("/bin/sh");
    cmd.args(["-c", "sleep 60"]);
    let id = terms.open_command(cmd, &dir.path().to_string_lossy(), 80, 24, data, exit).unwrap();
    terms.resize(id, 120, 40).unwrap();
    terms.close(id);
    erx.recv_timeout(Duration::from_secs(10)).expect("exit reported after close");
}

#[test]
fn refuses_a_missing_folder() {
    let terms = Terminals::new();
    let (data, exit, _d, _e) = channels();
    let err = terms.open(&std::env::temp_dir().join("orbit-no-such-dir-xyz").to_string_lossy(), 80, 24, data, exit).unwrap_err();
    assert!(err.contains("does not exist"), "{err}");
}
