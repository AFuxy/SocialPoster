use crate::core::platform::{MediaAttachment, PostOutcome};
use crate::core::profiles;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

const MAX_HISTORY_ENTRIES: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub created_at: String,
    pub master_text: String,
    pub overrides: HashMap<String, String>,
    pub media: Vec<MediaAttachment>,
    pub outcomes: Vec<PostOutcome>,
}

fn history_file_path(app: &AppHandle, profile_id: &str) -> Result<PathBuf, String> {
    Ok(profiles::profile_dir(app, profile_id)?.join("history.json"))
}

pub fn load_history(app: &AppHandle, profile_id: &str) -> Result<Vec<HistoryEntry>, String> {
    let path = history_file_path(app, profile_id)?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|err| format!("Failed to read profile history: {err}"))?;
    let mut entries: Vec<HistoryEntry> = serde_json::from_str(&raw)
        .map_err(|err| format!("Failed to parse profile history: {err}"))?;
    entries.truncate(MAX_HISTORY_ENTRIES);
    Ok(entries)
}

pub fn append_history(
    app: &AppHandle,
    profile_id: &str,
    entry: HistoryEntry,
) -> Result<(), String> {
    let path = history_file_path(app, profile_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create profile history directory: {err}"))?;
    }
    let mut entries = load_history(app, profile_id)?;
    entries.insert(0, entry);
    entries.truncate(MAX_HISTORY_ENTRIES);

    let json = serde_json::to_string_pretty(&entries)
        .map_err(|err| format!("Failed to serialise profile history: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("Failed to write profile history: {err}"))
}

pub fn clear_history(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let path = history_file_path(app, profile_id)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|err| format!("Failed to delete profile history: {err}"))?;
    }
    Ok(())
}
