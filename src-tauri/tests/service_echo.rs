// Kiểm chứng đường end-to-end THẬT của tier B: build binary thật
// (`devtool-svc-echo`), spawn nó như một tiến trình con, và nói chuyện qua
// đúng khung JSONL mà `service_host.rs` dùng — không mô phỏng bằng công cụ có
// sẵn của OS như các test trong `service_host.rs` vẫn làm với `cat`/`sh`.
//
// Đây phải là integration test (`tests/`, không phải `#[cfg(test)]` trong
// `src/`): `CARGO_BIN_EXE_<name>` — biến môi trường Cargo trỏ tới đường dẫn
// binary đã build — chỉ được set cho integration test, không cho unit test
// bên trong một bin crate (đã kiểm chứng thủ công trước khi viết file này).
//
// `service_host.rs` không phải `pub`, nên không gọi thẳng `running_from`/
// `exchange` của nó từ đây được — khung JSONL vì vậy được lặp lại ở mức tối
// thiểu. Đó là đánh đổi chấp nhận được: cái cần kiểm ở đây là HÀNH VI CỦA
// BINARY THẬT theo đúng hợp đồng, không phải logic điều phối phía host (đã có
// unit test riêng).

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};

const SERVICE_PROTOCOL: u32 = 1;

/// Gửi một dòng JSON, đọc đúng một dòng phản hồi. `None` nếu tiến trình đóng
/// stdout trước khi kịp trả lời (dùng để kiểm hành vi thoát theo EOF).
fn round_trip(child: &mut std::process::Child, request: &Value) -> Option<Value> {
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{request}").unwrap();
    child.stdin = Some(stdin);

    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    match reader.read_line(&mut line) {
        Ok(0) => None,
        Ok(_) => Some(serde_json::from_str(line.trim()).expect("phản hồi phải là JSON hợp lệ")),
        Err(_) => None,
    }
}

fn spawn() -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_devtool-svc-echo"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn devtool-svc-echo")
}

#[test]
fn ping_tra_ve_pong() {
    let mut child = spawn();
    let res = round_trip(
        &mut child,
        &json!({ "protocol": SERVICE_PROTOCOL, "id": "1", "plugin": "demo", "method": "ping", "params": null }),
    )
    .expect("phải có phản hồi");

    assert_eq!(res["id"], "1");
    assert_eq!(res["protocol"], SERVICE_PROTOCOL);
    assert_eq!(res["result"], "pong");
    assert!(res.get("error").is_none());

    let _ = child.kill();
}

#[test]
fn echo_tra_ve_dung_params_da_gui() {
    let mut child = spawn();
    let payload = json!({ "so": 7, "chu": "xin chào" });
    let res = round_trip(
        &mut child,
        &json!({ "protocol": SERVICE_PROTOCOL, "id": "2", "plugin": "demo", "method": "echo", "params": payload.clone() }),
    )
    .expect("phải có phản hồi");

    assert_eq!(res["result"], payload);

    let _ = child.kill();
}

#[test]
fn method_khong_ho_tro_tra_loi_bang_error_khong_phai_panic() {
    let mut child = spawn();
    let res = round_trip(
        &mut child,
        &json!({ "protocol": SERVICE_PROTOCOL, "id": "3", "plugin": "demo", "method": "rm-rf", "params": null }),
    )
    .expect("phải có phản hồi, không phải im lặng chết");

    assert!(res.get("result").is_none());
    assert!(res["error"].as_str().unwrap().contains("rm-rf"));

    let _ = child.kill();
}

#[test]
fn lech_protocol_thi_tu_choi() {
    let mut child = spawn();
    let res = round_trip(
        &mut child,
        &json!({ "protocol": 99, "id": "4", "plugin": "demo", "method": "ping", "params": null }),
    )
    .expect("phải có phản hồi");

    assert!(res["error"].as_str().unwrap().contains("lệch protocol"));
    // Sidecar vẫn trả lời bằng ĐÚNG protocol của chính nó, để host biết bên
    // nào đang lệch chứ không chỉ biết là có lệch.
    assert_eq!(res["protocol"], SERVICE_PROTOCOL);

    let _ = child.kill();
}

