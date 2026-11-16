# Contributing to Universal Social Cross-Poster

Thank you for helping expand our supported social networks! Because this project uses a compile-time plugin registry (`build.rs` + `inventory`), adding support for a new social platform requires creating **only one Rust file**—you do not need to edit `mod.rs`, `lib.rs`, the dispatcher, or any React UI files.

---

## Architectural Rules for Platform Ports

1. **One File Per Network:** Place your implementation at `src-tauri/src/platforms/<network_id>.rs` (lowercase snake_case, e.g. `telegram.rs`, `threads.rs`, `lemmy.rs`).
2. **Zero Central Servers:** Users run this app locally and supply their own API keys, App Passwords, or OAuth tokens. Never hardcode personal tokens or route user traffic through third-party proxies.
3. **Self-Documenting Setup:** Every user installing the app from GitHub relies on your `setup_instructions()` Markdown guide to obtain their credentials. Write clear, numbered steps assuming the user has never opened a developer portal before.
4. **Accurate Capabilities:** Set `max_chars`, `max_images`, `supports_video`, and `requires_media` truthfully so the UI can validate posts before broadcasting.
5. **Semantic Versioning & Host Compatibility:** Declare `version()` (e.g. `"0.1.0"`) and `compatible_app_version()` (a SemVer requirement such as `"^0.1.0"`). The host validates this constraint safely at runtime so incompatible plugins fail gracefully instead of panicking or corrupting data.
6. **Graceful Errors:** Never use `.unwrap()` or `panic!()` inside `publish()`, `verify_credentials()`, or `start_oauth()`. Map HTTP status codes and API error bodies into clear, human-readable `Err(String)` messages.

---

## Getting Credited in the App

You can credit yourself—and any co-authors—directly inside your platform file by overriding `authors(&self)`:

```rust
fn authors(&self) -> Vec<PlatformAuthor> {
    vec![
        PlatformAuthor {
            name: "@your-handle",
            links: vec![
                AuthorLink { label: "GitHub", url: "https://github.com/your-handle" },
                AuthorLink { label: "Website", url: "https://example.com" },
            ],
        },
    ]
}
```

* All links must start with `https://`.
* The app automatically renders a **"Ported by ..."** section with your links in the platform's settings modal and lists you in the global **Credits** dialog.

---

## Designing Setup Flows (`AuthMode` & `FieldKind`)

Every platform returns one or more `AuthMode`s from `auth_modes(&self)`:

* **Single-Mode Platforms:** Return a `vec![AuthMode { id: "default", ... }]` with standard input fields (`FieldKind::Text`, `FieldKind::Secret`, `FieldKind::Url`, or `FieldKind::Select`).
* **Multi-Mode Platforms (e.g., Webhook vs Bot, or Manual Token vs OAuth 2.0):** Return multiple `AuthMode` entries. The settings modal will automatically display a mode switcher and swap both the form fields and the `setup_instructions` Markdown guide for the selected mode.
* **Interactive OAuth 2.0 Flows:** Include a field with `FieldKind::OAuthButton { button_label: "Connect with ...", target_key: "access_token" }` and implement `start_oauth(&self, mode_id, inputs)` using `crate::core::oauth`. When the user completes the browser login, the backend automatically saves the returned tokens to the OS keyring and marks the platform as configured.
* **Reading the Active Mode:** Inside `verify_credentials()` and `publish()`, read `creds.get("__auth_mode").map(String::as_str).unwrap_or("default")` to check which setup option the user configured.

---

## Copy-Paste Platform Template

Copy the skeleton below into `src-tauri/src/platforms/<your_platform>.rs` to get started:

