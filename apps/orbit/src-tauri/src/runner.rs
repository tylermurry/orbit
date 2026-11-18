//! Runs the contract's validation command (the whole test suite) when a person asks for it.
//!
//! The command runs with `sh -c` (`cmd /C` on Windows) in its own process group, with stdin closed. On
//! macOS/Linux the PATH comes from the user's interactive login shell (read once), so tools installed by nvm,
//! asdf, Homebrew, ... resolve even when Orbit was launched from the Finder with a minimal environment. Output is streamed
//! to a callback as it arrives and the last part is kept for the outcome. A run can be cancelled, which
//! terminates the whole process group (the shell and the test runner it started).

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Output kept for the outcome (the tail; earlier output was already streamed).
const TAIL_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOutcome {
    /// None when the process was killed by a signal (e.g. cancelled).
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    pub duration_ms: u64,
    /// Last part of the combined stdout/stderr.
    pub output: String,
}

#[derive(Default)]
pub struct Runner {
    running: Mutex<HashMap<String, u32>>,
    cancelled: Mutex<Vec<String>>,
}

/// PATH as the user's interactive login shell sets it, or None when it cannot be read within a few seconds.
#[cfg(not(windows))]
fn user_path() -> Option<String> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty())?;
        const MARK: &str = "__ORBIT_PATH__";
        let mut child = Command::new(shell)
            .args(["-ilc", &format!("printf '{MARK}%s{MARK}' \"$PATH\"")])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;
        let mut out = child.stdout.take()?;
        let reader = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = out.read_to_string(&mut s);
            s
        });
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if start.elapsed() < Duration::from_secs(5) => std::thread::sleep(Duration::from_millis(20)),
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
            }
        }
        let text = reader.join().ok()?;
        let path = text.split(MARK).nth(1)?.trim().to_string();
        (!path.is_empty()).then_some(path)
    })
    .clone()
}

fn shell_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(command);
        if let Some(path) = user_path() {
            c.env("PATH", path);
        }
        // Own process group, so cancel can stop the shell and everything it started.
        c.process_group(0);
        c
    }
}

fn pump<R: Read + Send + 'static>(reader: R, tail: Arc<Mutex<Vec<u8>>>, on_output: Arc<dyn Fn(&str) + Send + Sync>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut r = BufReader::new(reader);
        let mut line = Vec::new();
        loop {
            line.clear();
            match r.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    on_output(&String::from_utf8_lossy(&line));
                    let mut t = tail.lock().unwrap();
                    t.extend_from_slice(&line);
                    if t.len() > TAIL_BYTES {
                        let cut = t.len() - TAIL_BYTES;
                        t.drain(..cut);
                    }
                }
            }
        }
    })
}

impl Runner {
    pub fn new() -> Arc<Self> {
        // Resolve the user's PATH in the background so the first run starts promptly.
        #[cfg(not(windows))]
        std::thread::spawn(|| {
            let _ = user_path();
        });
        Arc::new(Self::default())
    }

    pub fn is_running(&self, run_id: &str) -> bool {
        self.running.lock().unwrap().contains_key(run_id)
    }

