use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

const FILE: &str = "orbit-file";
const RECENT: &str = "orbit-file-recent";
const ACTION_PREFIX: &str = "orbit-file:";
pub const EVENT: &str = "orbit:file-menu";

pub fn action(id: &str) -> Option<&str> {
    id.strip_prefix(ACTION_PREFIX)
}

fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    enabled: bool,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, format!("{ACTION_PREFIX}{id}"), text, enabled, accelerator)
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::default(app)?;
    let file = Submenu::with_id(app, FILE, "File", true)?;
    let recent = Submenu::with_id(app, RECENT, "Recent Files", true)?;
    recent.append(&item(app, "empty-recent", "No recent files", false, None)?)?;
    // On Windows and Linux, Ctrl shortcuts stay in the webview so the embedded terminal
    // can receive them while it has focus.
    let shortcut = |key| cfg!(target_os = "macos").then_some(key);
    let items = menu.items()?;
    let existing = items.iter().enumerate().find_map(|(index, item)| {
        let submenu = item.as_submenu()?;
        (submenu.text().ok()?.replace('&', "") == "File").then_some((index, submenu))
    });

    file.append_items(&[
        &item(app, "new", "New…", true, None)?,
        &item(app, "open", "Open…", true, shortcut("Cmd+O"))?,
        &recent,
        &PredefinedMenuItem::separator(app)?,
        &item(app, "save", "Save", false, shortcut("Cmd+S"))?,
        &item(app, "save-as", "Save As…", false, shortcut("Cmd+Shift+S"))?,
        &item(app, "reload", "Reload from Disk", false, None)?,
        &PredefinedMenuItem::separator(app)?,
        &item(app, "product-settings", "Product Settings…", false, None)?,
        &item(app, "skills", "Install/Update Skills…", false, None)?,
        &item(app, "shortcuts", "Keyboard Shortcuts", true, None)?,
    ])?;
    if let Some((index, original)) = existing {
        file.append(&PredefinedMenuItem::separator(app)?)?;
        for entry in original.items()? {
            original.remove(&entry)?;
            file.append(&entry)?;
        }
        menu.remove(original)?;
        menu.insert(&file, index)?;
    } else {
        menu.prepend(&file)?;
    }
    Ok(menu)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMenuState {
    has_file: bool,
    dirty: bool,
    has_contract: bool,
    skills_available: bool,
    recent: Vec<String>,
}

#[tauri::command]
pub fn update_file_menu(app: AppHandle, state: FileMenuState) -> Result<(), String> {
    update(&app, state).map_err(|err| err.to_string())
}

fn update(app: &AppHandle, state: FileMenuState) -> tauri::Result<()> {
    let Some(file) = app.menu().and_then(|menu| menu.get(FILE)) else {
        return Ok(());
    };
    let file = file.as_submenu_unchecked();
    for (id, enabled) in [
        ("save", state.has_file && state.dirty),
        ("save-as", state.has_file),
        ("reload", state.has_file),
        ("product-settings", state.has_contract),
        ("skills", state.has_file && state.skills_available),
    ] {
        if let Some(entry) = file.get(&format!("{ACTION_PREFIX}{id}")) {
            entry.as_menuitem_unchecked().set_enabled(enabled)?;
        }
    }

    let Some(recent) = file.get(RECENT) else {
        return Ok(());
    };
    let recent = recent.as_submenu_unchecked();
    let current = recent.items()?;
    if current
        .iter()
        .filter_map(|entry| action(entry.id().as_ref())?.strip_prefix("recent:"))
        .eq(state.recent.iter().map(String::as_str))
    {
        return Ok(());
    }
    for entry in current {
        recent.remove(&entry)?;
    }
    for path in &state.recent {
        let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
        recent.append(&item(
            app,
            &format!("recent:{path}"),
            &format!("{name} — {path}").replace('&', "&&"),
            true,
            None,
        )?)?;
    }
    if state.recent.is_empty() {
        recent.append(&item(app, "empty-recent", "No recent files", false, None)?)?;
    }
    Ok(())
}
