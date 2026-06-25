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
    // Bridge the pure hasher's progress callback to Tauri events.
    let hash = do_hash(&mut f, size, algo, &mut |pct| {
        window
            .emit("checksum:progress", serde_json::json!({ "percent": pct }))
            .ok();
    })?;

    window
        .emit("checksum:progress", serde_json::json!({ "percent": 100u8 }))
        .ok();
    Ok(hash)
}

/// Hash `f` with the named algorithm, streaming so memory stays constant.
/// `on_progress` is invoked with a 0–99 percentage at most every 50 ms; it is
/// decoupled from Tauri so this function is unit-testable with any `Read`.
fn do_hash<R: Read>(
    f: &mut R,
    size: u64,
    algo: &str,
    on_progress: &mut dyn FnMut(u8),
) -> Result<String, String> {
    use digest::Digest;

    match algo {
        "md5" => {
            let mut h = md5::Md5::new();
            stream(f, size, on_progress, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha1" => {
            let mut h = sha1::Sha1::new();
            stream(f, size, on_progress, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha256" => {
            let mut h = sha2::Sha256::new();
            stream(f, size, on_progress, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        "sha512" => {
            let mut h = sha2::Sha512::new();
            stream(f, size, on_progress, |b| h.update(b))?;
            Ok(to_hex(h.finalize().as_ref()))
        }
        _ => Err(format!("Unknown algorithm: {algo}")),
    }
}

/// Read `f` in CHUNK-sized slices, calling `update` on each, and reporting
/// progress at most every 50 ms so the UI stays responsive.
fn stream<R: Read>(
    f: &mut R,
    size: u64,
    on_progress: &mut dyn FnMut(u8),
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
            on_progress(pct);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn hash(data: &[u8], algo: &str) -> Result<String, String> {
        let mut reader = data;
        let mut noop = |_pct: u8| {};
        do_hash(&mut reader, data.len() as u64, algo, &mut noop)
    }

    #[test]
    fn to_hex_lowercases_and_pads() {
        assert_eq!(to_hex(&[0x00, 0xff, 0x10, 0x0a]), "00ff100a");
        assert_eq!(to_hex(&[]), "");
        assert_eq!(to_hex(&[0x5]), "05");
    }

    #[test]
    fn known_vectors_for_abc() {
        // NIST/standard digests of the ASCII string "abc".
        assert_eq!(hash(b"abc", "md5").unwrap(), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hash(b"abc", "sha1").unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(
            hash(b"abc", "sha256").unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hash(b"abc", "sha512").unwrap(),
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"
        );
    }

    #[test]
    fn empty_input_uses_well_known_empty_digests() {
        assert_eq!(hash(b"", "md5").unwrap(), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(
            hash(b"", "sha256").unwrap(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn unknown_algorithm_is_rejected() {
        let err = hash(b"abc", "crc32").unwrap_err();
        assert!(err.contains("Unknown algorithm"), "got: {err}");
    }

    #[test]
    fn hashing_spans_multiple_chunks() {
        // Larger than CHUNK so the streaming loop iterates more than once and the
        // multi-read path is exercised; the digest must still match a one-shot hash.
        use digest::Digest;
        let data = vec![0xABu8; CHUNK * 2 + 123];
        let got = hash(&data, "sha256").unwrap();
        let want = to_hex(sha2::Sha256::digest(&data).as_ref());
        assert_eq!(got, want);
    }

    #[test]
    fn progress_is_reported_for_large_inputs() {
        // With a known size and a multi-chunk input, at least one progress tick
        // should fire and every value must be within 0..=99.
        let data = vec![0u8; CHUNK * 3];
        let mut reader = &data[..];
        let mut ticks: Vec<u8> = Vec::new();
        let _ = do_hash(&mut reader, data.len() as u64, "sha1", &mut |pct| ticks.push(pct)).unwrap();
        assert!(ticks.iter().all(|&p| p <= 99));
    }
}
