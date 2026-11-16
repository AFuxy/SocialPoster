use crate::core::history::HistoryEntry;
use crate::core::profiles::ProfileInfo;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use chrono::Utc;
use rand::RngCore;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const BACKUP_FORMAT: &str = "socialposter-backup";
pub const BACKUP_VERSION: u32 = 1;
pub const BACKUP_ITERATIONS: u32 = 200_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedBackupEnvelope {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub profile_name: String,
    pub iterations: u32,
    pub salt_b64: String,
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupPayload {
    pub profile_name: String,
    pub credentials: HashMap<String, HashMap<String, String>>,
    pub history: Vec<HistoryEntry>,
    pub frontend_state: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub profile_name: String,
    pub exported_at: String,
    pub version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedProfileResponse {
    pub profile: ProfileInfo,
    pub frontend_state: HashMap<String, String>,
    pub restored_platforms_count: usize,
    pub restored_history_count: usize,
}

fn derive_key(salt: &[u8], passphrase: &str, iterations: u32) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(passphrase.as_bytes());
    let mut digest: [u8; 32] = hasher.finalize().into();

    for _ in 1..iterations {
        digest = Sha256::digest(digest).into();
    }
    digest
}

pub fn encrypt_payload(
    payload: &BackupPayload,
    passphrase: &str,
) -> Result<EncryptedBackupEnvelope, String> {
    if passphrase.trim().len() < 8 {
        return Err("Passphrase must be at least 8 characters.".to_string());
    }

    let plaintext = serde_json::to_vec(payload)
        .map_err(|err| format!("Failed to serialise backup payload: {err}"))?;

    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_key(&salt, passphrase, BACKUP_ITERATIONS);
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialise backup cipher: {err}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|err| format!("Failed to encrypt backup payload: {err}"))?;

    Ok(EncryptedBackupEnvelope {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        exported_at: Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        profile_name: payload.profile_name.clone(),
        iterations: BACKUP_ITERATIONS,
        salt_b64: STANDARD.encode(salt),
        nonce_b64: STANDARD.encode(nonce_bytes),
        ciphertext_b64: STANDARD.encode(ciphertext),
    })
}

pub fn parse_and_validate_envelope(raw: &str) -> Result<EncryptedBackupEnvelope, String> {
    let envelope: EncryptedBackupEnvelope = serde_json::from_str(raw)
        .map_err(|_| "Selected file is not a valid SocialPoster backup.".to_string())?;

    if envelope.format != BACKUP_FORMAT {
        return Err(format!("Unsupported backup format '{}'.", envelope.format));
    }
    if envelope.version != BACKUP_VERSION {
        return Err(format!(
            "Unsupported backup version '{}'.",
            envelope.version
        ));
    }
    if envelope.iterations == 0 {
        return Err("Backup archive has invalid key derivation settings.".to_string());
    }

    Ok(envelope)
}

pub fn inspect_envelope(raw: &str) -> Result<BackupMetadata, String> {
    let envelope = parse_and_validate_envelope(raw)?;
    Ok(BackupMetadata {
        profile_name: envelope.profile_name,
        exported_at: envelope.exported_at,
        version: envelope.version,
    })
}

pub fn decrypt_envelope(
    envelope: &EncryptedBackupEnvelope,
    passphrase: &str,
) -> Result<BackupPayload, String> {
    if passphrase.is_empty() {
        return Err("Passphrase is required.".to_string());
    }

    let salt = STANDARD
        .decode(&envelope.salt_b64)
        .map_err(|_| "Backup salt is corrupted.".to_string())?;
    if salt.len() != SALT_LEN {
        return Err("Backup salt has an invalid length.".to_string());
    }

    let nonce_bytes = STANDARD
        .decode(&envelope.nonce_b64)
        .map_err(|_| "Backup nonce is corrupted.".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("Backup nonce has an invalid length.".to_string());
    }

    let ciphertext = STANDARD
        .decode(&envelope.ciphertext_b64)
        .map_err(|_| "Backup ciphertext is corrupted.".to_string())?;

    let key = derive_key(&salt, passphrase, envelope.iterations);
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|err| format!("Failed to initialise backup cipher: {err}"))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Incorrect passphrase or corrupted backup file.".to_string())?;

    serde_json::from_slice(&plaintext).map_err(|err| format!("Backup payload is corrupted: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> BackupPayload {
        let mut creds = HashMap::new();
        let mut bsky = HashMap::new();
        bsky.insert("handle".to_string(), "alice.bsky.social".to_string());
        bsky.insert(
            "app_password".to_string(),
            "abcd-efgh-ijkl-mnop".to_string(),
        );
        creds.insert("bluesky".to_string(), bsky);

        let mut frontend_state = HashMap::new();
        frontend_state.insert("enabled-platforms".to_string(), "[\"bluesky\"]".to_string());

        BackupPayload {
            profile_name: "Work".to_string(),
            credentials: creds,
            history: Vec::new(),
            frontend_state,
        }
    }

    #[test]
    fn round_trip_encrypts_and_decrypts_payload() {
        let payload = sample_payload();
        let envelope =
            encrypt_payload(&payload, "correct-horse-battery-staple").expect("encrypts payload");
        let json = serde_json::to_string_pretty(&envelope).expect("serialises envelope");

        let meta = inspect_envelope(&json).expect("inspects envelope");
        assert_eq!(meta.profile_name, "Work");
        assert_eq!(meta.version, BACKUP_VERSION);

        let parsed = parse_and_validate_envelope(&json).expect("validates envelope");
        let decrypted =
            decrypt_envelope(&parsed, "correct-horse-battery-staple").expect("decrypts payload");
        assert_eq!(decrypted.profile_name, "Work");
        assert_eq!(
            decrypted
                .credentials
                .get("bluesky")
                .and_then(|c| c.get("handle"))
                .map(String::as_str),
            Some("alice.bsky.social")
        );
        assert_eq!(
            decrypted
                .frontend_state
                .get("enabled-platforms")
                .map(String::as_str),
            Some("[\"bluesky\"]")
        );
    }

    #[test]
    fn rejects_wrong_passphrase() {
        let payload = sample_payload();
        let envelope = encrypt_payload(&payload, "correct-passphrase").expect("encrypts");
        let err = decrypt_envelope(&envelope, "wrong-passphrase").expect_err("rejects wrong key");
        assert!(err.contains("Incorrect passphrase"));
    }

    #[test]
    fn rejects_tampered_ciphertext() {
        let payload = sample_payload();
        let mut envelope = encrypt_payload(&payload, "correct-passphrase").expect("encrypts");
        let mut raw = STANDARD
            .decode(&envelope.ciphertext_b64)
            .expect("decodes ciphertext");
        raw[0] ^= 0xFF;
        envelope.ciphertext_b64 = STANDARD.encode(raw);

        let err =
            decrypt_envelope(&envelope, "correct-passphrase").expect_err("rejects tampered bytes");
        assert!(err.contains("Incorrect passphrase or corrupted"));
    }

    #[test]
    fn rejects_invalid_format_and_version() {
        let payload = sample_payload();
        let mut envelope = encrypt_payload(&payload, "correct-passphrase").expect("encrypts");
        envelope.format = "other-app".to_string();
        let raw_bad_fmt = serde_json::to_string(&envelope).unwrap();
        assert!(parse_and_validate_envelope(&raw_bad_fmt).is_err());

        envelope.format = BACKUP_FORMAT.to_string();
        envelope.version = 99;
        let raw_bad_ver = serde_json::to_string(&envelope).unwrap();
        assert!(parse_and_validate_envelope(&raw_bad_ver).is_err());
    }
}
