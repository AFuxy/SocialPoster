use crate::core::desktop::{self, DesktopSettings, DesktopSettingsState};
use crate::core::dispatcher::{self, PlatformDispatchRequest};
use crate::core::history::{self, HistoryEntry};
use crate::core::platform::{FieldKind, MediaAttachment, PlatformMetadata, PostOutcome};
use crate::core::profiles::{self, ProfileInfo, ProfileSessionState};
use crate::core::scheduler::{self, ScheduledPost, ScheduledPostsResponse};
use crate::core::{registry, vault};
use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

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

#[tauri::command]
pub async fn get_desktop_settings(
    state: State<'_, DesktopSettingsState>,
) -> Result<DesktopSettings, String> {
    state
        .0
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "Desktop settings lock poisoned.".to_string())
}

#[tauri::command]
pub async fn update_desktop_settings(
    app: AppHandle,
    state: State<'_, DesktopSettingsState>,
    settings: DesktopSettings,
) -> Result<DesktopSettings, String> {
    let normalized = DesktopSettings {
        minimize_to_tray: settings.minimize_to_tray,
        global_shortcut: settings
            .global_shortcut
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
    };

    desktop::apply_global_shortcut(&app, normalized.global_shortcut.as_deref())?;
    desktop::save_settings(&app, &normalized)?;

    if let Ok(mut guard) = state.0.lock() {
        *guard = normalized.clone();
    }

    Ok(normalized)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn schedule_post(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    scheduled_for: String,
    text: String,
    overrides: HashMap<String, String>,
    media: Vec<MediaAttachment>,
    platform_ids: Vec<String>,
    auto_thread: Option<bool>,
) -> Result<ScheduledPost, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;

    let parsed_time = DateTime::parse_from_rfc3339(&scheduled_for)
        .map_err(|_| "Invalid scheduled time format.".to_string())?
        .with_timezone(&Utc);
    if parsed_time <= Utc::now() {
        return Err("Scheduled time must be in the future.".to_string());
    }

    if platform_ids.is_empty() {
        return Err("Select at least one platform to schedule.".to_string());
    }

    let use_auto_thread = auto_thread.unwrap_or(false);
    for pid in &platform_ids {
        let platform =
            registry::find_platform(pid).ok_or_else(|| format!("Unknown platform '{pid}'."))?;
        let caps = platform.capabilities();
        let resolved_text = overrides.get(pid).map(String::as_str).unwrap_or(&text);

        if resolved_text.trim().is_empty() && media.is_empty() {
            return Err("Post cannot be empty.".to_string());
        }
        if caps.requires_media && media.is_empty() {
            return Err(format!("{} requires media.", platform.name()));
        }
        if resolved_text.chars().count() > caps.max_chars
            && !(use_auto_thread && caps.supports_threads)
        {
            return Err(format!(
                "{} exceeds the {} character limit.",
                platform.name(),
                caps.max_chars
            ));
        }
    }

    let normalized_time = parsed_time.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let job = scheduler::add_scheduled_job(
        &app,
        &profile_id,
        normalized_time,
        text,
        overrides,
        &media,
        platform_ids,
        use_auto_thread,
    )?;
    let _ = app.emit("schedule-updated", ());
    Ok(job)
}

#[tauri::command]
pub async fn list_scheduled_posts(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
) -> Result<ScheduledPostsResponse, String> {
    let profiles = profiles::ensure_initialized(&app)?;
    let profile = profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| format!("Unknown profile '{profile_id}'."))?;

    if !state.is_unlocked(profile) {
        return Ok(ScheduledPostsResponse {
            is_locked: true,
            posts: Vec::new(),
        });
    }

    let posts = scheduler::list_jobs(&app, &profile_id)?;
    Ok(ScheduledPostsResponse {
        is_locked: false,
        posts,
    })
}

#[tauri::command]
pub async fn cancel_scheduled_post(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    job_id: String,
) -> Result<(), String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;
    scheduler::cancel_job(&app, &profile_id, &job_id)
}

#[tauri::command]
pub async fn publish_scheduled_now(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    job_id: String,
) -> Result<Vec<PostOutcome>, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;
    scheduler::execute_scheduled_job(&app, &profile_id, &job_id).await
}

#[tauri::command]
pub async fn retry_scheduled_post(
    app: AppHandle,
    state: State<'_, ProfileSessionState>,
    profile_id: String,
    job_id: String,
) -> Result<ScheduledPost, String> {
    profiles::ensure_profile_unlocked(&app, &state, &profile_id)?;
    scheduler::retry_job(&app, &profile_id, &job_id)
}