    /// Run `command` in `cwd`, streaming output lines to `on_output`. Blocks until it exits or is cancelled.
    pub fn run(&self, cwd: &str, command: &str, run_id: &str, on_output: Arc<dyn Fn(&str) + Send + Sync>) -> Result<RunOutcome, String> {
        if command.trim().is_empty() {
            return Err("No test command is configured.".into());
        }
        let dir = Path::new(cwd);
        if !dir.is_dir() {
            return Err(format!("The folder to run the tests in does not exist: {cwd}"));
        }
        if self.running.lock().unwrap().contains_key(run_id) {
            return Err("A run with this id is already in progress.".into());
        }
        let start = Instant::now();
        let mut child = shell_command(command)
            .current_dir(dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start the test command: {e}"))?;
        self.running.lock().unwrap().insert(run_id.to_string(), child.id());
        let tail = Arc::new(Mutex::new(Vec::new()));
        let a = pump(child.stdout.take().unwrap(), tail.clone(), on_output.clone());
        let b = pump(child.stderr.take().unwrap(), tail.clone(), on_output);
        let status = child.wait();
        let _ = a.join();
        let _ = b.join();
        self.running.lock().unwrap().remove(run_id);
        let cancelled = {
            let mut c = self.cancelled.lock().unwrap();
            let was = c.iter().any(|x| x == run_id);
            c.retain(|x| x != run_id);
            was
        };
        let status = status.map_err(|e| format!("The test command failed to run: {e}"))?;
        let output = String::from_utf8_lossy(&tail.lock().unwrap()).into_owned();
        Ok(RunOutcome { exit_code: status.code(), cancelled, duration_ms: start.elapsed().as_millis() as u64, output })
    }

    /// Stop a running command and everything it started. Returns false when no such run is in progress.
    pub fn cancel(&self, run_id: &str) -> bool {
        let Some(pid) = self.running.lock().unwrap().get(run_id).copied() else { return false };
        self.cancelled.lock().unwrap().push(run_id.to_string());
        #[cfg(windows)]
        let r = Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status();
        #[cfg(windows)]
        return r.map(|s| s.success()).unwrap_or(false);
        // Signal the child's own process group, and only when it really leads one: if the group were ever
        // Orbit's own, signalling it would take Orbit down with the test command.
        #[cfg(not(windows))]
        {
            let pid = pid as libc::pid_t;
            // SAFETY: plain syscalls on integers.
            unsafe {
                if libc::getpgid(pid) == pid {
                    libc::kill(-pid, libc::SIGTERM) == 0
                } else {
                    libc::kill(pid, libc::SIGTERM) == 0
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect() -> (Arc<Mutex<String>>, Arc<dyn Fn(&str) + Send + Sync>) {
        let buf = Arc::new(Mutex::new(String::new()));
        let b = buf.clone();
        (buf, Arc::new(move |s: &str| b.lock().unwrap().push_str(s)))
    }

    #[test]
    fn runs_in_folder_streams_output_and_reports_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("marker.txt"), "x").unwrap();
        let r = Runner::new();
        let (seen, cb) = collect();
        #[cfg(not(windows))]
        let cmd = "ls; echo to-stderr 1>&2; exit 3";
        #[cfg(windows)]
        let cmd = "dir /b & echo to-stderr 1>&2 & exit 3";
        let out = r.run(dir.path().to_str().unwrap(), cmd, "a", cb).unwrap();
        assert_eq!(out.exit_code, Some(3));
        assert!(!out.cancelled);
        assert!(out.output.contains("marker.txt"), "{}", out.output);
        assert!(out.output.contains("to-stderr"));
        assert!(seen.lock().unwrap().contains("marker.txt"));
    }

    #[test]
    fn rejects_blank_command_and_missing_folder() {
        let r = Runner::new();
        let (_, cb) = collect();
        assert!(r.run(".", "  ", "a", cb.clone()).is_err());
        assert!(r.run("/definitely/not/here", "echo hi", "b", cb).is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn cancel_stops_the_whole_process_group() {
        let dir = tempfile::tempdir().unwrap();
        let r = Runner::new();
        let r2 = r.clone();
        let (_, cb) = collect();
        let path = dir.path().to_str().unwrap().to_string();
        // A grandchild that would write a file after 3s if it survived the cancel.
        let h = std::thread::spawn(move || r2.run(&path, "(sleep 3; touch survived) & sleep 30", "slow", cb).unwrap());
        let start = Instant::now();
        while !r.is_running("slow") && start.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(200));
        assert!(r.cancel("slow"));
        let out = h.join().unwrap();
        assert!(out.cancelled);
        assert!(out.duration_ms < 10_000);
        std::thread::sleep(Duration::from_millis(3500));
        assert!(!dir.path().join("survived").exists(), "child process outlived the cancel");
        assert!(!r.cancel("slow"));
    }
}
