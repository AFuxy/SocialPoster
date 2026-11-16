use crate::core::dispatcher::{self, PlatformDispatchRequest};
use crate::core::platform::{FieldKind, PlatformMetadata, PostOutcome};
use crate::core::{registry, vault};
use std::collections::{HashMap, HashSet};

#[tauri::command]
pub async fn get_platforms() -> Result<Vec<PlatformMetadata>, String> {
    tokio::task::spawn_blocking(|| {
        registry::all_platforms()
            .into_iter()
            .map(|platform| {
                let auth_modes = platform.auth_modes();
                let active_mode = vault::get_active_auth_mode(platform.id(), &auth_modes);
                let is_configured = vault::is_platform_configured(platform.id(), &auth_modes);
                registry::to_metadata(&*platform, is_configured, active_mode)
            })
            .collect()
    })
    .await
    .map_err(|err| format!("Failed to collect platform metadata: {err}"))
}

#[tauri::command]
pub async fn save_credentials(
    platform_id: String,
    mode_id: String,
    values: HashMap<String, String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let platform = registry::find_platform(&platform_id)
            .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

        let auth_modes = platform.auth_modes();
        let mode = auth_modes
            .iter()
            .find(|m| m.id == mode_id)
            .ok_or_else(|| format!("Unknown authentication mode '{mode_id}'."))?;

        vault::save_secret(platform.id(), vault::AUTH_MODE_KEY, mode.id)?;

        for field in &mode.fields {
            if matches!(field.kind, FieldKind::OAuthButton { .. }) {
                continue;
            }
            if let Some(value) = values.get(field.key) {
                if value.trim().is_empty() {
                    vault::delete_secret(platform.id(), field.key)?;
                } else {
                    vault::save_secret(platform.id(), field.key, value)?;
                }
            }
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to save credentials: {err}"))?
}

#[tauri::command]
pub async fn verify_platform(platform_id: String) -> Result<(), String> {
    let platform = registry::find_platform(&platform_id)
        .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

    let auth_modes = platform.auth_modes();
    let id = platform.id().to_string();

    let creds =
        tokio::task::spawn_blocking(move || vault::load_platform_credentials(&id, &auth_modes))
            .await
            .map_err(|err| format!("Failed to load credentials: {err}"))??;

    platform.verify_credentials(&creds).await
}

#[tauri::command]
pub async fn unlink_platform(platform_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let platform = registry::find_platform(&platform_id)
            .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

        let mut keys: HashSet<String> = HashSet::new();
        keys.insert(vault::AUTH_MODE_KEY.to_string());
        for reserved in vault::OAUTH_RESERVED_KEYS {
            keys.insert(reserved.to_string());
        }
        for mode in platform.auth_modes() {
            for field in mode.fields {
                keys.insert(field.key.to_string());
            }
        }

        for key in keys {
            vault::delete_secret(platform.id(), &key)?;
        }

        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to unlink platform: {err}"))?
}

#[tauri::command]
pub async fn start_platform_oauth(
    platform_id: String,
    mode_id: String,
    inputs: HashMap<String, String>,
) -> Result<(), String> {
    let platform = registry::find_platform(&platform_id)
        .ok_or_else(|| format!("Unknown platform '{platform_id}'."))?;

    if !platform.auth_modes().iter().any(|m| m.id == mode_id) {
        return Err(format!("Unknown authentication mode '{mode_id}'."));
    }

    let tokens = platform.start_oauth(&mode_id, &inputs).await?;
    let id = platform.id().to_string();

    tokio::task::spawn_blocking(move || {
        vault::save_secret(&id, vault::AUTH_MODE_KEY, &mode_id)?;
        for (key, value) in tokens {
            if value.trim().is_empty() {
                vault::delete_secret(&id, &key)?;
            } else {
                vault::save_secret(&id, &key, &value)?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("Failed to store OAuth credentials: {err}"))?
}

#[tauri::command]
pub async fn broadcast_post(
    targets: Vec<PlatformDispatchRequest>,
) -> Result<Vec<PostOutcome>, String> {
    Ok(dispatcher::dispatch_all(targets).await)
}
