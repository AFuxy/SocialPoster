## Summary

<!-- Briefly describe your changes or the social network integration being added. -->

## Checklist

- [ ] Platform logic is isolated to a single file in `src-tauri/src/platforms/<network>.rs` (no edits to `mod.rs`, core, or UI).
- [ ] `version()` and `compatible_app_version()` SemVer constraints are set accurately.
- [ ] `authors()` attribution is populated with valid `https://` links.
- [ ] Step-by-step Markdown `setup_instructions` are included for every `AuthMode`.
- [ ] Tested saving credentials, verifying connection, posting (text + media), and unlinking locally.
- [ ] `cargo fmt --check`, `cargo clippy -- -D warnings`, and `npm run build` pass with zero errors.
