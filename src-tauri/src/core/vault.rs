use crate::core::platform::{AuthMode, FieldKind};
use keyring::{Entry, Error as KeyringError};
use std::collections::{HashMap, HashSet};

const KEYRING_SERVICE: &str = "universal-poster";
pub const AUTH_MODE_KEY: &str = "__auth_mode";
pub const OAUTH_RESERVED_KEYS: [&str; 3] = ["access_token", "refresh_token", "expires_at"];

fn entry_for(platform_id: &str, key: &str) -> Result<Entry, String> {
    let user = format!("{platform_id}:{key}");
    Entry::new(KEYRING_SERVICE, &user)
        .map_err(|err| format!("Failed to initialise keyring entry for '{user}': {err}"))
}

/// Persists a secret value in the OS keyring under service `"universal-poster"`.
pub fn save_secret(platform_id: &str, key: &str, value: &str) -> Result<(), String> {
    let entry = entry_for(platform_id, key)?;
    entry
        .set_password(value)
        .map_err(|err| format!("Failed to save credential '{platform_id}:{key}': {err}"))
}

/// Reads a secret value from the OS keyring, returning `Ok(None)` if not present.
pub fn get_secret(platform_id: &str, key: &str) -> Result<Option<String>, String> {
    let entry = entry_for(platform_id, key)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!(
            "Failed to read credential '{platform_id}:{key}': {err}"
        )),
    }
}

/// Deletes a secret value from the OS keyring. Absent entries succeed idempotently.
pub fn delete_secret(platform_id: &str, key: &str) -> Result<(), String> {
    let entry = entry_for(platform_id, key)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!(
            "Failed to delete credential '{platform_id}:{key}': {err}"
        )),
    }
}

fn has_non_empty_secret(platform_id: &str, key: &str) -> bool {
    matches!(
        get_secret(platform_id, key),
        Ok(Some(val)) if !val.trim().is_empty()
    )
}

/// Returns the active authentication mode ID stored in the keyring, falling back
/// to the first mode declared by the platform.
pub fn get_active_auth_mode(platform_id: &str, auth_modes: &[AuthMode]) -> Option<String> {
    if let Ok(Some(stored)) = get_secret(platform_id, AUTH_MODE_KEY)
        && auth_modes.iter().any(|mode| mode.id == stored)
    {
        return Some(stored);
    }
    auth_modes.first().map(|mode| mode.id.to_string())
}

/// Returns `true` if every `required` field in the active `AuthMode` has a non-empty
/// entry in the keyring (excluding `OAuthButton` trigger fields unless a token key is stored).
pub fn is_platform_configured(platform_id: &str, auth_modes: &[AuthMode]) -> bool {
    let Some(active_id) = get_active_auth_mode(platform_id, auth_modes) else {
        return false;
    };
    let Some(active_mode) = auth_modes.iter().find(|mode| mode.id == active_id) else {
        return false;
    };

    active_mode
        .fields
        .iter()
        .filter(|field| field.required)
        .all(|field| match field.kind {
            FieldKind::OAuthButton { target_key, .. } => {
                has_non_empty_secret(platform_id, target_key)
                    || has_non_empty_secret(platform_id, field.key)
            }
            _ => has_non_empty_secret(platform_id, field.key),
        })
}

/// Loads all non-empty stored credentials (including `__auth_mode` and OAuth tokens)
/// across all `AuthMode`s declared by the platform.
pub fn load_platform_credentials(
    platform_id: &str,
    auth_modes: &[AuthMode],
) -> Result<HashMap<String, String>, String> {
    let mut keys: HashSet<&str> = HashSet::new();
    keys.insert(AUTH_MODE_KEY);
    for key in OAUTH_RESERVED_KEYS {
        keys.insert(key);
    }
    for mode in auth_modes {
        for field in &mode.fields {
            keys.insert(field.key);
        }
    }

    let mut creds = HashMap::new();
    for key in keys {
        if let Some(value) = get_secret(platform_id, key)?
            && !value.trim().is_empty()
        {
            creds.insert(key.to_string(), value);
        }
    }
    Ok(creds)
}
