//! Orbit desktop backend: file access with conflict-safe atomic writes, and read-only Git (plus the proposal tag).

pub mod files;
pub mod git;
pub mod mcp;
pub mod runner;
pub mod terminal;

use files::{Expected, FileSnapshot, FileStat, WriteResult};
use git::{GitContext, GitFileAtRevision, GitRef, ProposalTag};
use mcp::{McpManager, McpStatus};
use runner::{RunOutcome, Runner};
use std::sync::Arc;
use tauri::ipc::{Channel, InvokeResponseBody};
use terminal::Terminals;
use tauri::async_runtime::spawn_blocking;
use tauri::{AppHandle, Emitter, Manager, State};

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    spawn_blocking(f)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}

#[tauri::command]
async fn read_file(path: String) -> Result<FileSnapshot, String> {
    blocking(move || files::read_file(&path)).await
}

#[tauri::command]
async fn stat_file(path: String) -> Result<FileStat, String> {
    blocking(move || files::stat_file(&path)).await
}

#[tauri::command]
async fn write_file_atomic(path: String, text: String, expected: Expected) -> Result<WriteResult, String> {
    blocking(move || Ok(files::write_file_atomic(&path, &text, &expected))).await
}

#[tauri::command]
async fn open_in_editor(path: String) -> Result<(), String> {
    blocking(move || files::open_in_editor(&path)).await
}

#[tauri::command]
fn initial_file() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    files::initial_file_from(&args, std::env::var("ORBIT_FILE").ok())
}

#[tauri::command]
async fn git_context(path: String) -> Result<GitContext, String> {
    blocking(move || Ok(git::git_context(&path))).await
}

#[tauri::command]
async fn git_list_refs(repo_root: String) -> Result<Vec<GitRef>, String> {
    blocking(move || git::git_list_refs(&repo_root)).await
}

#[tauri::command]
async fn git_read_file_at(repo_root: String, rev: String, rel_path: String) -> Result<GitFileAtRevision, String> {
    blocking(move || git::git_read_file_at(&repo_root, &rev, &rel_path)).await
}

#[tauri::command]
async fn git_merge_base(repo_root: String, a: String, b: String) -> Result<Option<String>, String> {
    blocking(move || git::git_merge_base(&repo_root, &a, &b)).await
}

#[tauri::command]
async fn git_tag_proposal(repo_root: String, branch: String, replace: bool) -> Result<ProposalTag, String> {
    blocking(move || git::git_tag_proposal(&repo_root, &branch, replace)).await
}

/// Streamed output of a validation run: `{ runId, text }`.
pub const RUN_OUTPUT_EVENT: &str = "run:output";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RunOutput {
    run_id: String,
    text: String,
}

#[tauri::command]
async fn run_command(app: AppHandle, runner: State<'_, Arc<Runner>>, cwd: String, command: String, run_id: String) -> Result<RunOutcome, String> {
    let runner = runner.inner().clone();
    blocking(move || {
        let id = run_id.clone();
        let emit = Arc::new(move |text: &str| {
            let _ = app.emit(RUN_OUTPUT_EVENT, RunOutput { run_id: id.clone(), text: text.to_string() });
        });
        runner.run(&cwd, &command, &run_id, emit)
    })
    .await
}

#[tauri::command]
fn cancel_command(runner: State<'_, Arc<Runner>>, run_id: String) -> bool {
    runner.cancel(&run_id)
}

#[tauri::command]
fn mcp_status(mcp: State<'_, Arc<McpManager>>) -> McpStatus {
    mcp.status()
}

#[tauri::command]
fn mcp_set_enabled(mcp: State<'_, Arc<McpManager>>, enabled: bool) -> McpStatus {
    mcp.set_enabled(enabled)
}

#[tauri::command]
fn mcp_respond(mcp: State<'_, Arc<McpManager>>, request_id: String, response: serde_json::Value) {
    mcp.respond(&request_id, response)
}

#[tauri::command]
fn mcp_regenerate_token(mcp: State<'_, Arc<McpManager>>) -> Result<McpStatus, String> {
    mcp.regenerate_token()
}

/// Start the embedded terminal (login shell running `claude`) in `cwd`; returns its id.
#[tauri::command]
fn term_open(terms: State<'_, Arc<Terminals>>, cwd: String, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
    terms.inner().open(&cwd, cols, rows, on_data, on_exit)
}

#[tauri::command]
fn term_write(terms: State<'_, Arc<Terminals>>, id: u32, data: String) -> Result<(), String> {
    terms.write(id, &data)
}

#[tauri::command]
fn term_resize(terms: State<'_, Arc<Terminals>>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terms.resize(id, cols, rows)
}

#[tauri::command]
fn term_close(terms: State<'_, Arc<Terminals>>, id: u32) {
    terms.close(id)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mcp = McpManager::new(app.handle());
            app.manage(mcp.clone());
            app.manage(Runner::new());
            app.manage(Terminals::new());
            mcp.start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            stat_file,
            write_file_atomic,
            initial_file,
            open_in_editor,
            git_context,
            git_list_refs,
            git_read_file_at,
            git_merge_base,
            git_tag_proposal,
            run_command,
            cancel_command,
            mcp_status,
            mcp_set_enabled,
            mcp_respond,
            mcp_regenerate_token,
            term_open,
            term_write,
            term_resize,
            term_close
        ])
        .build(tauri::generate_context!())
        .expect("error while running Orbit")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<Terminals>>().close_all();
            }
        });
}
