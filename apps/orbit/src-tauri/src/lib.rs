//! Orbit desktop backend: file access with conflict-safe atomic writes, and strictly read-only Git.

pub mod files;
pub mod git;
pub mod mcp;

use files::{Expected, FileSnapshot, FileStat, WriteResult};
use git::{GitContext, GitFileAtRevision, GitRef};
use mcp::{McpManager, McpStatus};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;
use tauri::{Manager, State};

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let mcp = McpManager::new(app.handle());
            app.manage(mcp.clone());
            mcp.start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            stat_file,
            write_file_atomic,
            initial_file,
            git_context,
            git_list_refs,
            git_read_file_at,
            mcp_status,
            mcp_set_enabled,
            mcp_respond,
            mcp_regenerate_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running Orbit");
}
