use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-changed=src/platforms");

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set"));
    let platforms_dir = manifest_dir.join("src").join("platforms");

    let mut entries: Vec<(String, String)> = Vec::new();

    if platforms_dir.is_dir() {
        let read_dir = fs::read_dir(&platforms_dir).expect("failed to read src/platforms");
        for entry in read_dir {
            let entry = entry.expect("failed to read directory entry in src/platforms");
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            if ext != "rs" {
                continue;
            }

            let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if file_name == "mod.rs" {
                continue;
            }

            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };

            let normalized_path = path.to_string_lossy().replace('\\', "/");
            entries.push((stem.to_string(), normalized_path));
        }
    }

    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR not set"));
    let generated_path = out_dir.join("generated_platforms.rs");

    let mut generated = String::new();
    for (stem, path) in entries {
        generated.push_str(&format!("#[path = \"{path}\"]\npub mod {stem};\n"));
    }

    fs::write(&generated_path, generated).expect("failed to write generated_platforms.rs");

    tauri_build::build()
}
