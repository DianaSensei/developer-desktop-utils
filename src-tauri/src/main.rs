// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod kafka;
mod checksum;
mod netinfo;
mod files;
mod mockserver;

fn main() {
    tauri::Builder::default()
        .manage(mockserver::MockState::default())
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
            mockserver::mock_start,
            mockserver::mock_stop,
            mockserver::mock_status,
            mockserver::mock_update_rules,
            mockserver::mock_test_script,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
