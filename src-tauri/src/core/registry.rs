use crate::core::platform::{PlatformEntry, PlatformMetadata, SocialPlatform};
use semver::{Version, VersionReq};

/// Collects all registered platform plugins via `inventory`, sorted by platform `id`.
pub fn all_platforms() -> Vec<Box<dyn SocialPlatform>> {
    let mut platforms: Vec<Box<dyn SocialPlatform>> = inventory::iter::<PlatformEntry>()
        .map(|entry| (entry.factory)())
        .collect();
    platforms.sort_by(|a, b| a.id().cmp(b.id()));
    platforms
}

/// Looks up a single registered platform plugin by its unique `id`.
pub fn find_platform(id: &str) -> Option<Box<dyn SocialPlatform>> {
    inventory::iter::<PlatformEntry>()
        .map(|entry| (entry.factory)())
        .find(|platform| platform.id() == id)
}

/// Evaluates whether a SemVer requirement string is satisfied by `host_version_str`.
pub fn evaluate_compatibility(host_version_str: &str, req_str: &str) -> (bool, Option<String>) {
    let host_version = match Version::parse(host_version_str) {
        Ok(v) => v,
        Err(err) => {
            return (
                false,
                Some(format!(
                    "Invalid host application version '{host_version_str}': {err}"
                )),
            );
        }
    };

    let req = match VersionReq::parse(req_str) {
        Ok(r) => r,
        Err(err) => {
            return (
                false,
                Some(format!(
                    "Invalid compatibility constraint '{req_str}': {err}"
                )),
            );
        }
    };

    if req.matches(&host_version) {
        (true, None)
    } else {
        (
            false,
            Some(format!(
                "Requires SocialPoster {req_str} (current: {host_version})"
            )),
        )
    }
}

/// Checks whether a platform plugin is compatible with the current SocialPoster host version.
pub fn check_compatibility(platform: &dyn SocialPlatform) -> (bool, Option<String>) {
    evaluate_compatibility(env!("CARGO_PKG_VERSION"), platform.compatible_app_version())
}

/// Builds serialisable UI metadata for a platform plugin.
pub fn to_metadata(
    platform: &dyn SocialPlatform,
    is_configured: bool,
    active_auth_mode: Option<String>,
) -> PlatformMetadata {
    let (is_compatible, compatibility_error) = check_compatibility(platform);

    PlatformMetadata {
        id: platform.id(),
        name: platform.name(),
        accent_colour: platform.accent_colour(),
        version: platform.version(),
        compatible_app_version: platform.compatible_app_version(),
        is_compatible,
        compatibility_error,
        authors: platform.authors(),
        auth_modes: platform.auth_modes(),
        active_auth_mode,
        setup_instructions: platform.setup_instructions(),
        capabilities: platform.capabilities(),
        is_configured,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_registered_platforms() {
        let platforms = all_platforms();
        assert!(
            !platforms.is_empty(),
            "expected at least one registered platform"
        );
    }

    #[test]
    fn finds_platform_by_id() {
        let platforms = all_platforms();
        let first = platforms.first().expect("at least one platform registered");
        let found = find_platform(first.id());
        assert!(found.is_some());
        assert_eq!(found.unwrap().name(), first.name());
        assert!(find_platform("non_existent_platform").is_none());
    }

    #[test]
    fn evaluates_semver_compatibility_safely() {
        assert_eq!(evaluate_compatibility("0.1.0", "^0.1.0"), (true, None));

        let (ok_mismatch, err_mismatch) = evaluate_compatibility("0.1.0", "^0.2.0");
        assert!(!ok_mismatch);
        assert_eq!(
            err_mismatch.as_deref(),
            Some("Requires SocialPoster ^0.2.0 (current: 0.1.0)")
        );

        let (ok_invalid, err_invalid) = evaluate_compatibility("0.1.0", "not-a-semver");
        assert!(!ok_invalid);
        assert!(
            err_invalid
                .as_deref()
                .unwrap_or("")
                .starts_with("Invalid compatibility constraint 'not-a-semver':")
        );
    }
}
