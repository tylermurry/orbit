//! Built-in MCP (Model Context Protocol) server, Streamable HTTP transport, bound to 127.0.0.1 only.
//!
//! Layering:
//! - [`handle_request`] is a pure function (request in, response out) that implements the HTTP + JSON-RPC protocol
//!   handling and delegates `tools/list` / `tools/call` to a [`Forwarder`]. It has no Tauri dependency.
//! - [`start_server`] runs it behind a `tiny_http` listener on a dedicated thread.
//! - [`Bridge`] is the production [`Forwarder`]: it emits the `mcp:request` event to the UI and waits for the UI to
//!   call `mcp_respond`.
//! - [`McpManager`] owns persisted config (enabled flag, token), server lifecycle and status, and backs the Tauri
//!   commands defined in `lib.rs`.
//!
//! The contract with the UI is documented in `src/mcp/bridge.ts`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub const DEFAULT_PORT: u16 = 47821;
pub const PORT_TRIES: u16 = 10;
pub const MAX_BODY: usize = 4 * 1024 * 1024;
pub const UI_TIMEOUT: Duration = Duration::from_secs(60);
pub const REQUEST_EVENT: &str = "mcp:request";
pub const STATUS_EVENT: &str = "mcp:status";
const FALLBACK_VERSION: &str = "2025-06-18";
const SUPPORTED_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS: &str = "Orbit is a local-first product contract editor: a document of capabilities, systems, behaviors, tests, evidence and the relationships between them. \
These tools act on the document currently open in the running Orbit app, exactly as a user would. \
Edits are made in memory and are undoable until you call save_file. Call get_status first to see what is open and its state.";

// ---------------------------------------------------------------------------------------------------------------
// Protocol layer (Tauri-free)
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<Value>,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), data: None }
    }
    fn to_json(&self) -> Value {
        let mut e = json!({ "code": self.code, "message": self.message });
        if let Some(d) = &self.data {
            e["data"] = d.clone();
        }
        e
    }
}

/// Executes forwarded MCP methods (`tools/list`, `tools/call`).
pub trait Forwarder: Send + Sync {
    fn forward(&self, method: &str, params: Value) -> Result<Value, RpcError>;
}

#[derive(Debug, Clone)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn empty(status: u16) -> Self {
        Self { status, headers: vec![], body: vec![] }
    }
    fn text(status: u16, msg: &str) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), "text/plain; charset=utf-8".into())],
            body: msg.as_bytes().to_vec(),
        }
    }
    fn json(status: u16, v: &Value) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: serde_json::to_vec(v).unwrap_or_default(),
        }
    }
    fn with_header(mut self, k: &str, v: &str) -> Self {
        self.headers.push((k.into(), v.into()));
        self
    }
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
    pub fn body_json(&self) -> Option<Value> {
        serde_json::from_slice(&self.body).ok()
    }
}

pub struct ServerConfig {}

fn rpc_error_response(status: u16, id: Value, e: RpcError) -> HttpResponse {
    HttpResponse::json(status, &json!({ "jsonrpc": "2.0", "id": id, "error": e.to_json() }))
}

/// Constant-time byte comparison (length difference is folded into the result, not short-circuited).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= (a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0)) as usize;
    }
    diff == 0
}

/// Only local origins may talk to the server (DNS-rebinding / browser-initiated request protection).
pub fn origin_allowed(origin: &str) -> bool {
    if origin == "tauri://localhost" || origin == "https://tauri.localhost" {
        // https://tauri.localhost: Windows WebView2 serves the app from there in some configurations.
        return true;
    }
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let (host, port) = match rest.split_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if !matches!(host, "localhost" | "127.0.0.1" | "tauri.localhost") {
        return false;
    }
    match port {
        None => true,
        Some(p) => !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit()),
    }
}