#[test]
fn json_hong_khong_lam_sidecar_chet_va_khong_ghi_gi_khac_len_stdout() {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{{khong-phai-json").unwrap();
    child.stdin = Some(stdin);

    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader.read_line(&mut line).unwrap();
    let res: Value = serde_json::from_str(line.trim()).expect("dòng trả về vẫn phải là JSON hợp lệ");
    assert!(res["error"].as_str().unwrap().contains("JSON không hợp lệ"));

    // Vẫn sống và trả lời tiếp cho request kế — một dòng hỏng không được phép
    // làm hỏng cả phiên.
    let res2 = round_trip(
        &mut child,
        &json!({ "protocol": SERVICE_PROTOCOL, "id": "5", "plugin": "demo", "method": "ping", "params": null }),
    )
    .expect("phải còn sống sau dòng JSON hỏng");
    assert_eq!(res2["result"], "pong");

    let _ = child.kill();
}

/// Đúng vế "thoát khi stdin đóng" của hợp đồng — đây là cách tiến trình con
/// được host dọn khi app bị kill mà không kịp chạy hàm dọn nào (xem `kill()`
/// trong service_host.rs, vốn đóng stdin trước khi mới SIGKILL).
#[test]
fn dong_stdin_thi_sidecar_tu_thoat() {
    let mut child = spawn();
    drop(child.stdin.take().unwrap());

    let status = wait_with_timeout(&mut child, Duration::from_secs(5))
        .expect("sidecar phải tự thoát trong 5s sau khi stdin đóng, không cần SIGKILL");
    assert!(status.success());
}

/// `tick-stream` là method DUY NHẤT phát nhiều dòng cho cùng một request —
/// hành vi mà `sh`/`cat` (dùng ở test của service_host.rs) không mô phỏng
/// được đầy đủ theo đúng nghĩa "một binary thật, đóng gói thật".
#[test]
fn tick_stream_phat_dung_so_su_kien_roi_ket_bang_done() {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(
        stdin,
        r#"{{"protocol":1,"id":"t","plugin":"demo","method":"tick-stream","params":{{"count":3}}}}"#
    )
    .unwrap();
    child.stdin = Some(stdin);

    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut events = Vec::new();
    let mut saw_done = false;

    for _ in 0..4 {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).expect("mỗi dòng phải là JSON hợp lệ");
        assert_eq!(parsed["id"], "t");
        assert_eq!(parsed["stream"], true);
        if parsed.get("done").and_then(Value::as_bool).unwrap_or(false) {
            saw_done = true;
            break;
        }
        events.push(parsed["result"].clone());
    }

    assert!(saw_done, "phải kết thúc bằng done:true, không phải im lặng dừng");
    assert_eq!(events, vec![serde_json::json!(0), serde_json::json!(1), serde_json::json!(2)]);
    let _ = child.kill();
}

#[test]
fn tick_stream_khong_truyen_count_thi_dung_mac_dinh_ba_su_kien() {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, r#"{{"protocol":1,"id":"t2","plugin":"demo","method":"tick-stream","params":null}}"#).unwrap();
    child.stdin = Some(stdin);

    let stdout = child.stdout.as_mut().unwrap();
    let mut reader = BufReader::new(stdout);
    let mut count = 0;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let parsed: Value = serde_json::from_str(line.trim()).unwrap();
        if parsed.get("done").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
        count += 1;
    }
    assert_eq!(count, 3);
    let _ = child.kill();
}

/// Sau khi trả hết N sự kiện của MỘT request stream, sidecar vẫn phải sống và
/// trả lời đúng cho request KẾ TIẾP — một method stream không được phép để
/// lại trạng thái làm hỏng những lời gọi sau nó.
#[test]
fn sau_khi_stream_xong_sidecar_van_tra_loi_binh_thuong_cho_request_ke_tiep() {
    let mut child = spawn();
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, r#"{{"protocol":1,"id":"t3","plugin":"demo","method":"tick-stream","params":{{"count":1}}}}"#).unwrap();
    child.stdin = Some(stdin);

    let stdout = child.stdout.as_mut().unwrap();
    {
        let mut reader = BufReader::new(&mut *stdout);
        for _ in 0..2 {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
        }
    }

    let res = round_trip(
        &mut child,
        &json!({ "protocol": SERVICE_PROTOCOL, "id": "4", "plugin": "demo", "method": "ping", "params": null }),
    )
    .expect("phải còn sống sau khi phát xong một stream");
    assert_eq!(res["result"], "pong");
    let _ = child.kill();
}

fn wait_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> Option<std::process::ExitStatus> {
    let start = std::time::Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Some(status);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            return None;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}
