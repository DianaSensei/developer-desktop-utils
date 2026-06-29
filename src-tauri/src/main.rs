// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod kafka;
mod checksum;
mod netinfo;
mod files;
mod mockserver;
mod ports;
mod rabbit;

use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // On macOS the OS only routes Cmd+Z/X/C/V/A to the webview when a
            // native Edit menu with PredefinedMenuItems exists. Without it, none
            // of the standard text-editing shortcuts work in <input>/<textarea>
            // or CodeMirror. Windows/Linux work without this but the menu is
            // harmless there.
            let edit = Submenu::with_items(app, "Edit", true, &[
                &PredefinedMenuItem::undo(app, None)?,
                &PredefinedMenuItem::redo(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::cut(app, None)?,
                &PredefinedMenuItem::copy(app, None)?,
                &PredefinedMenuItem::paste(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::select_all(app, None)?,
            ])?;
            let menu = Menu::with_items(app, &[&edit])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .manage(mockserver::MockState::default())
        .manage(rabbit::ConsumerRegistry::default())
        .manage(kafka::KafkaConsumerRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_http::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
