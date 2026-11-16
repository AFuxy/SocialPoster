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

    save_history(app, profile_id, &entries)
}

pub fn save_history(
    app: &AppHandle,
    profile_id: &str,
    entries: &[HistoryEntry],
) -> Result<(), String> {
    let path = history_file_path(app, profile_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create profile history directory: {err}"))?;
    }
    let json = serde_json::to_string_pretty(entries)
        .map_err(|err| format!("Failed to serialise profile history: {err}"))?;
    fs::write(&path, json).map_err(|err| format!("Failed to write profile history: {err}"))
}

pub fn outcome_post_ids(outcome: &PostOutcome) -> Vec<String> {
    if !outcome.post_ids.is_empty() {
        outcome.post_ids.clone()
    } else {
        outcome.post_id.iter().cloned().collect()
    }
}

pub fn clear_history(app: &AppHandle, profile_id: &str) -> Result<(), String> {
    let path = history_file_path(app, profile_id)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|err| format!("Failed to delete profile history: {err}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialises_legacy_history_entry_without_recall_fields() {
        let legacy_json = r#"{
            "id": "h1",
            "createdAt": "2026-01-01T00:00:00Z",
            "masterText": "Hello world",
            "overrides": {},
            "media": [],
            "outcomes": [
                {
                    "platformId": "bluesky",
                    "platformName": "Bluesky",
                    "success": true,
                    "postId": "at://did:plc:abc/app.bsky.feed.post/123|bafy",
                    "postUrl": "https://bsky.app/profile/test/post/123",
                    "error": null
                }
            ]
        }"#;

        let entry: HistoryEntry =
            serde_json::from_str(legacy_json).expect("deserialises legacy history entry");
        assert_eq!(entry.outcomes.len(), 1);
        let outcome = &entry.outcomes[0];
        assert!(outcome.post_ids.is_empty());
        assert!(!outcome.recalled);
        assert!(outcome.recalled_at.is_none());
        assert!(outcome.recall_error.is_none());
        assert_eq!(
            outcome_post_ids(outcome),
            vec!["at://did:plc:abc/app.bsky.feed.post/123|bafy".to_string()]
        );
    }

    #[test]
    fn resolves_thread_post_ids_in_reverse_order() {
        let outcome = PostOutcome {
            platform_id: "twitter".to_string(),
            platform_name: "X (Twitter)".to_string(),
            success: true,
            post_id: Some("root-1".to_string()),
            post_ids: vec![
                "root-1".to_string(),
                "reply-2".to_string(),
                "reply-3".to_string(),
            ],
            ..Default::default()
        };

        let resolved = outcome_post_ids(&outcome);
        let delete_order: Vec<&str> = resolved.iter().rev().map(String::as_str).collect();
        assert_eq!(delete_order, vec!["reply-3", "reply-2", "root-1"]);
    }
}
