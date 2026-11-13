// Claude Manager — viewing and editing one account's Claude Code setup.
//
// Reads, for one config directory: `settings.json`, `CLAUDE.md`, the MCP
// servers registered in `.claude.json`, and the agents / commands / skills
// folders. Only `settings.json` and `CLAUDE.md` can be written. `.claude.json`
// is left alone: Claude Code rewrites it while it runs, and a second writer
// would race it.
//
// Values that are usually secrets (MCP `env` and `headers`) never leave this
// module — only their names do.

use crate::claude_monitor::{expand_home, home_dir, mtime_ms};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

const SETTINGS_FILE: &str = "settings.json";
const MEMORY_FILE: &str = "CLAUDE.md";
const BACKUP_SUFFIX: &str = ".devtool-bak";
const TEMP_SUFFIX: &str = ".devtool-tmp";
const DESCRIPTION_MAX_CHARS: usize = 200;
/// How deep `commands/` is walked (commands can be namespaced in folders).
const COMMANDS_DEPTH: usize = 3;

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    exists: bool,
    text: String,
    /// Passed back on save to detect a change made in between.
    mtime_ms: i64,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    name: String,
    /// "user", or the project folder the server is registered for.
    scope: String,
    /// "stdio" | "http" | "sse" | …
    transport: String,
    /// The command line, or the URL.
    target: String,
    env_keys: Vec<String>,
    header_keys: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    name: String,
    description: Option<String>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    settings: TextFile,
    memory: TextFile,
    mcp_servers: Vec<McpServer>,
    agents: Vec<Item>,
    commands: Vec<Item>,
    skills: Vec<Item>,
}

fn read_text_file(path: &Path) -> TextFile {
    match (fs::read_to_string(path), fs::metadata(path)) {
        (Ok(text), Ok(meta)) => TextFile { exists: true, text, mtime_ms: mtime_ms(&meta) },
        _ => TextFile::default(),
    }
}