```rust
use crate::core::platform::{
    AuthField, AuthMode, AuthorLink, FieldKind, PlatformAuthor, PlatformCapabilities,
    PlatformEntry, PostOutcome, PostPayload, SelectOption, SocialPlatform,
};
use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashMap;

pub struct ExamplePlatform;

#[async_trait]
impl SocialPlatform for ExamplePlatform {
    fn id(&self) -> &'static str {
        "example"
    }

    fn name(&self) -> &'static str {
        "Example Network"
    }

    fn accent_colour(&self) -> &'static str {
        "#3B82F6"
    }

    fn version(&self) -> &'static str {
        "0.1.0"
    }

    fn compatible_app_version(&self) -> &'static str {
        "^0.1.0"
    }

    fn authors(&self) -> Vec<PlatformAuthor> {
        vec![PlatformAuthor {
            name: "@your-github-handle",
            links: vec![
                AuthorLink {
                    label: "GitHub",
                    url: "https://github.com/your-github-handle",
                },
                AuthorLink {
                    label: "Website",
                    url: "https://example.com",
                },
            ],
        }]
    }

    fn auth_modes(&self) -> Vec<AuthMode> {
        vec![
            AuthMode {
                id: "token",
                label: "Access Token",
                description: Some("Quick setup using a personal API access token."),
                fields: vec![
                    AuthField {
                        key: "instance_url",
                        label: "Instance URL",
                        placeholder: "https://example.social",
                        kind: FieldKind::Url,
                        required: true,
                        help_text: Some("Include https:// with no trailing slash."),
                    },
                    AuthField {
                        key: "access_token",
                        label: "Access Token",
                        placeholder: "Paste your API access token",
                        kind: FieldKind::Secret,
                        required: true,
                        help_text: None,
                    },
                    AuthField {
                        key: "visibility",
                        label: "Default Visibility",
                        placeholder: "Select visibility",
                        kind: FieldKind::Select {
                            options: vec![
                                SelectOption { value: "public", label: "Public" },
                                SelectOption { value: "unlisted", label: "Unlisted" },
                            ],
                        },
                        required: false,
                        help_text: None,
                    },
                ],
                setup_instructions: Some(
                    "### How to get your Example Network token\n\n\
                     1. Sign in to your **Example Network** account and open **Settings → Developer / Applications**.\n\
                     2. Click **New Application**, name it `Universal Cross-Poster`, and grant `write:statuses` and `write:media` scopes.\n\
                     3. Copy the generated **Access Token** and paste it into the field on the left.\n\
                     4. Click **Save** and press **Test Connection** to verify.",
                ),
            },
        ]
    }

    fn setup_instructions(&self) -> &'static str {
        "Select an authentication mode on the left to view setup instructions."
    }

    fn capabilities(&self) -> PlatformCapabilities {
        PlatformCapabilities {
            max_chars: 500,
            max_images: 4,
            supports_video: false,
            requires_media: false,
        }
    }

    async fn verify_credentials(&self, creds: &HashMap<String, String>) -> Result<(), String> {
        let mode = creds
            .get("__auth_mode")
            .map(String::as_str)
            .unwrap_or("token");

        match mode {
            "token" => {
                let instance = creds
                    .get("instance_url")
                    .map(|s| s.trim().trim_end_matches('/'))
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| "Missing Instance URL".to_string())?;
                let token = creds
                    .get("access_token")
                    .filter(|v| !v.trim().is_empty())
                    .ok_or_else(|| "Missing Access Token".to_string())?;

                let res = Client::new()
                    .get(format!("{instance}/api/v1/accounts/verify_credentials"))
                    .bearer_auth(token)
                    .send()
                    .await
                    .map_err(|e| format!("Network error: {e}"))?;

                if res.status().is_success() {
                    Ok(())
                } else {
                    Err(format!("Authentication failed (HTTP {})", res.status()))
                }
            }
            other => Err(format!("Unsupported authentication mode: {other}")),
        }
    }

    async fn publish(
        &self,
        post: &PostPayload,
        creds: &HashMap<String, String>,
    ) -> Result<PostOutcome, String> {
        let token = creds
            .get("access_token")
            .ok_or_else(|| "Missing Access Token".to_string())?;

        // 1. Upload media attachments first (if post.media is non-empty)
        // 2. Submit the post payload via reqwest
        // 3. Parse the created post URL from the API response
        let _ = (token, post);

        Ok(PostOutcome {
            platform_id: self.id().to_string(),
            platform_name: self.name().to_string(),
            success: true,
            post_url: Some("[https://example.social/@user/12345](https://example.social/@user/12345)".to_string()),
            error: None,
        })
    }
}

// Automatically registers this module at compile time — do not remove!
inventory::submit! {
    PlatformEntry::new(|| Box::new(ExamplePlatform))
}
```

---

## Submitting a Pull Request

1. Create a new branch (`git checkout -b feat/platform-<network>`).
2. Add your single file at `src-tauri/src/platforms/<network>.rs`.
3. Verify compilation and linting inside `src-tauri/`:
```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
```

4. Launch the app locally (`npm run tauri dev`), open your platform's settings modal, confirm every `AuthMode` and Markdown setup guide renders cleanly, test saving, posting, and unlinking, and open a Pull Request.