use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorLink {
    pub label: &'static str,
    pub url: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformAuthor {
    pub name: &'static str,
    pub links: Vec<AuthorLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectOption {
    pub value: &'static str,
    pub label: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum FieldKind {
    Text,
    Secret,
    Url,
    Select {
        options: Vec<SelectOption>,
    },
    OAuthButton {
        button_label: &'static str,
        target_key: &'static str,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthField {
    pub key: &'static str,
    pub label: &'static str,
    pub placeholder: &'static str,
    pub kind: FieldKind,
    pub required: bool,
    pub help_text: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMode {
    pub id: &'static str,
    pub label: &'static str,
    pub description: Option<&'static str>,
    pub fields: Vec<AuthField>,
    pub setup_instructions: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilities {
    pub max_chars: usize,
    pub max_images: usize,
    pub supports_video: bool,
    pub requires_media: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub accent_colour: &'static str,
    pub version: &'static str,
    pub compatible_app_version: &'static str,
    pub is_compatible: bool,
    pub compatibility_error: Option<String>,
    pub authors: Vec<PlatformAuthor>,
    pub auth_modes: Vec<AuthMode>,
    pub active_auth_mode: Option<String>,
    pub setup_instructions: &'static str,
    pub capabilities: PlatformCapabilities,
    pub is_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAttachment {
    pub path: PathBuf,
    pub mime_type: String,
    pub alt_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostPayload {
    pub text: String,
    pub media: Vec<MediaAttachment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostOutcome {
    pub platform_id: String,
    pub platform_name: String,
    pub success: bool,
    pub post_url: Option<String>,
    pub error: Option<String>,
}

#[async_trait]
pub trait SocialPlatform: Send + Sync + 'static {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn accent_colour(&self) -> &'static str {
        "#64748B"
    }
    /// Semantic version of this platform plugin (e.g., "0.1.0")
    fn version(&self) -> &'static str {
        "0.1.0"
    }
    /// SemVer requirement for compatible SocialPoster host versions (e.g., "^0.1.0")
    fn compatible_app_version(&self) -> &'static str {
        "^0.1.0"
    }
    fn authors(&self) -> Vec<PlatformAuthor> {
        vec![]
    }
    fn auth_fields(&self) -> Vec<AuthField> {
        vec![]
    }
    fn auth_modes(&self) -> Vec<AuthMode> {
        vec![AuthMode {
            id: "default",
            label: "Default",
            description: None,
            fields: self.auth_fields(),
            setup_instructions: None,
        }]
    }
    fn setup_instructions(&self) -> &'static str;
    fn capabilities(&self) -> PlatformCapabilities;

    async fn verify_credentials(&self, _creds: &HashMap<String, String>) -> Result<(), String> {
        Ok(())
    }

    async fn start_oauth(
        &self,
        _mode_id: &str,
        _inputs: &HashMap<String, String>,
    ) -> Result<HashMap<String, String>, String> {
        Err("OAuth is not supported for this authentication mode.".to_string())
    }

    async fn publish(
        &self,
        post: &PostPayload,
        creds: &HashMap<String, String>,
    ) -> Result<PostOutcome, String>;
}

pub struct PlatformEntry {
    pub factory: fn() -> Box<dyn SocialPlatform>,
}

impl PlatformEntry {
    pub const fn new(factory: fn() -> Box<dyn SocialPlatform>) -> Self {
        Self { factory }
    }
}

inventory::collect!(PlatformEntry);
