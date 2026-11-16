use crate::core::platform::{
    AuthField, AuthorLink, FieldKind, PlatformAuthor, PlatformCapabilities, PlatformEntry,
    PostOutcome, PostPayload, SocialPlatform,
};
use async_trait::async_trait;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

const BSKY_PDS: &str = "https://bsky.social";

pub struct BlueskyPlatform;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    access_jwt: String,
    did: String,
    handle: String,
}

#[derive(Debug, Deserialize)]
struct UploadBlobResponse {
    blob: Value,
}

#[derive(Debug, Deserialize)]
struct CreateRecordResponse {
    uri: String,
}

fn current_iso8601_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;

    // Howard Hinnant's civil-from-days algorithm (UTC).
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

async fn create_session(
    client: &Client,
    creds: &HashMap<String, String>,
) -> Result<SessionResponse, String> {
    let handle = creds
        .get("handle")
        .map(|s| s.trim().trim_start_matches('@'))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Missing Bluesky handle.".to_string())?;

    let app_password = creds
        .get("app_password")
        .map(String::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "Missing Bluesky App Password.".to_string())?;

    let res = client
        .post(format!("{BSKY_PDS}/xrpc/com.atproto.server.createSession"))
        .json(&json!({
            "identifier": handle,
            "password": app_password,
        }))
        .send()
        .await
        .map_err(|err| format!("Network error connecting to Bluesky: {err}"))?;

    let status = res.status();
    if !status.is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Bluesky authentication failed (HTTP {status}): {body}"));
    }

    res.json::<SessionResponse>()
        .await
        .map_err(|err| format!("Failed to parse Bluesky session response: {err}"))
}

#[async_trait]
impl SocialPlatform for BlueskyPlatform {
    fn id(&self) -> &'static str {
        "bluesky"
    }

    fn name(&self) -> &'static str {
        "Bluesky"
    }

    fn accent_colour(&self) -> &'static str {
        "#0285FF"
    }

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn compatible_app_version(&self) -> &'static str {
        "^0.1.0"
    }

    fn authors(&self) -> Vec<PlatformAuthor> {
        vec![PlatformAuthor {
            name: "SocialPoster Developers",
            links: vec![AuthorLink {
                label: "GitHub",
                url: "https://github.com/afuxy/socialposter",
            }],
        }]
    }

    fn auth_fields(&self) -> Vec<AuthField> {
        vec![
            AuthField {
                key: "handle",
                label: "Bluesky Handle",
                placeholder: "alice.bsky.social",
                kind: FieldKind::Text,
                required: true,
                help_text: None,
            },
            AuthField {
                key: "app_password",
                label: "App Password",
                placeholder: "xxxx-xxxx-xxxx-xxxx",
                kind: FieldKind::Secret,
                required: true,
                help_text: Some("Generate an App Password in Bluesky Settings instead of using your main password."),
            },
        ]
    }

    fn setup_instructions(&self) -> &'static str {
        "### How to set up Bluesky\n\n\
         1. Sign in to [Bluesky](https://bsky.app) in your browser.\n\
         2. Open **Settings → Privacy and Security → App Passwords**.\n\
         3. Click **Add App Password**, give it a name such as `SocialPoster`, and copy the generated password.\n\
         4. Enter your full handle (e.g. `alice.bsky.social`) and the App Password on the left, then click **Save** and **Test Connection**."
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            max_chars: 300,
            max_images: 4,
            supports_video: false,
            requires_media: false,
        }
    }

    async fn verify_credentials(&self, creds: &HashMap<String, String>) -> Result<(), String> {
        let client = Client::new();
        let _ = create_session(&client, creds).await?;
        Ok(())
    }

    async fn publish(
        &self,
        post: &PostPayload,
        creds: &HashMap<String, String>,
    ) -> Result<PostOutcome, String> {
        let client = Client::new();
        let session = create_session(&client, creds).await?;

        let mut uploaded_images: Vec<Value> = Vec::new();
        for attachment in post.media.iter().take(4) {
            if !attachment.mime_type.starts_with("image/") {
                return Err(format!(
                    "Bluesky image uploads only support image files (got '{}').",
                    attachment.mime_type
                ));
            }

            let bytes = tokio::fs::read(&attachment.path).await.map_err(|err| {
                format!(
                    "Failed to read attachment '{}': {err}",
                    attachment.path.display()
                )
            })?;

            let upload_res = client
                .post(format!("{BSKY_PDS}/xrpc/com.atproto.repo.uploadBlob"))
                .bearer_auth(&session.access_jwt)
                .header(reqwest::header::CONTENT_TYPE, &attachment.mime_type)
                .body(bytes)
                .send()
                .await
                .map_err(|err| format!("Failed to upload image to Bluesky: {err}"))?;

            let upload_status = upload_res.status();
            if !upload_status.is_success() {
                let body = upload_res.text().await.unwrap_or_default();
                return Err(format!(
                    "Bluesky blob upload failed (HTTP {upload_status}): {body}"
                ));
            }

            let blob_resp = upload_res
                .json::<UploadBlobResponse>()
                .await
                .map_err(|err| format!("Failed to parse Bluesky blob response: {err}"))?;

            uploaded_images.push(json!({
                "alt": attachment.alt_text.as_deref().unwrap_or(""),
                "image": blob_resp.blob,
            }));
        }

        let mut record = json!({
            "$type": "app.bsky.feed.post",
            "text": post.text,
            "createdAt": current_iso8601_utc(),
        });

        if !uploaded_images.is_empty() {
            record["embed"] = json!({
                "$type": "app.bsky.embed.images",
                "images": uploaded_images,
            });
        }

        let create_res = client
            .post(format!("{BSKY_PDS}/xrpc/com.atproto.repo.createRecord"))
            .bearer_auth(&session.access_jwt)
            .json(&json!({
                "repo": session.did,
                "collection": "app.bsky.feed.post",
                "record": record,
            }))
            .send()
            .await
            .map_err(|err| format!("Failed to publish post to Bluesky: {err}"))?;

        let create_status = create_res.status();
        if !create_status.is_success() {
            let body = create_res.text().await.unwrap_or_default();
            return Err(format!(
                "Bluesky createRecord failed (HTTP {create_status}): {body}"
            ));
        }

        let created = create_res
            .json::<CreateRecordResponse>()
            .await
            .map_err(|err| format!("Failed to parse Bluesky createRecord response: {err}"))?;

        let rkey = created.uri.rsplit('/').next().unwrap_or("");
        let post_url = if rkey.is_empty() {
            None
        } else {
            Some(format!(
                "https://bsky.app/profile/{}/post/{rkey}",
                session.handle
            ))
        };

        Ok(PostOutcome {
            platform_id: self.id().to_string(),
            platform_name: self.name().to_string(),
            success: true,
            post_url,
            error: None,
        })
    }
}

inventory::submit! {
    PlatformEntry::new(|| Box::new(BlueskyPlatform))
}
