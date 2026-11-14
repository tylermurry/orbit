//! The embedded terminal: a pseudo-terminal (via `portable-pty`, WezTerm's cross-platform PTY crate) running the
//! user's login shell, which starts Claude Code (`claude`) in the contract's folder and drops back to an
//! interactive shell when it exits. The UI renders it with xterm.js.
//!
//! Deliberately narrow: the webview can only ask for that one session shape in a folder of its choosing, never an
//! arbitrary program, so the terminal does not widen what a script in the webview could run.

pub use portable_pty::CommandBuilder;
use portable_pty::{native_pty_system, Child, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::{Channel, InvokeResponseBody};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Terminals {
    next: AtomicU32,
    sessions: Mutex<HashMap<u32, Session>>,
}

/// The program (and args) a new terminal runs: the login shell, starting `claude`, then staying interactive.
fn startup_command() -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoExit", "-Command", "claude"]);
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty() && Path::new(s).exists())
            .unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/bash".into() });
        let mut cmd = CommandBuilder::new(&shell);
        // A login + interactive shell reads the user's profile/rc files, so `claude` (and node, nvm, ...) resolve
        // even when Orbit was started from the Finder with a minimal environment.
        let quoted = format!("'{}'", shell.replace('\'', r"'\''"));
        cmd.args(["-l", "-i", "-c", &format!("claude; exec {quoted} -l -i")]);
        cmd.env("SHELL", &shell);
        cmd
    }
}

impl Terminals {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// Start a terminal in `cwd`. Output streams to `on_data` as raw bytes; `on_exit` gets the exit code once.
    pub fn open(self: &Arc<Self>, cwd: &str, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
        self.open_command(startup_command(), cwd, cols, rows, on_data, on_exit)
    }

    /// `open` with a given program (tests use this so they do not start Claude Code).
    #[doc(hidden)]
    pub fn open_command(self: &Arc<Self>, mut cmd: CommandBuilder, cwd: &str, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
        if !Path::new(cwd).is_dir() {
            return Err(format!("The folder '{cwd}' does not exist."));
        }
        let pty = native_pty_system()
            .openpty(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
        cmd.cwd(cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "Orbit");
        let child = pty.slave.spawn_command(cmd).map_err(|e| format!("Could not start the shell: {e}"))?;
        // Close our copy of the slave side so reads see EOF once the shell exits.
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = pty.master.take_writer().map_err(|e| e.to_string())?;

        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions.lock().unwrap().insert(id, Session { master: pty.master, writer, child });

        let terms = Arc::clone(self);
        std::thread::spawn(move || {
            let mut buf = [0u8; 16 * 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                            break;
                        }
                    }
                }
            }
            let code = terms.sessions.lock().unwrap().remove(&id).and_then(|mut s| s.child.wait().ok()).map(|st| st.exit_code());
            let _ = on_exit.send(code);
        });
        Ok(id)
    }

    pub fn write(&self, id: u32, data: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        let s = map.get_mut(&id).ok_or("The terminal has exited.")?;
        s.writer.write_all(data.as_bytes()).and_then(|_| s.writer.flush()).map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let map = self.sessions.lock().unwrap();
        let s = map.get(&id).ok_or("The terminal has exited.")?;
        s.master.resize(PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
    }

    /// Kill the terminal's process; its reader thread then reports the exit.
    pub fn close(&self, id: u32) {
        if let Some(s) = self.sessions.lock().unwrap().get_mut(&id) {
            let _ = s.child.kill();
        }
    }

    pub fn close_all(&self) {
        for s in self.sessions.lock().unwrap().values_mut() {
            let _ = s.child.kill();
        }
    }
}
