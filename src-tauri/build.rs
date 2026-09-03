fn main() {
    ensure_mcp_sidecar_placeholder();
    tauri_build::build()
}

// `tauri_build::build()` validates that every `bundle.externalBin` resource
// (tauri.conf.json's `binaries/devtool-mcp-server`) exists on disk for the
// current target triple — and it does this on EVERY `cargo build`/`check`/
// `test` of this crate, not just an actual `tauri build`. The real
// devtool-mcp-server binary only gets built there by
// scripts/prepare-mcp-sidecar.mjs (run via `beforeBuildCommand`, see
// tauri.conf.json), so a fresh checkout — or CI's coverage job, which
// invokes `cargo` directly — would otherwise fail to compile a single line
// of the app. Drop in an empty placeholder so the check passes when nothing
// real has been built yet; prepare-mcp-sidecar.mjs overwrites it with the
// actual compiled binary before a real release build ever bundles it.
fn ensure_mcp_sidecar_placeholder() {
    let Ok(target) = std::env::var("TARGET") else { return };
    let suffix = if target.contains("windows") { ".exe" } else { "" };
    let path = std::path::PathBuf::from("binaries").join(format!("devtool-mcp-server-{target}{suffix}"));
    if path.exists() {
        return;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&path, b"");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
}
