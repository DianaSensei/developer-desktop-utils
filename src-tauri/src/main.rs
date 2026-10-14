// Prevents an additional console window on Windows in release. Do not remove.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod checksum;
mod dropped;
mod netinfo;
mod files;
mod mcp_bridge;
mod mockserver;
mod ports;
mod private_file;
mod secrets_vault;
mod service_host;
mod service_trust;
mod artifact_installer;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

fn main() {
    tauri::Builder::default()
        // Must be registered before any other plugin. A second launch (e.g. a
        // `desktop-devtool-app://install?...` link clicked while the app is open)
        // exits and runs this closure in the existing process. The "deep-link"
        // feature already forwards the URL to `onOpenUrl` (src/lib/deepLink.ts);
        // the closure only has to bring the window to the front, which the OS
        // does not do on its own.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main_window(app)))
        .plugin(tauri_plugin_deep_link::init())
        .setup(|_app| {
            // AppImage has no installer to register the URI scheme, so register
            // it at startup. Harmless elsewhere and when repeated.
            #[cfg(target_os = "linux")]
            {
                let _ = _app.deep_link().register_all();
            }
            // Loopback control channel for the MCP stdio sidecar; see
            // mcp_bridge.rs.
            mcp_bridge::start(_app.handle());

            // macOS takes the first submenu as the app menu, so it comes first
            // (About, Hide, Quit with Cmd+Q). Cmd+Z/X/C/V/A only reach the
            // webview when a native Edit menu exists. The Window menu has no
            // Close item: Cmd+W belongs to the API Client (close tab).
            //
            // Windows and Linux draw their own titlebar (`decorations: false`)
            // and shortcuts already reach the webview. Calling `set_menu` there
            // would force a native menu bar and chrome on top of the custom one.
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
                let app_menu = Submenu::with_items(_app, &_app.package_info().name, true, &[
                    &PredefinedMenuItem::about(_app, None, None)?,
                    &PredefinedMenuItem::separator(_app)?,
                    &PredefinedMenuItem::services(_app, None)?,
                    &PredefinedMenuItem::separator(_app)?,
                    &PredefinedMenuItem::hide(_app, None)?,
                    &PredefinedMenuItem::hide_others(_app, None)?,
                    &PredefinedMenuItem::show_all(_app, None)?,
                    &PredefinedMenuItem::separator(_app)?,
                    &PredefinedMenuItem::quit(_app, None)?,
                ])?;
                let window_menu = Submenu::with_items(_app, "Window", true, &[
                    &PredefinedMenuItem::minimize(_app, None)?,
                    &PredefinedMenuItem::maximize(_app, None)?,
                    &PredefinedMenuItem::fullscreen(_app, None)?,
                ])?;
                let menu = Menu::with_items(_app, &[&app_menu, &edit, &window_menu])?;
                _app.set_menu(menu)?;
            }
            Ok(())
        })
        .manage(dropped::DroppedPaths::default())
        // Record dragged paths so `read_file_data_url` and `hash_file` only read
        // files the user dropped. `Enter` is recorded as well as `Drop` because
        // Tauri notifies the webview before these listeners run. See dropped.rs.
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::DragDrop(
                tauri::DragDropEvent::Enter { paths, .. } | tauri::DragDropEvent::Drop { paths, .. },
            ) => {
                window.state::<dropped::DroppedPaths>().remember(paths);
            }
            // On macOS closing the window hides it and DevTool stays in the
            // Dock, as Mac apps do: clicking the Dock icon brings the same
            // window back, and MCP bridges in the webview keep answering.
            // Cmd+Q quits. A full-screen window is closed instead, since a
            // hidden one would leave an empty Space; see `RunEvent::Reopen`.
            #[cfg(target_os = "macos")]
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == MAIN_WINDOW && !window.is_fullscreen().unwrap_or(false) =>
            {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .manage(mockserver::MockState::default())
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
        // Do not restore `DECORATIONS`: older installs saved `decorated: true`
        // in `.window-state.json`, which would override `decorations: false`
        // from tauri.windows.conf.json / tauri.linux.conf.json. Nor `VISIBLE`:
        // on macOS the window is hidden, not closed, so quitting from the Dock
        // would save it as hidden.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            match _event {
                // The last window closing (`code: None`) does not quit on
                // macOS; Cmd+Q, the Dock's Quit and `exit()` still do.
                tauri::RunEvent::ExitRequested { code: None, api, .. } => api.prevent_exit(),
                // Dock icon or Finder while DevTool is running.
                tauri::RunEvent::Reopen { .. } => show_main_window(_app),
                _ => {}
            }
        });
}

const MAIN_WINDOW: &str = "main";

/// Brings the main window to the front, recreating it from tauri.conf.json
/// when it was closed, so a second launch, a deep link or a Dock click always
/// ends with a visible window.
fn show_main_window(app: &tauri::AppHandle) {
    let window = match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => window,
        None => {
            let Some(config) = app.config().app.windows.iter().find(|w| w.label == MAIN_WINDOW) else {
                return;
            };
            match tauri::WebviewWindowBuilder::from_config(app, config).and_then(|b| b.build()) {
                Ok(window) => window,
                Err(e) => {
                    eprintln!("could not reopen the main window: {e}");
                    return;
                }
            }
        }
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}
