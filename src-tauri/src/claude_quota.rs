// Claude Manager — plan usage ("quota"): the share of the 5-hour and weekly
// limits an account has used, and when each resets. Only Anthropic's servers
// know these numbers. Two ways to learn them, both opt-in per account:
//
// 1. Status line (preferred). Claude Code passes `rate_limits` to a status
//    line command on every update. DevTool can install a small sh script as
//    the account's status line; it saves that input next to the account and
//    then runs the status line the account had before. No token is read and
//    nothing goes over the network, but the numbers only move while that
//    account has a Claude Code session open.
// 2. Usage API. Reads the account's sign-in token (macOS Keychain, or
//    `.credentials.json` elsewhere) and asks api.anthropic.com. Always
//    current, but the endpoint is not documented and may change or refuse.
//    The token stays in this module: it is never returned, logged or stored.

use crate::claude_config::{read_text_file, write_config_file};
use crate::claude_monitor::{expand_home, home_dir, mtime_ms};
use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
#[cfg(test)]
use std::path::PathBuf;

const SCRIPT_NAME: &str = "devtool-statusline.sh";
const CAPTURE_NAME: &str = ".devtool-statusline.json";
const ORIGINAL_NAME: &str = ".devtool-statusline-original.json";
const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

const ERR_NOT_CONFIG_DIR: &str = "not-config-dir";
const ERR_SETTINGS_INVALID: &str = "settings-invalid";
const ERR_NO_CREDENTIALS: &str = "no-credentials";
const ERR_TOKEN_EXPIRED: &str = "token-expired";
const ERR_UNAUTHORIZED: &str = "unauthorized";
const ERR_RATE_LIMITED: &str = "rate-limited";
const ERR_BAD_RESPONSE: &str = "bad-response";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaWindow {
    /// "five_hour", "seven_day", "spend_limit", or a per-model key from the API.
    key: String,
    /// 0–100.
    used_percentage: f64,
    /// Epoch milliseconds.
    resets_at: Option<i64>,
    used_usd: Option<f64>,
    limit_usd: Option<f64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaReading {
    /// "statusline" | "api"
    source: &'static str,
    /// When the numbers were taken, epoch milliseconds.
    observed_at: i64,
    windows: Vec<QuotaWindow>,
}

fn number(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

// ── Status line ─────────────────────────────────────────────────────────

/// What the installed script last saved, if anything.
pub(crate) fn read_statusline_quota(config_dir: &Path) -> Option<QuotaReading> {
    let path = config_dir.join(CAPTURE_NAME);
    let observed_at = mtime_ms(&fs::metadata(&path).ok()?);
    let input: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
    let limits = input.get("rate_limits")?.as_object()?;
    let windows: Vec<QuotaWindow> = ["five_hour", "seven_day", "spend_limit"]
        .iter()
        .filter_map(|key| {
            let w = limits.get(*key)?;
            Some(QuotaWindow {
                key: (*key).to_string(),
                used_percentage: number(w, "used_percentage")?,
                // Epoch seconds in the status line input.
                resets_at: w.get("resets_at").and_then(Value::as_i64).map(|s| s * 1000),
                used_usd: number(w, "used_usd"),
                limit_usd: number(w, "limit_usd"),
            })
        })
        .collect();
    (!windows.is_empty()).then_some(QuotaReading { source: "statusline", observed_at, windows })
}

fn read_settings(config_dir: &Path) -> Result<(Map<String, Value>, Option<i64>), String> {
    let file = read_text_file(&config_dir.join("settings.json"));
    if !file.exists {
        return Ok((Map::new(), None));
    }
    let mtime = Some(file.mtime_ms);
    let text = if file.text.trim().is_empty() { "{}" } else { file.text.as_str() };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => Ok((map, mtime)),
        _ => Err(ERR_SETTINGS_INVALID.into()),
    }
}

/// The status line points at DevTool's script.
pub(crate) fn hook_installed(config_dir: &Path) -> bool {
    read_settings(config_dir).ok().is_some_and(|(settings, _)| {
        settings
            .get("statusLine")
            .and_then(|s| s.get("command"))
            .and_then(Value::as_str)
            .is_some_and(|c| c.contains(SCRIPT_NAME))
    })
}

fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r"'\''"))
}