// ── MCP servers ─────────────────────────────────────────────────────────

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct GlobalConfig {
    #[serde(default)]
    mcp_servers: BTreeMap<String, RawServer>,
    #[serde(default)]
    projects: BTreeMap<String, ProjectConfig>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProjectConfig {
    #[serde(default)]
    mcp_servers: BTreeMap<String, RawServer>,
}

#[derive(Deserialize, Default)]
struct RawServer {
    #[serde(rename = "type")]
    kind: Option<String>,
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    url: Option<String>,
    #[serde(default)]
    env: BTreeMap<String, serde::de::IgnoredAny>,
    #[serde(default)]
    headers: BTreeMap<String, serde::de::IgnoredAny>,
}

fn to_server(name: String, scope: &str, raw: RawServer) -> McpServer {
    let target = match (&raw.url, &raw.command) {
        (Some(url), _) => url.clone(),
        (None, Some(command)) => std::iter::once(command.as_str())
            .chain(raw.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        (None, None) => String::new(),
    };
    McpServer {
        name,
        scope: scope.to_string(),
        transport: raw.kind.unwrap_or_else(|| if raw.url.is_some() { "http" } else { "stdio" }.to_string()),
        target,
        env_keys: raw.env.into_keys().collect(),
        header_keys: raw.headers.into_keys().collect(),
    }
}

/// Same lookup as the account name: inside the directory, or beside it for
/// the default `~/.claude`.
fn global_config_path(config_dir: &Path, home: Option<&Path>) -> Option<PathBuf> {
    let inside = config_dir.join(".claude.json");
    if inside.is_file() {
        return Some(inside);
    }
    let beside = home.filter(|h| config_dir == h.join(".claude"))?.join(".claude.json");
    beside.is_file().then_some(beside)
}

fn read_mcp_servers(config_dir: &Path, home: Option<&Path>) -> Vec<McpServer> {
    let Some(path) = global_config_path(config_dir, home) else { return Vec::new() };
    let Some(config) = fs::read(path).ok().and_then(|b| serde_json::from_slice::<GlobalConfig>(&b).ok()) else {
        return Vec::new();
    };
    let user = config.mcp_servers.into_iter().map(|(name, raw)| to_server(name, "user", raw));
    let per_project = config.projects.into_iter().flat_map(|(project, cfg)| {
        cfg.mcp_servers.into_iter().map(move |(name, raw)| to_server(name, &project, raw)).collect::<Vec<_>>()
    });
    user.chain(per_project).collect()
}

// ── Agents, commands, skills ────────────────────────────────────────────

/// `description:` from a Markdown file's YAML front matter, if it has one.
fn front_matter_description(text: &str) -> Option<String> {
    let mut lines = text.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        if line.trim() == "---" {
            return None;
        }
        if let Some(value) = line.strip_prefix("description:") {
            let value = value.trim().trim_matches(['"', '\'']);
            if value.is_empty() {
                return None;
            }
            let mut out: String = value.chars().take(DESCRIPTION_MAX_CHARS).collect();
            if value.chars().count() > DESCRIPTION_MAX_CHARS {
                out.push('…');
            }
            return Some(out);
        }
    }
    None
}

fn describe(path: &Path) -> Option<String> {
    front_matter_description(&fs::read_to_string(path).ok()?)
}

/// `*.md` files under `dir`, named by their path without the extension
/// (`git/commit.md` → `git/commit`).
fn markdown_items(dir: &Path, max_depth: usize) -> Vec<Item> {
    fn walk(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<Item>) {
        for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if depth > 1 {
                    walk(&path, &format!("{prefix}{name}/"), depth - 1, out);
                }
            } else if let Some(stem) = name.strip_suffix(".md") {
                out.push(Item { name: format!("{prefix}{stem}"), description: describe(&path) });
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, "", max_depth, &mut out);
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// A skill is a folder holding a `SKILL.md`.
fn skill_items(dir: &Path) -> Vec<Item> {
    let mut out: Vec<Item> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let manifest = entry.path().join("SKILL.md");
            manifest.is_file().then(|| Item {
                name: entry.file_name().to_string_lossy().into_owned(),
                description: describe(&manifest),
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

fn read_config(config_dir: &Path, home: Option<&Path>) -> ConfigSnapshot {
    ConfigSnapshot {
        settings: read_text_file(&config_dir.join(SETTINGS_FILE)),
        memory: read_text_file(&config_dir.join(MEMORY_FILE)),
        mcp_servers: read_mcp_servers(config_dir, home),
        agents: markdown_items(&config_dir.join("agents"), 1),
        commands: markdown_items(&config_dir.join("commands"), COMMANDS_DEPTH),
        skills: skill_items(&config_dir.join("skills")),
    }
}

#[tauri::command]
pub async fn claude_monitor_config(dir: String) -> Result<ConfigSnapshot, String> {
    tokio::task::spawn_blocking(move || {
        let home = home_dir();
        let config_dir = expand_home(&dir, home.as_deref());
        if !config_dir.is_dir() {
            return Err("directory not found".to_string());
        }
        Ok(read_config(&config_dir, home.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Writing ─────────────────────────────────────────────────────────────

/// Error codes the UI turns into messages.
const ERR_CONFLICT: &str = "conflict";
const ERR_INVALID_JSON: &str = "invalid-json";
const ERR_NOT_CONFIG_DIR: &str = "not-config-dir";
const ERR_UNKNOWN_FILE: &str = "unknown-file";

/// Replaces `settings.json` or `CLAUDE.md`. The previous content is kept
/// beside it as `<name>.devtool-bak`, and the new content lands through a
/// rename so Claude Code never reads a half-written file.
fn write_config_file(
    config_dir: &Path,
    file: &str,
    text: &str,
    expected_mtime_ms: Option<i64>,
) -> Result<TextFile, String> {
    let name = match file {
        "settings" => SETTINGS_FILE,
        "memory" => MEMORY_FILE,
        _ => return Err(ERR_UNKNOWN_FILE.into()),
    };
    // Refuse to create files in a folder that is not Claude Code's.
    if !config_dir.join("projects").is_dir() {
        return Err(ERR_NOT_CONFIG_DIR.into());
    }
    if file == "settings" {
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(serde_json::Value::Object(_)) => {}
            Ok(_) => return Err(format!("{ERR_INVALID_JSON}: settings must be a JSON object")),
            Err(e) => return Err(format!("{ERR_INVALID_JSON}: {e}")),
        }
    }
    let path = config_dir.join(name);
    let current = fs::metadata(&path).ok().map(|m| mtime_ms(&m));
    // The file changed (or appeared, or vanished) since the editor loaded it.
    if current != expected_mtime_ms.filter(|m| *m != 0) {
        return Err(ERR_CONFLICT.into());
    }
    if current.is_some() {
        fs::copy(&path, config_dir.join(format!("{name}{BACKUP_SUFFIX}"))).map_err(|e| e.to_string())?;
    }
    let temp = config_dir.join(format!(".{name}{TEMP_SUFFIX}"));
    fs::write(&temp, text).map_err(|e| e.to_string())?;
    fs::rename(&temp, &path).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(read_text_file(&path))
}

/// Saves `file` ("settings" | "memory") of one config directory.
/// `expected_mtime_ms` is what `claude_monitor_config` returned; a mismatch
/// fails with "conflict" instead of overwriting someone else's edit.
#[tauri::command]
pub async fn claude_monitor_write_config(
    dir: String,
    file: String,
    text: String,
    expected_mtime_ms: Option<i64>,
) -> Result<TextFile, String> {
    tokio::task::spawn_blocking(move || {
        let config_dir = expand_home(&dir, home_dir().as_deref());
        write_config_file(&config_dir, &file, &text, expected_mtime_ms)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("claude-config-{tag}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(dir.join("projects")).unwrap();
            Self(dir)
        }
        fn write(&self, rel: &str, body: &str) {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, body).unwrap();
        }
        fn read(&self, rel: &str) -> String {
            fs::read_to_string(self.0.join(rel)).unwrap()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn reads_an_accounts_setup_without_secret_values() {
        let dir = TempDir::new("read");
        dir.write("settings.json", r#"{"model":"opus"}"#);
        dir.write("CLAUDE.md", "# Rules\n");
        dir.write(
            ".claude.json",
            r#"{
              "oauthAccount": {"emailAddress": "a@example.com"},
              "mcpServers": {
                "github": {"command": "npx", "args": ["-y", "gh-mcp"], "env": {"GITHUB_TOKEN": "ghp_secret"}},
                "docs": {"type": "http", "url": "https://mcp.example.com", "headers": {"Authorization": "Bearer s3cret"}}
              },
              "projects": {"/work/app": {"mcpServers": {"db": {"command": "db-mcp"}}, "history": []}}
            }"#,
        );
        dir.write("agents/reviewer.md", "---\nname: reviewer\ndescription: \"Reviews diffs\"\n---\nbody");
        dir.write("commands/git/commit.md", "no front matter");
        dir.write("skills/deploy/SKILL.md", "---\ndescription: Ship it\n---\n");
        dir.write("skills/not-a-skill/readme.txt", "");

        let snap = read_config(&dir.0, None);
        assert!(snap.settings.exists && snap.settings.mtime_ms > 0);
        assert_eq!(snap.memory.text, "# Rules\n");

        let names: Vec<(&str, &str)> = snap.mcp_servers.iter().map(|s| (s.name.as_str(), s.scope.as_str())).collect();
        assert_eq!(names, vec![("docs", "user"), ("github", "user"), ("db", "/work/app")]);
        let github = &snap.mcp_servers[1];
        assert_eq!((github.transport.as_str(), github.target.as_str()), ("stdio", "npx -y gh-mcp"));
        assert_eq!(github.env_keys, vec!["GITHUB_TOKEN"]);
        assert_eq!(snap.mcp_servers[0].header_keys, vec!["Authorization"]);
        let wire = serde_json::to_string(&snap).unwrap();
        assert!(!wire.contains("ghp_secret") && !wire.contains("s3cret"));

        assert_eq!(snap.agents, vec![Item { name: "reviewer".into(), description: Some("Reviews diffs".into()) }]);
        assert_eq!(snap.commands, vec![Item { name: "git/commit".into(), description: None }]);
        assert_eq!(snap.skills, vec![Item { name: "deploy".into(), description: Some("Ship it".into()) }]);
    }

    #[test]
    fn an_empty_directory_reads_as_nothing_configured() {
        let dir = TempDir::new("empty");
        let snap = read_config(&dir.0, None);
        assert_eq!(snap.settings, TextFile::default());
        assert!(snap.mcp_servers.is_empty() && snap.agents.is_empty() && snap.skills.is_empty());
    }

    #[test]
    fn the_default_directory_reads_mcp_servers_from_the_file_beside_it() {
        let home = TempDir::new("home");
        fs::create_dir_all(home.0.join(".claude/projects")).unwrap();
        home.write(".claude.json", r#"{"mcpServers":{"x":{"command":"x-mcp"}}}"#);
        assert_eq!(read_mcp_servers(&home.0.join(".claude"), Some(&home.0)).len(), 1);
        assert!(read_mcp_servers(&home.0.join(".claude"), None).is_empty());
    }

    #[test]
    fn saving_keeps_a_backup_and_returns_the_new_state() {
        let dir = TempDir::new("save");
        dir.write("settings.json", r#"{"model":"opus"}"#);
        let loaded = read_text_file(&dir.0.join("settings.json"));

        let saved = write_config_file(&dir.0, "settings", r#"{"model":"sonnet"}"#, Some(loaded.mtime_ms)).unwrap();
        assert_eq!(saved.text, r#"{"model":"sonnet"}"#);
        assert_eq!(dir.read("settings.json"), r#"{"model":"sonnet"}"#);
        assert_eq!(dir.read("settings.json.devtool-bak"), r#"{"model":"opus"}"#);
        assert!(!dir.0.join(".settings.json.devtool-tmp").exists());

        // A file that does not exist yet is created, with no backup.
        let memory = write_config_file(&dir.0, "memory", "# New\n", None).unwrap();
        assert!(memory.exists);
        assert!(!dir.0.join("CLAUDE.md.devtool-bak").exists());
    }

    #[test]
    fn refuses_bad_json_stale_edits_and_foreign_folders() {
        let dir = TempDir::new("refuse");
        dir.write("settings.json", "{}");
        let mtime = read_text_file(&dir.0.join("settings.json")).mtime_ms;

        assert!(write_config_file(&dir.0, "settings", "{oops", Some(mtime)).unwrap_err().starts_with(ERR_INVALID_JSON));
        assert!(write_config_file(&dir.0, "settings", "[1]", Some(mtime)).unwrap_err().starts_with(ERR_INVALID_JSON));
        assert_eq!(write_config_file(&dir.0, "settings", "{}", Some(mtime - 1)).unwrap_err(), ERR_CONFLICT);
        assert_eq!(write_config_file(&dir.0, "settings", "{}", None).unwrap_err(), ERR_CONFLICT);
        assert_eq!(write_config_file(&dir.0, "credentials", "{}", None).unwrap_err(), ERR_UNKNOWN_FILE);
        assert_eq!(dir.read("settings.json"), "{}", "nothing was written");

        let foreign = std::env::temp_dir().join(format!("claude-config-foreign-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&foreign).unwrap();
        assert_eq!(write_config_file(&foreign, "memory", "x", None).unwrap_err(), ERR_NOT_CONFIG_DIR);
        assert!(!foreign.join("CLAUDE.md").exists());
        let _ = fs::remove_dir_all(&foreign);
    }

    #[test]
    fn front_matter_description_is_optional_and_bounded() {
        assert_eq!(front_matter_description("---\ndescription: Hi\n---"), Some("Hi".into()));
        assert_eq!(front_matter_description("description: Hi"), None);
        assert_eq!(front_matter_description("---\nname: x\n---\ndescription: late"), None);
        let long = format!("---\ndescription: {}\n---", "x".repeat(500));
        assert_eq!(front_matter_description(&long).unwrap().chars().count(), DESCRIPTION_MAX_CHARS + 1);
    }
}
