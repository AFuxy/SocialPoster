# Contributing to Universal Social Cross-Poster

Thank you for helping expand our supported social networks! Because this project uses a compile-time plugin registry (`build.rs` + `inventory`), adding support for a new social platform requires creating **only one Rust file**—you do not need to edit `mod.rs`, `lib.rs`, the dispatcher, or any React UI files.

---

## Architectural Rules for Platform Ports

1. **One File Per Network:** Place your implementation at `src-tauri/src/platforms/<network_id>.rs` (lowercase snake_case, e.g. `telegram.rs`, `threads.rs`, `lemmy.rs`).
2. **Zero Central Servers:** Users run this app locally and supply their own API keys, App Passwords, or OAuth tokens. Never hardcode personal tokens or route user traffic through third-party proxies.
3. **Self-Documenting Setup:** Every user installing the app from GitHub relies on your `setup_instructions()` Markdown guide to obtain their credentials. Write clear, numbered steps assuming the user has never opened a developer portal before.
4. **Accurate Capabilities & Image Byte Ceilings:** Set `max_chars`, `max_images`, `max_image_bytes`, `supports_video`, and `requires_media` truthfully. Specify the network's documented image byte limit in `PlatformCapabilities { max_image_bytes: Some(...), .. }` (for example, `Some(976_562)` for Bluesky or `Some(5_000_000)` for X / LinkedIn) and rely on `core::media` for automatic resizing and JPEG compression rather than adding image-processing logic inside individual `.rs` platform files. Always read attachment bytes via `attachment.read_bytes().await?`.
5. **Semantic Versioning & Host Compatibility:** Declare `version()` (e.g. `"0.1.0"`) and `compatible_app_version()`. Plugins targeting all `0.x` releases should declare `"<1.0.0"` (or `"^0.2.0"` when targeting a specific minor release); avoid `"^0.0.0"`, which locks minor and patch versions under SemVer rules.
6. **Profile-Scoped Vault Access:** When implementing OAuth token refresh or credential updates inside a plugin, resolve the active `profile_id` from `creds.get(vault::PROFILE_ID_KEY)` and call `vault::save_secret(profile_id, ...)` rather than writing un-namespaced keyring entries.
7. **Graceful Errors:** Never use `.unwrap()` or `panic!()` inside `publish()`, `verify_credentials()`, or `start_oauth()`. Map HTTP status codes and API error bodies into clear, human-readable `Err(String)` messages.

---

## Plugin Versioning & Compatibility

Every platform module declares its own semantic version (`version()`) and host compatibility constraint (`compatible_app_version()`). Follow these two rules in every pull request:

1. **Always Bump `version()` on Plugin Changes:**
   - Every pull request modifying a file in `src-tauri/src/platforms/` must increment that plugin's `version()` string:
     - Patch bump (`0.1.x`) for endpoint fixes, credential or token-refresh fixes, or capability tweaks.
     - Minor bump (`0.x.0`) for new authentication modes or major API version migrations.
2. **Only Update `compatible_app_version()` When Core Requirements Change:**
   - Do **not** bump `compatible_app_version()` simply because the main application incremented its version or because you fixed a platform-specific bug.
   - Only raise the minimum version in `compatible_app_version()` when the plugin relies on new or modified `SocialPlatform` trait methods, `PlatformCapabilities` fields (such as `max_image_bytes`), `FieldKind` variants, or `core` helpers (`vault`, `oauth`, `media`) that did not exist in earlier app releases.
   - Prefer open-ended `0.x` upper bounds such as `">=0.2.0, <1.0.0"` (or `"<1.0.0"` if no `0.2.0+` core fields are used) rather than caret ranges like `"^0.1.0"`, which artificially break valid plugins on every `0.x` minor release.

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
        ">=0.2.0, <1.0.0"
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
            max_image_bytes: Some(8_000_000),
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

        // 1. Read attachment bytes via `attachment.read_bytes().await?` and upload media first
        // 2. Submit the post payload via reqwest
        // 3. Parse the created post URL from the API response
        let _ = (token, post);

        Ok(PostOutcome {
            platform_id: self.id().to_string(),
            platform_name: self.name().to_string(),
            success: true,
            post_url: Some("https://example.social/@user/12345".to_string()),
            error: None,
            notes: Vec::new(),
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