fn sanitize_for_log(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(64).collect()
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    if getrandom::fill(&mut buf).is_err() {
        // Extremely unlikely; fall back to clock + counter entropy rather than panicking in a server thread.
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        for (i, b) in buf.iter_mut().enumerate() {
            *b = (n >> ((i % 16) * 8)) as u8 ^ (i as u8).wrapping_mul(31);
        }
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn session_id() -> String {
    let h = random_hex(16);
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

/// Handle one HTTP request. Pure with respect to I/O: everything external goes through `fwd`.
pub fn handle_request(cfg: &ServerConfig, req: &HttpRequest, fwd: &dyn Forwarder) -> HttpResponse {
    let mut resp = route(cfg, req, fwd);
    // CORS: only ever echo an allowed local origin.
    if let Some(origin) = req.header("origin") {
        if origin_allowed(origin) {
            resp = resp
                .with_header("Access-Control-Allow-Origin", origin)
                .with_header("Vary", "Origin")
                .with_header("Access-Control-Expose-Headers", "Mcp-Session-Id");
        }
    }
    resp
}

fn route(_cfg: &ServerConfig, req: &HttpRequest, fwd: &dyn Forwarder) -> HttpResponse {
    let path = req.path.split('?').next().unwrap_or("");
    if path != "/mcp" && path != "/mcp/" {
        return HttpResponse::text(404, "Not found");
    }
    if let Some(origin) = req.header("origin") {
        if !origin_allowed(origin) {
            return HttpResponse::text(403, "Forbidden origin");
        }
    }
    let method = req.method.to_ascii_uppercase();
    if method == "OPTIONS" {
        return HttpResponse::empty(204)
            .with_header("Allow", "POST, OPTIONS")
            .with_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            .with_header(
                "Access-Control-Allow-Headers",
                "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
            )
            .with_header("Access-Control-Max-Age", "600");
    }
    if method != "POST" {
        return HttpResponse::text(405, "Method not allowed").with_header("Allow", "POST, OPTIONS");
    }
    if let Some(v) = req.header("mcp-protocol-version") {
        if !SUPPORTED_VERSIONS.contains(&v.trim()) {
            return HttpResponse::text(400, "Unsupported MCP-Protocol-Version");
        }
    }
    if req.body.len() > MAX_BODY {
        return HttpResponse::text(413, "Request body too large");
    }

    let msg: Value = match serde_json::from_slice(&req.body) {
        Ok(v) => v,
        Err(e) => return rpc_error_response(400, Value::Null, RpcError::new(-32700, format!("Parse error: {e}"))),
    };
    let obj = match &msg {
        Value::Array(_) => {
            return rpc_error_response(
                400,
                Value::Null,
                RpcError::new(-32600, "Invalid Request: JSON-RPC batching is not supported (MCP 2025-06-18)"),
            )
        }
        Value::Object(o) => o,
        _ => return rpc_error_response(400, Value::Null, RpcError::new(-32600, "Invalid Request: expected a JSON object")),
    };

    let id = obj.get("id");
    let method_name = obj.get("method");
    match (method_name, id) {
        // Client response (no method): acknowledge.
        (None, Some(_)) => return HttpResponse::empty(202),
        (None, None) => return rpc_error_response(400, Value::Null, RpcError::new(-32600, "Invalid Request: missing method")),
        _ => {}
    }
    let Some(Value::String(rpc_method)) = method_name else {
        return rpc_error_response(400, Value::Null, RpcError::new(-32600, "Invalid Request: method must be a string"));
    };
    let params = obj.get("params").cloned().unwrap_or_else(|| json!({}));

    let Some(id) = id else {
        eprintln!("[orbit-mcp] POST {} (notification)", sanitize_for_log(rpc_method));
        return HttpResponse::empty(202);
    };
    if !(id.is_string() || id.is_number()) {
        return rpc_error_response(400, Value::Null, RpcError::new(-32600, "Invalid Request: id must be a string or number"));
    }

    let tool = if rpc_method == "tools/call" {
        params.get("name").and_then(|n| n.as_str()).map(|n| format!(" {}", sanitize_for_log(n))).unwrap_or_default()
    } else {
        String::new()
    };
    eprintln!("[orbit-mcp] POST {}{}", sanitize_for_log(rpc_method), tool);

    let mut extra_headers: Vec<(&str, String)> = vec![];
    let outcome: Result<Value, RpcError> = match rpc_method.as_str() {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(|v| v.as_str());
            let version = match requested {
                Some(v) if SUPPORTED_VERSIONS.contains(&v) => v,
                _ => FALLBACK_VERSION,
            };
            extra_headers.push(("Mcp-Session-Id", session_id()));
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "orbit", "title": "Orbit", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" | "tools/call" => fwd.forward(rpc_method, params),
        other if other.starts_with("notifications/") => return HttpResponse::empty(202),
        _ => Err(RpcError::new(-32601, format!("Method not found: {}", sanitize_for_log(rpc_method)))),
    };

    let body = match outcome {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(e) => json!({ "jsonrpc": "2.0", "id": id, "error": e.to_json() }),
    };
    let mut resp = HttpResponse::json(200, &body);
    for (k, v) in extra_headers {
        resp = resp.with_header(k, &v);
    }
    resp
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP server (tiny_http on dedicated threads)
// ---------------------------------------------------------------------------------------------------------------

pub struct ServerHandle {
    pub port: u16,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ServerHandle {
    pub fn stop(mut self) {
        self.shutdown();
    }
    fn shutdown(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn serve_one(mut request: tiny_http::Request, cfg: &ServerConfig, fwd: &dyn Forwarder) {
    let method = request.method().as_str().to_string();
    let path = request.url().to_string();
    let headers: Vec<(String, String)> = request
        .headers()
        .iter()
        .map(|h| (h.field.as_str().as_str().to_string(), h.value.as_str().to_string()))
        .collect();

    let too_large = request.body_length().map(|l| l > MAX_BODY).unwrap_or(false);
    let mut body = Vec::new();
    if !too_large {
        let mut limited = request.as_reader().take(MAX_BODY as u64 + 1);
        if limited.read_to_end(&mut body).is_err() {
            body.clear();
        }
    } else {
        // Hand the protocol layer an oversized marker without reading it all.
        body = vec![0u8; MAX_BODY + 1];
    }
    let resp = handle_request(cfg, &HttpRequest { method, path, headers, body }, fwd);

    let mut out = tiny_http::Response::from_data(resp.body).with_status_code(resp.status);
    for (k, v) in &resp.headers {
        if let Ok(h) = tiny_http::Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            out.add_header(h);
        }
    }
    let _ = request.respond(out);
}

/// Bind on 127.0.0.1 trying `first_port ..= first_port + tries - 1` (port 0 = ephemeral, single attempt) and serve
/// on a dedicated thread. Each request is handled on its own short-lived thread since forwarding can block.
pub fn start_server(
    first_port: u16,
    tries: u16,
    cfg: Arc<ServerConfig>,
    fwd: Arc<dyn Forwarder>,
) -> Result<ServerHandle, String> {
    let attempts = if first_port == 0 { 1 } else { tries.max(1) };
    let mut last_err = String::new();
    let mut bound = None;
    for i in 0..attempts {
        let Some(port) = first_port.checked_add(i) else { break };
        match tiny_http::Server::http(("127.0.0.1", port)) {
            Ok(s) => {
                bound = Some(s);
                break;
            }
            Err(e) => last_err = e.to_string(),
        }
    }
    let Some(server) = bound else {
        return Err(format!(
            "Could not bind an MCP port in {}-{} on 127.0.0.1 ({}). Free one of these ports or set ORBIT_MCP_PORT to another value.",
            first_port,
            first_port.saturating_add(attempts - 1),
            last_err
        ));
    };
    let port = server
        .server_addr()
        .to_ip()
        .map(|a| a.port())
        .ok_or_else(|| "MCP server bound to a non-IP address".to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = stop.clone();
    let thread = std::thread::Builder::new()
        .name("orbit-mcp-http".into())
        .spawn(move || {
            while !stop_flag.load(Ordering::SeqCst) {
                match server.recv_timeout(Duration::from_millis(100)) {
                    Ok(Some(request)) => {
                        let cfg = cfg.clone();
                        let fwd = fwd.clone();
                        let _ = std::thread::Builder::new()
                            .name("orbit-mcp-req".into())
                            .spawn(move || serve_one(request, &cfg, fwd.as_ref()));
                    }
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        })
        .map_err(|e| format!("Could not start MCP server thread: {e}"))?;
    Ok(ServerHandle { port, stop, thread: Some(thread) })
}

// ---------------------------------------------------------------------------------------------------------------
// Bridge to the UI
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRequest {
    pub request_id: String,
    pub method: String,
    pub params: Value,
}

type EmitFn = Box<dyn Fn(&BridgeRequest) -> Result<(), String> + Send + Sync>;

pub struct Bridge {
    pending: Mutex<HashMap<String, mpsc::SyncSender<Value>>>,
    emit: EmitFn,
    timeout: Duration,
}

impl Bridge {
    pub fn new(emit: EmitFn, timeout: Duration) -> Self {
        Self { pending: Mutex::new(HashMap::new()), emit, timeout }
    }

    /// Deliver the UI's response. Returns false if the request is unknown (e.g. already timed out).
    pub fn respond(&self, request_id: &str, response: Value) -> bool {
        let tx = self.pending.lock().ok().and_then(|mut p| p.remove(request_id));
        match tx {
            Some(tx) => tx.send(response).is_ok(),
            None => false,
        }
    }
}

fn ui_unavailable() -> RpcError {
    RpcError::new(-32001, "Orbit UI did not respond (is a window open?)")
}

impl Forwarder for Bridge {
    fn forward(&self, method: &str, params: Value) -> Result<Value, RpcError> {
        let request_id = random_hex(12);
        let (tx, rx) = mpsc::sync_channel(1);
        self.pending.lock().map_err(|_| ui_unavailable())?.insert(request_id.clone(), tx);
        let req = BridgeRequest { request_id: request_id.clone(), method: method.to_string(), params };
        if (self.emit)(&req).is_err() {
            if let Ok(mut p) = self.pending.lock() {
                p.remove(&request_id);
            }
            return Err(ui_unavailable());
        }
        match rx.recv_timeout(self.timeout) {
            Ok(response) => translate_ui_response(response),
            Err(_) => {
                if let Ok(mut p) = self.pending.lock() {
                    p.remove(&request_id);
                }
                Err(ui_unavailable())
            }
        }
    }
}

fn translate_ui_response(response: Value) -> Result<Value, RpcError> {
    if let Some(err) = response.get("error").filter(|e| !e.is_null()) {
        let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(-32603);
        let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("Orbit UI error").to_string();
        return Err(RpcError { code, message, data: err.get("data").cloned() });
    }
    match response.get("result") {
        Some(r) => Ok(r.clone()),
        None => Err(RpcError::new(-32603, "Invalid response from Orbit UI: expected {result} or {error}")),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Config persistence, lifecycle, status
// ---------------------------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Persisted {
    enabled: bool,
    token: String,
}

impl Default for Persisted {
    fn default() -> Self {
        Self { enabled: true, token: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    pub token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct State {
    cfg: Persisted,
    server: Option<ServerHandle>,
    error: Option<String>,
}

pub struct McpManager {
    app: AppHandle,
    config_path: Option<PathBuf>,
    bridge: Arc<Bridge>,
    env_token: Option<String>,
    env_disabled: bool,
    first_port: u16,
    state: Mutex<State>,
}

fn write_private(path: &PathBuf, text: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        f.write_all(text.as_bytes())?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, text)
    }
}

impl McpManager {
    pub fn new(app: &AppHandle) -> Arc<Self> {
        let config_path = app.path().app_config_dir().ok().map(|d| d.join("mcp.json"));
        let mut cfg: Persisted = config_path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default();
        let mut error = None;
        if cfg.token.len() < 32 {
            cfg.token = random_hex(32);
            if let Some(p) = &config_path {
                if let Err(e) = write_private(p, &serde_json::to_string_pretty(&cfg).unwrap_or_default()) {
                    error = Some(format!("Could not persist MCP settings to {}: {e}", p.display()));
                }
            }
        }
        let env_token = std::env::var("ORBIT_MCP_TOKEN").ok().filter(|t| !t.is_empty());
        let env_disabled = matches!(std::env::var("ORBIT_MCP_DISABLED").as_deref(), Ok("1") | Ok("true"));
        let first_port = std::env::var("ORBIT_MCP_PORT").ok().and_then(|p| p.trim().parse().ok()).unwrap_or(DEFAULT_PORT);
        let emit_app = app.clone();
        let bridge = Arc::new(Bridge::new(
            Box::new(move |req| emit_app.emit_to("main", REQUEST_EVENT, req).map_err(|e| e.to_string())),
            UI_TIMEOUT,
        ));
        Arc::new(Self {
            app: app.clone(),
            config_path,
            bridge,
            env_token,
            env_disabled,
            first_port,
            state: Mutex::new(State { cfg, server: None, error }),
        })
    }

    fn token(&self, st: &State) -> String {
        self.env_token.clone().unwrap_or_else(|| st.cfg.token.clone())
    }

    fn persist(&self, st: &mut State) {
        if let Some(p) = &self.config_path {
            if let Err(e) = write_private(p, &serde_json::to_string_pretty(&st.cfg).unwrap_or_default()) {
                st.error = Some(format!("Could not persist MCP settings to {}: {e}", p.display()));
            }
        }
    }

    fn status_of(&self, st: &State) -> McpStatus {
        let running = st.server.is_some();
        let port = st.server.as_ref().map(|s| s.port);
        let mut error = st.error.clone();
        if self.env_disabled && st.cfg.enabled && error.is_none() {
            error = Some("MCP server is disabled by the ORBIT_MCP_DISABLED environment variable.".into());
        }
        McpStatus {
            enabled: st.cfg.enabled && !self.env_disabled,
            running,
            url: port.map(|p| format!("http://127.0.0.1:{p}/mcp")),
            port,
            token: self.token(st),
            error,
        }
    }

    fn stop_locked(st: &mut State) {
        if let Some(s) = st.server.take() {
            s.stop();
        }
    }

    fn start_locked(&self, st: &mut State) {
        Self::stop_locked(st);
        st.error = None;
        if !st.cfg.enabled || self.env_disabled {
            return;
        }
        let cfg = Arc::new(ServerConfig {});
        match start_server(self.first_port, PORT_TRIES, cfg, self.bridge.clone()) {
            Ok(h) => {
                eprintln!("[orbit-mcp] listening on http://127.0.0.1:{}/mcp", h.port);
                st.server = Some(h);
            }
            Err(e) => {
                eprintln!("[orbit-mcp] {e}");
                st.error = Some(e);
            }
        }
    }

    fn finish(&self, st: &State) -> McpStatus {
        let status = self.status_of(st);
        let _ = self.app.emit(STATUS_EVENT, &status);
        status
    }

    pub fn start(&self) -> McpStatus {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.start_locked(&mut st);
        self.finish(&st)
    }

    pub fn status(&self) -> McpStatus {
        let st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        self.status_of(&st)
    }

    pub fn set_enabled(&self, enabled: bool) -> McpStatus {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.cfg.enabled = enabled;
        self.persist(&mut st);
        self.start_locked(&mut st);
        self.finish(&st)
    }

    pub fn regenerate_token(&self) -> Result<McpStatus, String> {
        if self.env_token.is_some() {
            return Err("The token is fixed by the ORBIT_MCP_TOKEN environment variable; unset it to regenerate.".into());
        }
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        st.cfg.token = random_hex(32);
        self.persist(&mut st);
        if st.server.is_some() {
            self.start_locked(&mut st);
        }
        Ok(self.finish(&st))
    }

    pub fn respond(&self, request_id: &str, response: Value) {
        // Late responses (after the 60 s timeout) are ignored.
        let _ = self.bridge.respond(request_id, response);
    }

    pub fn shutdown(&self) {
        let mut st = self.state.lock().unwrap_or_else(|e| e.into_inner());
        Self::stop_locked(&mut st);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    const TOKEN: &str = "secret-token";

    struct Fake {
        calls: Mutex<Vec<(String, Value)>>,
        reply: Result<Value, RpcError>,
    }

    impl Fake {
        fn ok() -> Self {
            Self { calls: Mutex::new(vec![]), reply: Ok(json!({ "tools": [] })) }
        }
    }

    impl Forwarder for Fake {
        fn forward(&self, method: &str, params: Value) -> Result<Value, RpcError> {
            self.calls.lock().unwrap().push((method.to_string(), params));
            self.reply.clone()
        }
    }

    fn cfg() -> ServerConfig {
        ServerConfig {}
    }

    fn req(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> HttpRequest {
        HttpRequest {
            method: method.into(),
            path: path.into(),
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: body.as_bytes().to_vec(),
        }
    }

    fn post(body: &str) -> HttpRequest {
        req("POST", "/mcp", &[("Authorization", &format!("Bearer {TOKEN}"))], body)
    }

    fn call(r: &HttpRequest, f: &Fake) -> HttpResponse {
        handle_request(&cfg(), r, f)
    }

    fn init_body(version: &str) -> String {
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":version,"capabilities":{},"clientInfo":{"name":"t","version":"1"}}}).to_string()
    }

    #[test]
    fn initialize_negotiates_each_version_and_falls_back() {
        let f = Fake::ok();
        for v in ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] {
            let r = call(&post(&init_body(v)), &f);
            assert_eq!(r.status, 200);
            let j = r.body_json().unwrap();
            assert_eq!(j["result"]["protocolVersion"], v);
            assert_eq!(j["id"], 1);
        }
        let r = call(&post(&init_body("1999-01-01")), &f);
        assert_eq!(r.body_json().unwrap()["result"]["protocolVersion"], "2025-06-18");
        let j = r.body_json().unwrap();
        assert_eq!(j["result"]["capabilities"]["tools"]["listChanged"], false);
        assert_eq!(j["result"]["serverInfo"]["name"], "orbit");
        assert_eq!(j["result"]["serverInfo"]["title"], "Orbit");
        assert_eq!(j["result"]["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
        assert!(j["result"]["instructions"].as_str().unwrap().contains("get_status"));
        assert!(r.header("Mcp-Session-Id").is_some_and(|s| s.len() >= 32));
        assert!(f.calls.lock().unwrap().is_empty());
    }

    #[test]
    fn ping_returns_empty_object() {
        let r = call(&post(r#"{"jsonrpc":"2.0","id":"a","method":"ping"}"#), &Fake::ok());
        assert_eq!(r.status, 200);
        assert_eq!(r.header("content-type"), Some("application/json"));
        let j = r.body_json().unwrap();
        assert_eq!(j["result"], json!({}));
        assert_eq!(j["id"], "a");
    }

    #[test]
    fn notifications_and_client_responses_get_202() {
        let f = Fake::ok();
        let r = call(&post(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#), &f);
        assert_eq!((r.status, r.body.len()), (202, 0));
        let r = call(&post(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1}}"#), &f);
        assert_eq!(r.status, 202);
        let r = call(&post(r#"{"jsonrpc":"2.0","id":5,"result":{}}"#), &f);
        assert_eq!(r.status, 202);
    }

    #[test]
    fn batch_is_rejected() {
        let r = call(&post(r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#), &Fake::ok());
        assert_eq!(r.body_json().unwrap()["error"]["code"], -32600);
    }

    #[test]
    fn parse_error() {
        let r = call(&post("{not json"), &Fake::ok());
        let j = r.body_json().unwrap();
        assert_eq!(j["error"]["code"], -32700);
        assert_eq!(j["id"], Value::Null);
    }

    #[test]
    fn unknown_method() {
        let r = call(&post(r#"{"jsonrpc":"2.0","id":3,"method":"resources/list"}"#), &Fake::ok());
        let j = r.body_json().unwrap();
        assert_eq!(j["error"]["code"], -32601);
        assert_eq!(j["id"], 3);
    }

    #[test]
    fn get_and_delete_are_405_wrong_path_404() {
        let auth = [("Authorization", "Bearer secret-token")];
        let f = Fake::ok();
        assert_eq!(call(&req("GET", "/mcp", &auth, ""), &f).status, 405);
        assert_eq!(call(&req("DELETE", "/mcp", &auth, ""), &f).status, 405);
        assert_eq!(call(&req("POST", "/other", &auth, "{}"), &f).status, 404);
        assert_eq!(call(&req("GET", "/", &auth, ""), &f).status, 404);
    }

    #[test]
    fn no_auth_required() {
        let f = Fake::ok();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        assert_eq!(call(&req("POST", "/mcp", &[], body), &f).status, 200);
    }

    #[test]
    fn origin_rules() {
        let f = Fake::ok();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        let with = |o: &str| {
            call(&req("POST", "/mcp", &[("Authorization", "Bearer secret-token"), ("Origin", o)], body), &f)
        };
        for bad in ["http://evil.com", "null", "http://localhost.evil.com", "https://localhost", "http://127.0.0.1:abc", "http://localhost@evil.com"] {
            assert_eq!(with(bad).status, 403, "{bad}");
        }
        for good in ["http://localhost", "http://localhost:1420", "http://127.0.0.1:5173", "tauri://localhost", "http://tauri.localhost"] {
            let r = with(good);
            assert_eq!(r.status, 200, "{good}");
            assert_eq!(r.header("Access-Control-Allow-Origin"), Some(good));
        }
        // Bad origin is rejected before auth, and OPTIONS grants nothing to foreign origins.
        assert_eq!(call(&req("OPTIONS", "/mcp", &[("Origin", "http://evil.com")], ""), &f).status, 403);
        let r = call(&req("OPTIONS", "/mcp", &[("Origin", "http://localhost:1420")], ""), &f);
        assert_eq!(r.status, 204);
        assert_eq!(r.header("Access-Control-Allow-Origin"), Some("http://localhost:1420"));
        let r = call(&req("OPTIONS", "/mcp", &[], ""), &f);
        assert_eq!(r.status, 204);
        assert!(r.header("Access-Control-Allow-Origin").is_none());
    }

    #[test]
    fn protocol_version_header() {
        let f = Fake::ok();
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
        let h = |v: &'static str| {
            call(&req("POST", "/mcp", &[("Authorization", "Bearer secret-token"), ("MCP-Protocol-Version", v)], body), &f).status
        };
        assert_eq!(h("2025-06-18"), 200);
        assert_eq!(h("2024-11-05"), 200);
        assert_eq!(h("2030-01-01"), 400);
    }

    #[test]
    fn body_too_large() {
        let big = " ".repeat(MAX_BODY + 1);
        assert_eq!(call(&post(&big), &Fake::ok()).status, 413);
    }

    #[test]
    fn tools_call_is_forwarded_with_params_intact() {
        let f = Fake { calls: Mutex::new(vec![]), reply: Ok(json!({"content":[{"type":"text","text":"hi"}],"isError":false})) };
        let params = json!({"name":"get_status","arguments":{"a":[1,2,{"b":null}]}});
        let body = json!({"jsonrpc":"2.0","id":9,"method":"tools/call","params":params}).to_string();
        let r = call(&post(&body), &f);
        assert_eq!(r.status, 200);
        let j = r.body_json().unwrap();
        assert_eq!(j["id"], 9);
        assert_eq!(j["result"]["content"][0]["text"], "hi");
        let calls = f.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "tools/call");
        assert_eq!(calls[0].1, params);

        // tools/list without params forwards an empty object.
        drop(calls);
        call(&post(r#"{"jsonrpc":"2.0","id":10,"method":"tools/list"}"#), &f);
        assert_eq!(f.calls.lock().unwrap()[1], ("tools/list".to_string(), json!({})));
    }

    #[test]
    fn forwarder_errors_become_json_rpc_errors() {
        let f = Fake {
            calls: Mutex::new(vec![]),
            reply: Err(RpcError { code: -32602, message: "Unknown tool".into(), data: Some(json!({"x":1})) }),
        };
        let r = call(&post(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nope"}}"#), &f);
        let j = r.body_json().unwrap();
        assert_eq!(j["error"]["code"], -32602);
        assert_eq!(j["error"]["data"]["x"], 1);
    }

    #[test]
    fn bridge_timeout_yields_32001_via_http_layer() {
        let bridge = Bridge::new(Box::new(|_| Ok(())), Duration::from_millis(50));
        let r = handle_request(
            &cfg(),
            &post(r#"{"jsonrpc":"2.0","id":4,"method":"tools/list"}"#),
            &bridge,
        );
        let j = r.body_json().unwrap();
        assert_eq!(j["error"]["code"], -32001);
        assert_eq!(j["error"]["message"], "Orbit UI did not respond (is a window open?)");
        assert!(bridge.pending.lock().unwrap().is_empty());
        // A late response is ignored.
        assert!(!bridge.respond("whatever", json!({"result":{}})));
    }

    #[test]
    fn bridge_round_trip_translates_result_and_error() {
        let (tx, rx) = mpsc::channel::<BridgeRequest>();
        let tx = Mutex::new(tx);
        let bridge = Arc::new(Bridge::new(
            Box::new(move |r| tx.lock().unwrap().send(r.clone()).map_err(|e| e.to_string())),
            Duration::from_secs(5),
        ));
        let b2 = bridge.clone();
        let ui = std::thread::spawn(move || {
            let r = rx.recv().unwrap();
            assert_eq!(r.method, "tools/call");
            assert_eq!(r.params["name"], "x");
            let v = serde_json::to_value(&r).unwrap();
            assert!(v.get("requestId").is_some());
            assert!(b2.respond(&r.request_id, json!({"result":{"ok":true}})));
            let r = rx.recv().unwrap();
            assert!(b2.respond(&r.request_id, json!({"error":{"code":-32602,"message":"bad"}})));
            let r = rx.recv().unwrap();
            assert!(b2.respond(&r.request_id, json!({"nonsense":1})));
        });
        assert_eq!(bridge.forward("tools/call", json!({"name":"x"})).unwrap(), json!({"ok":true}));
        let e = bridge.forward("tools/call", json!({})).unwrap_err();
        assert_eq!((e.code, e.message.as_str()), (-32602, "bad"));
        assert_eq!(bridge.forward("tools/list", json!({})).unwrap_err().code, -32603);
        ui.join().unwrap();
    }

    fn raw_http(port: u16, request: &str) -> String {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(request.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    fn post_raw(port: u16, token: Option<&str>, body: &str) -> String {
        let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        raw_http(
            port,
            &format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{auth}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            ),
        )
    }

    #[test]
    fn real_socket_round_trip() {
        let fake = Arc::new(Fake { calls: Mutex::new(vec![]), reply: Ok(json!({"tools":[{"name":"get_status"}]})) });
        let handle = start_server(0, 1, Arc::new(cfg()), fake.clone()).unwrap();
        let port = handle.port;
        assert_ne!(port, 0);

        let out = post_raw(port, Some(TOKEN), r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");
        assert!(out.to_ascii_lowercase().contains("content-type: application/json"));
        let body = out.split("\r\n\r\n").nth(1).unwrap();
        let j: Value = serde_json::from_str(body).unwrap();
        assert_eq!(j["result"]["tools"][0]["name"], "get_status");

        let out = post_raw(port, None, r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#);
        assert!(out.starts_with("HTTP/1.1 200"), "{out}");

        let out = post_raw(port, Some(TOKEN), r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert!(out.starts_with("HTTP/1.1 202"), "{out}");

        let out = raw_http(port, &format!("GET /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"));
        assert!(out.starts_with("HTTP/1.1 405"), "{out}");

        // Oversized Content-Length is rejected without reading the body.
        let out = raw_http(
            port,
            &format!("POST /mcp HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer {TOKEN}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", MAX_BODY + 10),
        );
        assert!(out.starts_with("HTTP/1.1 413"), "{out}");

        handle.stop();
        // Tests run in parallel and the OS may hand this ephemeral port to another test's server straight away,
        // so "stopped" means this server's answer is gone, not that nothing listens on the port.
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            let out = post_raw(port, Some(TOKEN), r#"{"jsonrpc":"2.0","id":9,"method":"tools/list"}"#);
            assert!(!out.contains("get_status"), "the stopped server still answered: {out}");
        }
    }

    #[test]
    fn port_fallback_when_busy() {
        let fake: Arc<dyn Forwarder> = Arc::new(Fake::ok());
        let a = start_server(0, 1, Arc::new(cfg()), fake.clone()).unwrap();
        // Ask for the busy port with 3 tries: must land on a later port or fail with an actionable error.
        match start_server(a.port, 3, Arc::new(cfg()), fake) {
            Ok(b) => assert!(b.port > a.port && b.port < a.port + 3),
            Err(e) => assert!(e.contains("ORBIT_MCP_PORT")),
        }
    }
}
