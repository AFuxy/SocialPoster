pub mod commands;
pub mod core;
pub mod platforms;

use core::profiles::{self, ProfileSessionState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ProfileSessionState::default())
        .setup(|app| {
            let _ = profiles::ensure_initialized(app.handle());
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_profiles,
            commands::create_profile,
            commands::rename_profile,
            commands::unlock_profile,
            commands::lock_profile,
            commands::set_profile_password,
            commands::delete_profile,
            commands::get_platforms,
            commands::save_credentials,
            commands::verify_platform,
            commands::unlink_platform,
            commands::start_platform_oauth,
            commands::broadcast_post,
            commands::get_history,
            commands::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