fn script_text(original_command: Option<&str>) -> String {
    let mut out = String::from(
        "#!/bin/sh\n\
         # Written by DevTool (Claude Manager). Saves the status line input so DevTool can\n\
         # show this account's plan usage, then runs the status line you had before.\n\
         # Turn it off in DevTool's Compare tab; that also restores your status line.\n\
         dir=$(dirname \"$0\")\n\
         input=$(cat)\n\
         printf '%s' \"$input\" > \"$dir/.devtool-statusline.json.tmp\" && mv -f \"$dir/.devtool-statusline.json.tmp\" \"$dir/.devtool-statusline.json\"\n",
    );
    if let Some(command) = original_command.filter(|c| !c.trim().is_empty()) {
        out.push_str(&format!("printf '%s' \"$input\" | sh -c {}\n", sh_quote(command)));
    }
    out
}

fn write_settings(config_dir: &Path, settings: Map<String, Value>, mtime: Option<i64>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&Value::Object(settings)).map_err(|e| e.to_string())? + "\n";
    write_config_file(config_dir, "settings", &text, mtime).map(|_| ())
}

fn install_hook(config_dir: &Path) -> Result<(), String> {
    if !config_dir.join("projects").is_dir() {
        return Err(ERR_NOT_CONFIG_DIR.into());
    }
    if hook_installed(config_dir) {
        return Ok(());
    }
    let (mut settings, mtime) = read_settings(config_dir)?;
    let original = settings.get("statusLine").cloned().unwrap_or(Value::Null);
    let original_command = original.get("command").and_then(Value::as_str);
    fs::write(config_dir.join(ORIGINAL_NAME), serde_json::to_vec_pretty(&original).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let script = config_dir.join(SCRIPT_NAME);
    fs::write(&script, script_text(original_command)).map_err(|e| e.to_string())?;

    // Keep the display options the previous status line had.
    let mut line = Map::new();
    line.insert("type".into(), "command".into());
    let path = script.to_string_lossy().replace('\\', "/");
    line.insert("command".into(), format!("sh {}", sh_quote(&path)).into());
    for key in ["padding", "refreshInterval", "hideVimModeIndicator"] {
        if let Some(v) = original.get(key) {
            line.insert(key.into(), v.clone());
        }
    }
    settings.insert("statusLine".into(), Value::Object(line));
    write_settings(config_dir, settings, mtime)
}

fn uninstall_hook(config_dir: &Path) -> Result<(), String> {
    if hook_installed(config_dir) {
        let (mut settings, mtime) = read_settings(config_dir)?;
        let original = fs::read(config_dir.join(ORIGINAL_NAME))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .unwrap_or(Value::Null);
        if original.is_null() {
            settings.remove("statusLine");
        } else {
            settings.insert("statusLine".into(), original);
        }
        write_settings(config_dir, settings, mtime)?;
    }
    for name in [SCRIPT_NAME, CAPTURE_NAME, ORIGINAL_NAME] {
        let _ = fs::remove_file(config_dir.join(name));
    }
    Ok(())
}

/// Installs (`enable`) or removes DevTool's status line script for one
/// account. Removing restores the status line the account had before.
#[tauri::command]
pub async fn claude_monitor_quota_hook(dir: String, enable: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let config_dir = expand_home(&dir, home_dir().as_deref());
        if enable { install_hook(&config_dir) } else { uninstall_hook(&config_dir) }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Usage API ───────────────────────────────────────────────────────────

/// Keychain service names Claude Code may have used for this directory:
/// the bare name when CLAUDE_CONFIG_DIR is unset, otherwise the name plus
/// the first 8 hex digits of SHA-256 of the variable's literal value — which
/// DevTool cannot know, so the likely spellings are all tried.
fn keychain_services(config_dir: &Path, raw_dir: &str, home: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    if home.is_some_and(|h| config_dir == h.join(".claude")) {
        out.push(KEYCHAIN_SERVICE.to_string());
    }
    let absolute = config_dir.to_string_lossy().into_owned();
    for spelling in [absolute.clone(), format!("{absolute}/"), raw_dir.to_string(), format!("{raw_dir}/")] {
        let digest = Sha256::digest(spelling.as_bytes());
        let hex: String = digest.iter().take(4).map(|b| format!("{b:02x}")).collect();
        let name = format!("{KEYCHAIN_SERVICE}-{hex}");
        if !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// The access token inside Claude Code's credential JSON, if still valid.
fn token_from_credentials(json: &str, now_ms: i64) -> Result<String, String> {
    let value: Value = serde_json::from_str(json).map_err(|_| ERR_NO_CREDENTIALS.to_string())?;
    let oauth = value.get("claudeAiOauth").ok_or(ERR_NO_CREDENTIALS)?;
    let token = oauth.get("accessToken").and_then(Value::as_str).ok_or(ERR_NO_CREDENTIALS)?;
    if oauth.get("expiresAt").and_then(Value::as_i64).is_some_and(|at| at <= now_ms) {
        return Err(ERR_TOKEN_EXPIRED.into());
    }
    Ok(token.to_string())
}

#[cfg(target_os = "macos")]
fn keychain_secret(service: &str) -> Option<String> {
    let output = std::process::Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-w"])
        .output()
        .ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(not(target_os = "macos"))]
fn keychain_secret(_service: &str) -> Option<String> {
    None
}

fn read_token(config_dir: &Path, raw_dir: &str, home: Option<&Path>, now_ms: i64) -> Result<String, String> {
    let mut last_err = ERR_NO_CREDENTIALS.to_string();
    let candidates = keychain_services(config_dir, raw_dir, home)
        .into_iter()
        .filter_map(|service| keychain_secret(&service))
        .chain(fs::read_to_string(config_dir.join(".credentials.json")).ok());
    for json in candidates {
        match token_from_credentials(&json, now_ms) {
            Ok(token) => return Ok(token),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// Every `{ utilization, resets_at }` object in the API's answer.
fn parse_usage(body: &Value, observed_at: i64) -> Result<QuotaReading, String> {
    let map = body.as_object().ok_or(ERR_BAD_RESPONSE)?;
    let mut windows: Vec<QuotaWindow> = map
        .iter()
        .filter_map(|(key, w)| {
            let used = number(w, "utilization")?;
            let resets_at = w
                .get("resets_at")
                .and_then(Value::as_str)
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|t| t.timestamp_millis());
            Some(QuotaWindow { key: key.clone(), used_percentage: used, resets_at, used_usd: None, limit_usd: None })
        })
        .collect();
    // The 5-hour and weekly windows first, then the rest by name.
    let rank = |k: &str| match k { "five_hour" => 0, "seven_day" => 1, _ => 2 };
    windows.sort_by(|a, b| rank(&a.key).cmp(&rank(&b.key)).then_with(|| a.key.cmp(&b.key)));
    if windows.is_empty() {
        return Err(ERR_BAD_RESPONSE.into());
    }
    Ok(QuotaReading { source: "api", observed_at, windows })
}

/// Asks Anthropic for one account's plan usage with that account's own
/// sign-in. Errors: "no-credentials", "token-expired", "unauthorized",
/// "rate-limited", "bad-response", or "http-<status>".
#[tauri::command]
pub async fn claude_monitor_fetch_quota(dir: String) -> Result<QuotaReading, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let token = tokio::task::spawn_blocking(move || {
        let home = home_dir();
        let config_dir = expand_home(&dir, home.as_deref());
        read_token(&config_dir, &dir, home.as_deref(), now)
    })
    .await
    .map_err(|e| e.to_string())??;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(USAGE_URL)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .header("User-Agent", "claude-code/2 (DevTool Claude Manager)")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    match response.status().as_u16() {
        200..=299 => {}
        401 | 403 => return Err(ERR_UNAUTHORIZED.into()),
        429 => return Err(ERR_RATE_LIMITED.into()),
        code => return Err(format!("http-{code}")),
    }
    let body: Value = response.json().await.map_err(|_| ERR_BAD_RESPONSE.to_string())?;
    parse_usage(&body, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("claude-quota-{tag}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(dir.join("projects")).unwrap();
            Self(dir)
        }
        fn write(&self, rel: &str, body: &str) {
            fs::write(self.0.join(rel), body).unwrap();
        }
        fn read(&self, rel: &str) -> String {
            fs::read_to_string(self.0.join(rel)).unwrap()
        }
        fn settings(&self) -> Value {
            serde_json::from_str(&self.read("settings.json")).unwrap()
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_rate_limits_saved_by_the_status_line() {
        let dir = TempDir::new("read");
        assert_eq!(read_statusline_quota(&dir.0), None);
        dir.write(CAPTURE_NAME, r#"{"cwd":"/x","rate_limits":{
            "five_hour":{"used_percentage":26,"resets_at":1738425600},
            "seven_day":{"used_percentage":84.5,"resets_at":1738857600},
            "spend_limit":{"used_percentage":10,"used_usd":5,"limit_usd":50}}}"#);
        let reading = read_statusline_quota(&dir.0).unwrap();
        assert_eq!(reading.source, "statusline");
        assert!(reading.observed_at > 0);
        let w: Vec<(&str, f64, Option<i64>)> =
            reading.windows.iter().map(|w| (w.key.as_str(), w.used_percentage, w.resets_at)).collect();
        assert_eq!(w, vec![
            ("five_hour", 26.0, Some(1_738_425_600_000)),
            ("seven_day", 84.5, Some(1_738_857_600_000)),
            ("spend_limit", 10.0, None),
        ]);
        assert_eq!(reading.windows[2].limit_usd, Some(50.0));
        // A session from a plan without limits saves no rate_limits.
        dir.write(CAPTURE_NAME, r#"{"cwd":"/x"}"#);
        assert_eq!(read_statusline_quota(&dir.0), None);
    }

    #[test]
    fn installing_wraps_the_existing_status_line_and_removing_restores_it() {
        let dir = TempDir::new("hook");
        dir.write("settings.json", r#"{"model":"opus","statusLine":{"type":"command","command":"echo 'hi'","padding":1}}"#);
        install_hook(&dir.0).unwrap();
        assert!(hook_installed(&dir.0));
        let settings = dir.settings();
        assert_eq!(settings["model"], "opus");
        let command = settings["statusLine"]["command"].as_str().unwrap();
        assert!(command.starts_with("sh '") && command.contains(SCRIPT_NAME));
        assert_eq!(settings["statusLine"]["padding"], 1);
        let script = dir.read(SCRIPT_NAME);
        assert!(script.contains(r#"| sh -c 'echo '\''hi'\'''"#), "{script}");
        assert!(dir.0.join("settings.json.devtool-bak").exists());
        // Installing twice changes nothing.
        install_hook(&dir.0).unwrap();
        assert_eq!(dir.settings(), settings);

        dir.write(CAPTURE_NAME, "{}");
        uninstall_hook(&dir.0).unwrap();
        assert!(!hook_installed(&dir.0));
        assert_eq!(dir.settings()["statusLine"]["command"], "echo 'hi'");
        for name in [SCRIPT_NAME, CAPTURE_NAME, ORIGINAL_NAME] {
            assert!(!dir.0.join(name).exists(), "{name}");
        }
    }

    #[test]
    fn an_account_without_a_status_line_gets_none_back() {
        let dir = TempDir::new("none");
        install_hook(&dir.0).unwrap();
        assert!(!dir.read(SCRIPT_NAME).contains("sh -c"));
        uninstall_hook(&dir.0).unwrap();
        assert!(dir.settings().get("statusLine").is_none());
    }

    #[test]
    fn the_script_saves_its_input_and_passes_it_on() {
        let dir = TempDir::new("run");
        dir.write("settings.json", r#"{"statusLine":{"type":"command","command":"cat | wc -c"}}"#);
        install_hook(&dir.0).unwrap();
        let mut child = std::process::Command::new("sh")
            .arg(dir.0.join(SCRIPT_NAME))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        let input = r#"{"rate_limits":{"five_hour":{"used_percentage":3,"resets_at":1}}}"#;
        child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), input.len().to_string());
        assert_eq!(read_statusline_quota(&dir.0).unwrap().windows[0].used_percentage, 3.0);
    }

    #[test]
    fn refuses_folders_that_are_not_config_dirs_and_broken_settings() {
        let foreign = std::env::temp_dir().join(format!("claude-quota-foreign-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&foreign).unwrap();
        assert_eq!(install_hook(&foreign).unwrap_err(), ERR_NOT_CONFIG_DIR);
        let _ = fs::remove_dir_all(&foreign);
        let dir = TempDir::new("broken");
        dir.write("settings.json", "{oops");
        assert_eq!(install_hook(&dir.0).unwrap_err(), ERR_SETTINGS_INVALID);
        assert_eq!(dir.read("settings.json"), "{oops");
    }

    #[test]
    fn keychain_service_names_follow_claude_codes_rule() {
        let home = Path::new("/Users/me");
        let default = keychain_services(&home.join(".claude"), "~/.claude", Some(home));
        assert_eq!(default[0], "Claude Code-credentials");
        // sha256("/Users/me/orca/home")[..8]
        let other = keychain_services(Path::new("/Users/me/orca/home"), "~/orca/home", Some(home));
        let hex: String = Sha256::digest(b"/Users/me/orca/home").iter().map(|b| format!("{b:02x}")).collect();
        let expected = format!("Claude Code-credentials-{}", &hex[..8]);
        assert_eq!(other[0], expected);
        assert!(!other.contains(&"Claude Code-credentials".to_string()));
        assert_eq!(other.len(), 4);
    }

    #[test]
    fn tokens_are_taken_only_while_valid() {
        let ok = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-x","expiresAt":2000}}"#;
        assert_eq!(token_from_credentials(ok, 1000).unwrap(), "sk-ant-oat-x");
        assert_eq!(token_from_credentials(ok, 3000).unwrap_err(), ERR_TOKEN_EXPIRED);
        assert_eq!(token_from_credentials("{}", 0).unwrap_err(), ERR_NO_CREDENTIALS);
        assert_eq!(token_from_credentials("nope", 0).unwrap_err(), ERR_NO_CREDENTIALS);

        let dir = TempDir::new("cred");
        assert_eq!(read_token(&dir.0, "x", None, 0).unwrap_err(), ERR_NO_CREDENTIALS);
        dir.write(".credentials.json", ok);
        assert_eq!(read_token(&dir.0, "x", None, 1000).unwrap(), "sk-ant-oat-x");
    }

    #[test]
    fn parses_every_window_the_api_returns() {
        let body: Value = serde_json::from_str(r#"{
            "seven_day_opus":{"utilization":0,"resets_at":null},
            "seven_day":{"utilization":84,"resets_at":"2026-11-17T21:00:00+00:00"},
            "five_hour":{"utilization":26.4,"resets_at":"2026-11-17T13:00:00Z"},
            "five_hour_null":null,
            "extra_usage":{"is_enabled":false}
        }"#).unwrap();
        let reading = parse_usage(&body, 5).unwrap();
        let keys: Vec<&str> = reading.windows.iter().map(|w| w.key.as_str()).collect();
        assert_eq!(keys, vec!["five_hour", "seven_day", "seven_day_opus"]);
        assert_eq!(reading.windows[0].used_percentage, 26.4);
        assert_eq!(reading.windows[0].resets_at, Some(1_794_920_400_000));
        assert_eq!(reading.windows[2].resets_at, None);
        assert_eq!(parse_usage(&serde_json::json!({"x":1}), 0).unwrap_err(), ERR_BAD_RESPONSE);
    }
}
