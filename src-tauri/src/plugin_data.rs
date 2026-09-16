// Thư mục lưu dữ liệu bền RIÊNG của một plugin Tier A (biên dịch sẵn vào
// binary chính) — `<app_data>/plugin-data/<plugin_id>/`.
//
// Trước module này, kafka.rs/rabbit.rs/container_tool.rs mỗi cái tự ghép một
// tên file PHẲNG ngay dưới app_data gốc (`kafka-brokers.json`,
// `rabbit-connections.json`, `container-connections.json`) — "cách ly" chỉ
// bằng việc code hiện tại được viết cẩn thận, không có gì ở tầng hệ thống
// ngăn một lỗi gõ nhầm tên đọc/ghi nhầm file của tool khác. Hàm này bắt buộc
// mỗi plugin qua một thư mục riêng trước khi chạm tới tên file cụ thể, cùng
// nguyên tắc với `service_host.rs::service_data_dir` bên phía sidecar Tier B
// (khác nhau đúng một chỗ: Tier A có `AppHandle` sẵn nên đọc thẳng
// `app.path()`, không cần đi qua biến môi trường).
//
// KHÔNG di trú dữ liệu cũ từ vị trí phẳng trước đây: bốn tool đang dùng hàm
// này (Kafka/RabbitMQ/Container, và trước đó Redis) chỉ lưu cấu hình KẾT NỐI
// (host/port/thông tin đăng nhập) — không phải dữ liệu người dùng tạo ra, mà
// là thứ người dùng tự nhập lại được trong vài giây. Quyết định có chủ ý: đổi
// vị trí thẳng, chấp nhận người dùng thấy danh sách kết nối trống một lần sau
// khi nâng cấp, thay vì mang gánh nặng bảo toàn dữ liệu không cần thiết.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Phần GHÉP ĐƯỜNG DẪN thuần — tách khỏi phần chạm `AppHandle`/đĩa bên dưới để
/// test được (không dựng được `AppHandle` thật trong unit test cô lập, cùng lý
/// do đã ghi ở `service_host.rs`/`artifact_installer.rs`).
fn join(app_data_dir: &Path, plugin_id: &str) -> PathBuf {
    app_data_dir.join("plugin-data").join(plugin_id)
}

pub fn plugin_data_dir(app: &AppHandle, plugin_id: &str) -> Result<PathBuf, String> {
    let dir = join(
        &app.path().app_data_dir().map_err(|e| format!("Could not resolve app data directory: {e}"))?,
        plugin_id,
    );
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hai_plugin_khac_nhau_luon_ra_hai_thu_muc_khac_nhau() {
        let root = Path::new("/app-data");
        assert_eq!(join(root, "kafka-explorer"), root.join("plugin-data/kafka-explorer"));
        assert_ne!(join(root, "kafka-explorer"), join(root, "rabbit-client"));
    }
}
