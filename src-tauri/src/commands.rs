use crate::core::dispatcher::{self, PlatformDispatchRequest};
use crate::core::history::{self, HistoryEntry};
use crate::core::platform::{FieldKind, MediaAttachment, PlatformMetadata, PostOutcome};
use crate::core::profiles::{self, ProfileInfo, ProfileSessionState};
use crate::core::{registry, vault};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

fn new_history_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}")
}

fn now_iso8601_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };

    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[tauri::command]
pub async fn list_profiles(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
) -> Result<Vec<ProfileInfo>, String> {
    profiles::list_profiles(&app, &state)
}

#[tauri::command]
pub async fn create_profile(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    name: String,
    password: Option<String>,
) -> Result<ProfileInfo, String> {
    profiles::create_profile(&app, &state, &name, password.as_deref())
}

#[tauri::command]
pub async fn rename_profile(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    name: String,
) -> Result<ProfileInfo, String> {
    profiles::rename_profile(&app, &state, &profile_id, &name)
}

#[tauri::command]
pub async fn unlock_profile(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    password: String,
) -> Result<bool, String> {
    profiles::unlock_profile(&app, &state, &profile_id, &password)
}

#[tauri::command]
pub async fn lock_profile(
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<(), String> {
    profiles::lock_profile(&state, &profile_id);
    Ok(())
}

#[tauri::command]
pub async fn set_profile_password(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    current_password: Option<String>,
    new_password: Option<String>,
) -> Result<ProfileInfo, String> {
    profiles::set_profile_password(
        &app,
        &state,
        &profile_id,
        current_password.as_deref(),
        new_password.as_deref(),
    )
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<(), String> {
    profiles::delete_profile(&app, &state, &profile_id)
}

#[tauri::command]
pub async fn get_platforms(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<Vec<PlatformMetadata>, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    tokio::task::spawn_blocking(move || {
        registry::all_platforms()
            .into_iter()
            .map(|platform| {
                let auth_modes = platform.auth_modes();
                let active_mode =
                    vault::get_active_auth_mode(&profile_id, platform.id(), &auth_modes);
                let is_configured =
                    vault::is_platform_configured(&profile_id, platform.id(), &auth_modes);
                registry::to_metadata(&*platform, is_configured, active_mode)
            })
            .collect()
    })
    .await
    .map_err(|err| format!("Failed to collect platform metadata: {err}"))
}

#[tauri::command]
pub async fn save_credentials(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    platform_id: String,
    mode_id: String,
    values: HashMap<String, String>,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    tokio::task::spawn_blocking(move || {
        let platform = registry::find_platform(&platform_id)
            .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

        let auth_modes = platform.auth_modes();
        let mode = auth_modes
            .iter()
            .find(|m| m.id == mode_id)
            .ok_or_else(|| format!("Unknown authentication mode '{mode_id}'."))?;

        vault::save_secret(&profile_id, platform.id(), vault::AUTH_MODE_KEY, mode.id)?;

        for field in &mode.fields {
            if matches!(field.kind, FieldKind::OAuthButton { .. }) {
                continue;
            }
            if let Some(value) = values.get(field.key) {
                if value.trim().is_empty() {
                    vault::delete_secret(&profile_id, platform.id(), field.key)?;
                } else {
                    vault::save_secret(&profile_id, platform.id(), field.key, value)?;
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to save credentials: {err}"))?
}

#[tauri::command]
pub async fn verify_platform(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    platform_id: String,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    let platform = registry::find_platform(&platform_id)
        .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

    let auth_modes = platform.auth_modes();
    let id = platform.id().to_string();

    let creds = tokio::task::spawn_blocking(move || {
        vault::load_platform_credentials(&profile_id, &id, &auth_modes)
    })
    .await
    .map_err(|err| format!("Failed to load credentials: {err}"))??;

    platform.verify_credentials(&creds).await
}

#[tauri::command]
pub async fn unlink_platform(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    platform_id: String,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    tokio::task::spawn_blocking(move || {
        let platform = registry::find_platform(&platform_id)
            .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

        vault::wipe_profile_platform_secrets(&profile_id, platform.id(), &platform.auth_modes())
    })
    .await
    .map_err(|err| format!("Failed to unlink platform: {err}"))?
}

#[tauri::command]
pub async fn start_platform_oauth(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    platform_id: String,
    mode_id: String,
    inputs: HashMap<String, String>,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    let platform = registry::find_platform(&platform_id)
        .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

    if !platform.auth_modes().iter().any(|m| m.id == mode_id) {
        return Err(format!("Unknown authentication mode '{mode_id}'."));
    }

    let tokens = platform.start_oauth(&mode_id, &inputs).await?;
    let id = platform.id().to_string();

    tokio::task::spawn_blocking(move || {
        vault::save_secret(&profile_id, &id, vault::AUTH_MODE_KEY, &mode_id)?;
        for (key, value) in tokens {
            if value.trim().is_empty() {
                vault::delete_secret(&profile_id, &id, &key)?;
            } else {
                vault::save_secret(&profile_id, &id, &key, &value)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to store OAuth credentials: {err}"))?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn broadcast_post(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    targets: Vec<PlatformDispatchRequest>,
    master_text: String,
    overrides: HashMap<String, String>,
    media: Vec<MediaAttachment>,
    auto_thread: Option<bool>,
) -> Result<Vec<PostOutcome>, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    let outcomes =
        dispatcher::dispatch_all(&profile_id, targets, auto_thread.unwrap_or(false)).await;

    let entry = HistoryEntry {
        id: new_history_id(),
        created_at: now_iso8601_utc(),
        master_text,
        overrides,
        media,
        outcomes: outcomes.clone(),
    };
    let _ = history::append_history(&app, &profile_id, entry);

    Ok(outcomes)
}

#[tauri::command]
pub async fn get_history(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<Vec<HistoryEntry>, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;
    history::load_history(&app, &profile_id)
}

#[tauri::command]
pub async fn clear_history(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;
    history::clear_history(&app, &profile_id)
}
