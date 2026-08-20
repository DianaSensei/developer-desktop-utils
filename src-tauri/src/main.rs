// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod kafka;
mod checksum;
mod netinfo;
mod files;
mod mockserver;
mod ports;
mod rabbit;
mod redis_tool;
mod container_tool;

#[cfg(target_os = "macos")]
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
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
        .manage(mockserver::MockState::default())
        .manage(rabbit::ConsumerRegistry::default())
        .manage(kafka::KafkaConsumerRegistry::default())
        .manage(redis_tool::PubSubRegistry::default())
        .manage(container_tool::StreamRegistry::default())
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
            kafka::kafka_list_configs,
            kafka::kafka_save_config,
            kafka::kafka_delete_config,
            kafka::kafka_test_connection,
            kafka::kafka_list_topics,
            kafka::kafka_topic_details,
            kafka::kafka_topic_consumer_groups,
            kafka::kafka_create_topic,
            kafka::kafka_list_groups,
            kafka::kafka_group_details,
            kafka::kafka_produce,
            kafka::kafka_produce_batch,
            kafka::kafka_fetch_messages,
            kafka::kafka_delete_topic,
            kafka::kafka_topic_configs,
            kafka::kafka_consume_start,
            kafka::kafka_consume_stop,
            mockserver::mock_start,
            mockserver::mock_stop,
            mockserver::mock_status,
            mockserver::mock_update_rules,
            mockserver::mock_test_script,
            rabbit::rabbit_list_configs,
            rabbit::rabbit_save_config,
            rabbit::rabbit_delete_config,
            rabbit::rabbit_rpc_call,
            rabbit::rabbit_publish,
            rabbit::rabbit_consume_start,
            rabbit::rabbit_consume_stop,
            rabbit::rabbit_amqp_test,
            rabbit::rabbit_amqp_queues_info,
            rabbit::rabbit_amqp_exchanges_info,
            rabbit::rabbit_amqp_declare_queue,
            rabbit::rabbit_amqp_declare_exchange,
            rabbit::rabbit_amqp_bind_queue,
            redis_tool::redis_list_configs,
            redis_tool::redis_save_config,
            redis_tool::redis_delete_config,
            redis_tool::redis_test_connection,
            redis_tool::redis_overview,
            redis_tool::redis_scan_keys,
            redis_tool::redis_key_summary,
            redis_tool::redis_get_key,
            redis_tool::redis_set_string,
            redis_tool::redis_set_ttl,
            redis_tool::redis_delete_keys,
            redis_tool::redis_rename_key,
            redis_tool::redis_exec,
            redis_tool::redis_memory_usage,
            redis_tool::redis_pubsub_subscribe,
            redis_tool::redis_pubsub_unsubscribe,
            redis_tool::redis_publish,
            redis_tool::redis_client_list,
            redis_tool::redis_slowlog,
            redis_tool::redis_config_get,
            redis_tool::redis_config_set,
            container_tool::container_list_configs,
            container_tool::container_save_config,
            container_tool::container_delete_config,
            container_tool::container_detect_sockets,
            container_tool::container_test_connection,
            container_tool::container_list,
            container_tool::container_inspect,
            container_tool::container_start,
            container_tool::container_stop,
            container_tool::container_restart,
            container_tool::container_pause,
            container_tool::container_unpause,
            container_tool::container_remove,
            container_tool::container_logs_start,
            container_tool::container_logs_stop,
            container_tool::container_stats_start,
            container_tool::image_list,
            container_tool::image_inspect,
            container_tool::image_remove,
            container_tool::image_pull,
            container_tool::volume_list,
            container_tool::volume_remove,
            container_tool::volume_create,
            container_tool::network_list,
            container_tool::network_remove,
            container_tool::network_create,
            container_tool::container_system_info,
            container_tool::container_system_df,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
