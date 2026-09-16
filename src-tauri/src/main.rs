// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod checksum;
mod dropped;
mod netinfo;
mod files;
mod mcp_bridge;
mod mockserver;
mod ports;
mod secrets_vault;
mod service_host;
mod artifact_installer;
mod plugin_data;

use tauri::Manager;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            // Local-only control channel the MCP stdio sidecar
            // (src/bin/devtool-mcp-server.rs) talks to, so an MCP client
            // (Claude Desktop/Code) can drive the API Client tool through
            // the exact same store/engine the UI uses. See mcp_bridge.rs
            // for the full design.
            mcp_bridge::start(_app.handle());

            // On macOS the OS only routes Cmd+Z/X/C/V/A to the webview when a
            // native Edit menu with PredefinedMenuItems exists. Without it, none
            // of the standard text-editing shortcuts work in <input>/<textarea>
            // or CodeMirror — so this menu is macOS-only.
            //
            // On Windows/Linux the app draws its own titlebar with
            // `decorations: false` (see tauri.windows.conf.json /
            // tauri.linux.conf.json) and standard keyboard shortcuts already
            // reach the webview without a native menu. Calling `set_menu`
            // there is NOT harmless as previously assumed — it forces the OS
            // to keep a native menu bar (and, together with it, some native
            // window chrome) even with `decorations: false`, producing a
            // native titlebar/menu stacked on top of the app's own
            // custom-drawn one.
            #[cfg(target_os = "macos")]
            {
                let edit = Submenu::with_items(_app, "Edit", true, &[
                    &PredefinedMenuItem::undo(_app, None)?,
                    &PredefinedMenuItem::redo(_app, None)?,
                    &PredefinedMenuItem::separator(_app)?,
                    &PredefinedMenuItem::cut(_app, None)?,
                    &PredefinedMenuItem::copy(_app, None)?,
                    &PredefinedMenuItem::paste(_app, None)?,
                    &PredefinedMenuItem::separator(_app)?,
                    &PredefinedMenuItem::select_all(_app, None)?,
                ])?;
                let menu = Menu::with_items(_app, &[&edit])?;
                _app.set_menu(menu)?;
            }
            Ok(())
        })
        .manage(dropped::DroppedPaths::default())
        // Record what the user drags onto the window, so `read_file_data_url`
        // and `hash_file` can serve dropped files without accepting any path
        // the frontend cares to name. `Enter` matters as much as `Drop`: Tauri
        // notifies the webview before these listeners run, and only `Enter`
        // reliably precedes the frontend's invoke. See dropped.rs.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                match drag {
                    tauri::DragDropEvent::Enter { paths, .. }
                    | tauri::DragDropEvent::Drop { paths, .. } => {
                        window.state::<dropped::DroppedPaths>().remember(paths);
                    }
                    _ => {}
                }
            }
        })
        .manage(mockserver::MockState::default())
        // Host cho plugin dịch vụ (tier B) — xem service_host.rs.
        .manage(service_host::ServiceRegistry::default())
        .manage(secrets_vault::VaultState::default())
        .manage(artifact_installer::InstalledIndex::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        // `Builder::default()` tracks + RESTORES every `StateFlags`, including
        // `DECORATIONS` — mỗi lần mở app nó ghi decorations của cửa sổ về đúng
        // giá trị đã lưu trong `.window-state.json` từ lần chạy trước, đè lên
        // `decorations: false` của tauri.windows.conf.json / tauri.linux.conf.json.
        // App từng chạy với decorations mặc định (true) trước khi có titlebar tự
        // vẽ, nên file state cũ trên máy người dùng đã có `decorated: true` —
        // đây là lý do titlebar gốc của Windows vẫn hiện dù config đã đúng.
        // Loại DECORATIONS khỏi flags theo dõi: decorations luôn do config quyết
        // định, không phải do trạng thái lưu lại.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            checksum::hash_file,
            netinfo::local_network_info,
            ports::list_listening_ports,
            files::read_file_data_url,
            mcp_bridge::mcp_respond,
            mcp_bridge::mcp_sidecar_path,
            mcp_bridge::mcp_register_tools,
            mcp_bridge::mcp_unregister_tools,
            service_host::service_call,
            service_host::service_stream_start,
            service_host::service_stream_stop,
            service_host::service_stop,
            secrets_vault::secret_vault_get,
            secrets_vault::secret_vault_set,
            secrets_vault::secret_vault_delete,
            secrets_vault::secret_vault_keys,
            secrets_vault::secret_vault_clear,
            secrets_vault::secret_vault_reset,
            secrets_vault::secret_vault_status,
            artifact_installer::artifact_installer_current_target_triple,
            artifact_installer::artifact_installer_fetch_manifest,
            artifact_installer::artifact_installer_install,
            artifact_installer::artifact_installer_list,
            artifact_installer::artifact_installer_uninstall,
            artifact_installer::artifact_installer_read_bundle,
            mockserver::mock_start,
            mockserver::mock_stop,
            mockserver::mock_status,
            mockserver::mock_update_rules,
            mockserver::mock_test_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
