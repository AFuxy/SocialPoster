use crate::core::platform::{MediaAttachment, PostOutcome, PostPayload};
use crate::core::{registry, vault};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::task::JoinSet;

const PLATFORM_PUBLISH_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDispatchRequest {
    pub platform_id: String,
    pub text: String,
    pub media: Vec<MediaAttachment>,
}

fn failure_outcome(platform_id: String, platform_name: String, error: String) -> PostOutcome {
    PostOutcome {
        platform_id,
        platform_name,
        success: false,
        post_url: None,
        error: Some(error),
    }
}

/// Dispatches posts concurrently across all requested platforms using `JoinSet`.
/// Each platform runs in an isolated task with its own timeout; a failure, timeout,
/// or panic in one platform never cancels or panics sibling tasks.
pub async fn dispatch_all(targets: Vec<PlatformDispatchRequest>) -> Vec<PostOutcome> {
    let mut set: JoinSet<PostOutcome> = JoinSet::new();
    let mut outcomes: Vec<PostOutcome> = Vec::with_capacity(targets.len());

    for target in targets {
        let Some(platform) = registry::find_platform(&target.platform_id) else {
            outcomes.push(failure_outcome(
                target.platform_id.clone(),
                target.platform_id,
                "Platform plugin is not registered.".to_string(),
            ));
            continue;
        };

        let platform_id = platform.id().to_string();
        let platform_name = platform.name().to_string();

        let (is_compatible, compatibility_error) = registry::check_compatibility(&*platform);
        if !is_compatible {
            outcomes.push(failure_outcome(
                platform_id,
                platform_name,
                compatibility_error.unwrap_or_else(|| {
                    "Platform plugin is incompatible with this version of SocialPoster.".to_string()
                }),
            ));
            continue;
        }

        let auth_modes = platform.auth_modes();

        let creds = match vault::load_platform_credentials(&platform_id, &auth_modes) {
            Ok(creds) => creds,
            Err(err) => {
                outcomes.push(failure_outcome(platform_id, platform_name, err));
                continue;
            }
        };

        let payload = PostPayload {
            text: target.text,
            media: target.media,
        };

        set.spawn(async move {
            match tokio::time::timeout(PLATFORM_PUBLISH_TIMEOUT, platform.publish(&payload, &creds))
                .await
            {
                Ok(Ok(outcome)) => outcome,
                Ok(Err(err)) => failure_outcome(platform_id, platform_name, err),
                Err(_) => failure_outcome(
                    platform_id,
                    platform_name,
                    format!(
                        "Publish request timed out after {} seconds.",
                        PLATFORM_PUBLISH_TIMEOUT.as_secs()
                    ),
                ),
            }
        });
    }

    while let Some(joined) = set.join_next().await {
        match joined {
            Ok(outcome) => outcomes.push(outcome),
            Err(join_err) => outcomes.push(failure_outcome(
                "unknown".to_string(),
                "Unknown Platform".to_string(),
                format!("Platform dispatch task failed unexpectedly: {join_err}"),
            )),
        }
    }

    outcomes
}
