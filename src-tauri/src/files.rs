// Reads an explicit file path (e.g. one the user dragged in from Finder /
// Explorer) and returns it as a data URL. OS drag-drop only gives the frontend
// a path, not a readable web File, and the fs plugin's scope doesn't cover
// arbitrary dropped paths — so, like the checksum tool's hash_file, we read the
// user-chosen path directly in Rust.

use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub name: String,
    pub size: u64,
    pub mime: String,
    /// `data:<mime>;base64,<...>` — usable directly as an <img> src or split for
    /// the raw base64.
    pub data_url: String,
}

// Cap the in-memory read. Data URLs are base64 (~4/3 size) and cross the IPC
// boundary, so this is sized for images/icons, not arbitrary large files.
const MAX_BYTES: u64 = 64 * 1024 * 1024;

#[tauri::command]
pub async fn read_file_data_url(path: String) -> Result<FileData, String> {
    // Reading + base64 is blocking CPU/IO work; keep the async runtime free.
    tokio::task::spawn_blocking(move || read_data_url(&path))
        .await
        .map_err(|e| e.to_string())?
}

fn read_data_url(path: &str) -> Result<FileData, String> {
    let p = Path::new(path);
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > MAX_BYTES {
        return Err(format!(
            "File is too large to load ({size} bytes; limit {MAX_BYTES})"
        ));
    }
    let bytes = std::fs::read(p).map_err(|e| e.to_string())?;
    let name = p
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let mime = mime_from_extension(p.extension().and_then(|e| e.to_str()));
    let data_url = format!("data:{mime};base64,{}", base64_encode(&bytes));
    Ok(FileData { name, size, mime: mime.to_string(), data_url })
}

/// Map a file extension to a MIME type. Image types are exhaustive (the current
/// callers are image tools); anything else falls back to a generic binary type.
fn mime_from_extension(ext: Option<&str>) -> &'static str {
    match ext.map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("tif") | Some("tiff") => "image/tiff",
        _ => "application/octet-stream",
    }
}

/// Standard base64 (RFC 4648, with padding). Hand-rolled to avoid pulling in a
/// dependency for a single small use.
fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_rfc4648_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn base64_handles_high_bytes() {
        assert_eq!(base64_encode(&[0xff, 0xff, 0xff]), "////");
        assert_eq!(base64_encode(&[0x00]), "AA==");
    }

    #[test]
    fn mime_is_inferred_case_insensitively() {
        assert_eq!(mime_from_extension(Some("png")), "image/png");
        assert_eq!(mime_from_extension(Some("PNG")), "image/png");
        assert_eq!(mime_from_extension(Some("jpeg")), "image/jpeg");
        assert_eq!(mime_from_extension(Some("Jpg")), "image/jpeg");
        assert_eq!(mime_from_extension(Some("svg")), "image/svg+xml");
        assert_eq!(mime_from_extension(Some("webp")), "image/webp");
    }

    #[test]
    fn mime_falls_back_for_unknown_or_missing() {
        assert_eq!(mime_from_extension(Some("xyz")), "application/octet-stream");
        assert_eq!(mime_from_extension(None), "application/octet-stream");
    }

    #[test]
    fn read_data_url_round_trips_a_real_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("devtool_files_test.png");
        std::fs::write(&path, b"foobar").unwrap();
        let out = read_data_url(path.to_str().unwrap()).unwrap();
        assert_eq!(out.name, "devtool_files_test.png");
        assert_eq!(out.size, 6);
        assert_eq!(out.mime, "image/png");
        assert_eq!(out.data_url, "data:image/png;base64,Zm9vYmFy");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn read_data_url_errors_on_missing_file() {
        assert!(read_data_url("/no/such/devtool/file.png").is_err());
    }
}
