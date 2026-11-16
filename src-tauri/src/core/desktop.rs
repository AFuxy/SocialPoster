use crate::core::profiles;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSettings {
    pub minimize_to_tray: bool,
    pub global_shortcut: Option<String>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: true,
            global_shortcut: Some("CommandOrControl+Shift+Space".to_string()),
        }
    }
}

pub struct DesktopSettingsState(pub Mutex<DesktopSettings>);

impl Default for DesktopSettingsState {
    fn default() -> Self {
        Self(Mutex::new(DesktopSettings::default()))
    }
}

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(profiles::app_data_dir(app)?.join("desktop_settings.json"))
}

pub fn load_settings(app: &AppHandle) -> DesktopSettings {
    let Ok(path) = settings_file_path(app) else {
        return DesktopSettings::default();
    };
    if !path.is_file() {
        return DesktopSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<DesktopSettings>(&raw).ok())
        .unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &DesktopSettings) -> Result<(), String> {
    let path = settings_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create app data directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(settings)
        .map_err(|err| format!("Failed to serialise desktop settings: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("Failed to write desktop_settings.json: {err}"))
}

pub fn show_and_focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("focus-composer", ());
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            show_and_focus_main_window(app);
        }
    }
}

pub const MAIN_TRAY_ID: &str = "main-tray";

pub fn update_tray_tooltip(app: &AppHandle, pending_count: usize) {
    let tooltip = if pending_count == 0 {
        "SocialPoster".to_string()
    } else {
        format!("SocialPoster — {pending_count} scheduled")
    };
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, "show", "Show SocialPoster", true, None::<&str>)
        .map_err(|err| format!("Failed to create tray menu item: {err}"))?;
    let quick_item = MenuItem::with_id(app, "quick_compose", "Quick Compose", true, None::<&str>)
        .map_err(|err| format!("Failed to create tray menu item: {err}"))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|err| format!("Failed to create tray menu item: {err}"))?;

    let menu = Menu::with_items(app, &[&show_item, &quick_item, &quit_item])
        .map_err(|err| format!("Failed to build tray menu: {err}"))?;

    let mut builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("SocialPoster")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" | "quick_compose" => show_and_focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder
        .build(app)
        .map_err(|err| format!("Failed to build system tray icon: {err}"))?;

    Ok(())
}

pub fn apply_global_shortcut(app: &AppHandle, shortcut: Option<&str>) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if let Some(raw) = shortcut.map(str::trim).filter(|s| !s.is_empty()) {
        gs.on_shortcut(raw, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main_window(app);
            }
        })
        .map_err(|err| format!("Failed to register global shortcut '{raw}': {err}"))?;
    }

    Ok(())
}
