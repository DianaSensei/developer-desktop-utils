use std::io::Read;
use std::path::Path;
use std::time::Instant;
use tauri::Emitter;

// 256 KB per read — constant memory regardless of file size
const CHUNK: usize = 256 * 1024;

#[tauri::command]
pub async fn hash_file(
    window: tauri::Window,
    path: String,
    algo: String,
) -> Result<String, String> {
    // spawn_blocking keeps the tokio runtime free; hashing is pure CPU work
    tokio::task::spawn_blocking(move || compute(&window, &path, &algo))
        .await
        .map_err(|e| e.to_string())?
}

fn compute(window: &tauri::Window, path: &str, algo: &str) -> Result<String, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let size = meta.len();
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("unknown");

    // Send file metadata so the UI can display it before hashing starts
    window
        .emit("checksum:file-info", serde_json::json!({ "name": name, "size": size }))
        .ok();

    let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let hash = do_hash(&mut f, size, algo, window)?;

    window
        .emit("checksum:progress", serde_json::json!({ "percent": 100u8 }))
        .ok();
    Ok(hash)
}

fn do_hash(
    f: &mut std::fs::File,
    size: u64,
    algo: &str,
    window: &tauri::Window,
) -> Result<String, String> {
    use digest::Digest;

    match algo {
        "md5" => {
            let mut h = md5::Md5::new();
            stream(f, size, window, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha1" => {
            let mut h = sha1::Sha1::new();
            stream(f, size, window, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha256" => {
            let mut h = sha2::Sha256::new();
            stream(f, size, window, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha512" => {
            let mut h = sha2::Sha512::new();
            stream(f, size, window, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        _ => Err(format!("Unknown algorithm: {algo}")),
    }
}

/// Read the file in CHUNK-sized slices, calling `update` on each, and emitting
/// progress events at most every 50 ms so the UI stays responsive.
fn stream(
    f: &mut std::fs::File,
    size: u64,
    window: &tauri::Window,
    mut update: impl FnMut(&[u8]),
) -> Result<(), String> {
    let mut buf = vec![0u8; CHUNK];
    let mut done: u64 = 0;
    let mut last_emit = Instant::now();

    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        update(&buf[..n]);
        done += n as u64;
        if size > 0 && last_emit.elapsed().as_millis() >= 50 {
            let pct = ((done as f64 / size as f64) * 99.0) as u8;
            window
                .emit("checksum:progress", serde_json::json!({ "percent": pct }))
                .ok();
            last_emit = Instant::now();
        }
    }
    Ok(())
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut s, b| {
        write!(s, "{b:02x}").unwrap();
        s
    })
}
