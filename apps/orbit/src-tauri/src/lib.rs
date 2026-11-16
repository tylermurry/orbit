//! Orbit desktop backend: file access with conflict-safe atomic writes, and read-only Git.

pub mod files;
pub mod git;
pub mod mcp;
pub mod runner;
pub mod skills;
pub mod terminal;
mod file_menu;

use files::{Expected, FileSnapshot, FileStat, WriteResult};
use git::{GitContext, GitFileAtRevision, GitRef};
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
async fn read_playwright_blob(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || files::read_playwright_blob(&path)).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn list_playwright_blobs(dir: String) -> Result<Vec<files::PlaywrightBlob>, String> {
    blocking(move || files::list_playwright_blobs(&dir)).await
}

#[tauri::command]
async fn read_walkthrough_image(manifest: String, image: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || files::read_walkthrough_image(&manifest, &image)).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
async fn stat_file(path: String) -> Result<FileStat, String> {
    blocking(move || files::stat_file(&path)).await
}

#[tauri::command]
async fn list_xml_files(dir: String) -> Result<Vec<String>, String> {
    blocking(move || files::list_xml_files(&dir)).await
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
async fn skills_status(contract: String) -> Result<skills::SkillStatus, String> {
    blocking(move || skills::status(&contract)).await
}

#[tauri::command]
async fn install_skills(contract: String, checked: skills::SkillStatusRequest, replace_custom: bool) -> Result<skills::SkillStatus, String> {
    blocking(move || skills::install(&contract, checked, replace_custom)).await
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

/// Run the validation `command` in a terminal in `cwd`; the session ends with the command.
#[tauri::command]
fn term_run(terms: State<'_, Arc<Terminals>>, cwd: String, command: String, cols: u16, rows: u16, on_data: Channel<InvokeResponseBody>, on_exit: Channel<Option<u32>>) -> Result<u32, String> {
    terms.inner().open_run(&command, &cwd, cols, rows, on_data, on_exit)
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

struct NativeBackdrop(Option<&'static str>);

#[tauri::command]
fn get_native_backdrop(backdrop: State<'_, NativeBackdrop>) -> Option<&'static str> {
    backdrop.0
}

fn apply_native_backdrop(app: &AppHandle) -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    return app.get_webview_window("main").and_then(|window| {
        window_vibrancy::apply_liquid_glass(&window, window_vibrancy::LiquidGlassOptions::default())
            .is_ok()
            .then_some("liquid-glass")
    });
    #[cfg(target_os = "windows")]
    return app.get_webview_window("main").and_then(|window| {
        window_vibrancy::apply_mica(&window, None)
            .is_ok()
            .then_some("mica")
    });
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        None
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .menu(file_menu::build)
        .on_menu_event(|app, event| {
            if let Some(action) = file_menu::action(event.id().as_ref()) {
                let _ = app.emit_to("main", file_menu::EVENT, action);
            }
        })
        .setup(|app| {
            app.manage(NativeBackdrop(apply_native_backdrop(app.handle())));
            let mcp = McpManager::new(app.handle());
            app.manage(mcp.clone());
            app.manage(Runner::new());
            app.manage(Terminals::new());
            mcp.start();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            read_playwright_blob,
            list_playwright_blobs,
            read_walkthrough_image,
            stat_file,
            list_xml_files,
            write_file_atomic,
            initial_file,
            get_native_backdrop,
            file_menu::update_file_menu,
            open_in_editor,
            git_context,
            git_list_refs,
            git_read_file_at,
            git_merge_base,
            skills_status,
            install_skills,
            run_command,
            cancel_command,
            mcp_status,
            mcp_set_enabled,
            mcp_respond,
            mcp_regenerate_token,
            term_open,
            term_run,
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
