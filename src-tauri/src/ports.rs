// Listening ports / process viewer — enumerates the machine's own listening TCP
// sockets and UDP sockets together with the owning process and useful context
// (memory, uptime, project directory, detected framework, command line). Read
// locally via `netstat2` (sockets) and `sysinfo` (process info); nothing leaves
// the machine and no elevated privileges are required for the user's own
// processes. CPU usage is intentionally omitted so a scan stays instant (a real
// CPU% would need a second sample ~200ms later).

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortEntry {
    protocol: String,             // "TCP" | "UDP"
    family: String,               // "IPv4" | "IPv6"
    local_address: String,        // bound address, e.g. 0.0.0.0 / 127.0.0.1 / ::
    local_port: u16,
    state: String,                // TCP state (e.g. "LISTEN"); empty for UDP
    pid: Option<u32>,
    process_name: Option<String>,
    mem_bytes: Option<u64>,       // resident memory of the owning process
    uptime_secs: Option<u64>,     // how long the process has been running
    project: Option<String>,      // working-directory name (the project folder)
    framework: Option<String>,    // detected framework/runtime (Next.js, Express…)
    command: Option<String>,      // concise command line ("next dev", "node server.js")
}

// Everything we resolve about a process once, keyed by pid.
struct ProcInfo {
    name: String,
    mem_bytes: u64,
    uptime_secs: u64,
    project: Option<String>,
    framework: Option<String>,
    command: Option<String>,
}

#[tauri::command]
pub fn list_listening_ports() -> Result<Vec<PortEntry>, String> {
    use netstat2::{
        get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
    };

    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let sockets = get_sockets_info(af_flags, proto_flags).map_err(|e| e.to_string())?;

    // Resolve every process once up front so we don't query per socket.
    let info: HashMap<u32, ProcInfo> = {
        let sys = sysinfo::System::new_all();
        sys.processes()
            .iter()
            .map(|(pid, p)| {
                // Prefer the executable's file name (full + accurate across
                // macOS/Linux/Windows); fall back to the kernel "comm" name,
                // which macOS truncates to 15 chars and can be empty.
                let exe_name = p
                    .exe()
                    .and_then(|e| e.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .filter(|s| !s.is_empty());
                let name = exe_name
                    .clone()
                    .unwrap_or_else(|| p.name().to_string_lossy().into_owned());

                let cwd = p.cwd();
                let project = cwd
                    .and_then(|c| c.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .filter(|s| !s.is_empty());

                let proc_info = ProcInfo {
                    framework: detect_framework(p.cmd(), exe_name.as_deref().unwrap_or(&name), cwd),
                    command: build_command(p.cmd()),
                    mem_bytes: p.memory(),
                    uptime_secs: p.run_time(),
                    project,
                    name,
                };
                (pid.as_u32(), proc_info)
            })
            .collect()
    };

    let mut out = Vec::new();
    for si in sockets {
        let (protocol, addr, port, state) = match &si.protocol_socket_info {
            ProtocolSocketInfo::Tcp(tcp) => {
                if tcp.state != TcpState::Listen {
                    continue;
                }
                ("TCP", tcp.local_addr, tcp.local_port, "LISTEN".to_string())
            }
            ProtocolSocketInfo::Udp(udp) => ("UDP", udp.local_addr, udp.local_port, String::new()),
        };

        // Port 0 isn't a real bound port (ephemeral / unbound) — it's just noise.
        if port == 0 {
            continue;
        }

        let pid = si.associated_pids.first().copied();
        let proc_info = pid.and_then(|p| info.get(&p));

        out.push(PortEntry {
            protocol: protocol.to_string(),
            family: if addr.is_ipv6() { "IPv6".into() } else { "IPv4".into() },
            local_address: addr.to_string(),
            local_port: port,
            state,
            pid,
            process_name: proc_info.map(|i| i.name.clone()),
            mem_bytes: proc_info.map(|i| i.mem_bytes),
            uptime_secs: proc_info.map(|i| i.uptime_secs),
            project: proc_info.and_then(|i| i.project.clone()),
            framework: proc_info.and_then(|i| i.framework.clone()),
            command: proc_info.and_then(|i| i.command.clone()),
        });
    }

    out.sort_by(|a, b| {
        a.local_port
            .cmp(&b.local_port)
            .then_with(|| a.protocol.cmp(&b.protocol))
    });
    Ok(out)
}

/// Build the command line: replace arg0's full path with its file name (so
/// `/usr/local/bin/node server.js` reads as `node server.js`). The full string
/// is returned (capped only to guard against pathological arg lists) — the UI
/// truncates it for display but keeps the whole thing for expand/copy.
fn build_command(cmd: &[OsString]) -> Option<String> {
    if cmd.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = Vec::with_capacity(cmd.len());
    for (i, arg) in cmd.iter().enumerate() {
        let s = arg.to_string_lossy();
        if i == 0 {
            let base = Path::new(s.as_ref())
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_else(|| s.clone().into_owned());
            parts.push(base);
        } else {
            parts.push(s.into_owned());
        }
    }
    let joined = parts.join(" ");
    let trimmed = joined.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Keep the full command; only guard against a pathological arg list.
    const MAX: usize = 4096;
    if trimmed.len() <= MAX {
        Some(trimmed.to_string())
    } else {
        let mut end = MAX;
        while end > 0 && !trimmed.is_char_boundary(end) {
            end -= 1;
        }
        Some(format!("{}…", &trimmed[..end]))
    }
}

/// Best-effort framework/runtime detection from the command line, executable
/// name, and (for Node projects) the nearest package.json dependencies.
fn detect_framework(cmd: &[OsString], exe_name: &str, cwd: Option<&Path>) -> Option<String> {
    let joined = cmd
        .iter()
        .map(|s| s.to_string_lossy().to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");
    let exe = exe_name.to_lowercase();

    // Strong signals straight from the command line / executable name.
    let direct: &[(&str, &str)] = &[
        ("next", "Next.js"),
        ("nuxt", "Nuxt"),
        ("@nestjs", "NestJS"),
        ("nest start", "NestJS"),
        ("vite", "Vite"),
        ("remix", "Remix"),
        ("astro", "Astro"),
        ("react-scripts", "Create React App"),
        ("manage.py", "Django"),
        ("gunicorn", "Gunicorn"),
        ("uvicorn", "Uvicorn"),
        ("flask", "Flask"),
        ("celery", "Celery"),
        ("rails", "Rails"),
        ("puma", "Puma"),
        ("dockerd", "Docker"),
        ("com.docker", "Docker"),
        ("docker", "Docker"),
    ];
    for (needle, name) in direct {
        if joined.contains(needle) || exe.contains(needle) {
            return Some((*name).to_string());
        }
    }

    // Database servers (matched on the executable name).
    let db: &[(&str, &str)] = &[
        ("postgres", "Postgres"),
        ("postmaster", "Postgres"),
        ("mysqld", "MySQL"),
        ("mariadbd", "MariaDB"),
        ("redis-server", "Redis"),
        ("mongod", "MongoDB"),
    ];
    for (needle, name) in db {
        if exe.contains(needle) {
            return Some((*name).to_string());
        }
    }

    // JavaScript runtimes — inspect package.json to name the actual framework
    // (e.g. an Express app whose command is just `node server.js`).
    let is_node = exe.contains("node")
        || exe.contains("bun")
        || exe.contains("deno")
        || joined.starts_with("node ")
        || joined.contains("/node ");
    if is_node {
        if let Some(fw) = cwd.and_then(detect_js_framework_from_pkg) {
            return Some(fw);
        }
        return Some("Node".to_string());
    }

    if exe.contains("python") || joined.contains("python") {
        return Some("Python".to_string());
    }
    if exe == "java" || joined.contains(".jar") {
        return Some("Java".to_string());
    }
    if exe.contains("ruby") {
        return Some("Ruby".to_string());
    }
    None
}

/// Read `package.json` in the process's working directory and map its
/// dependencies to a known framework. Bounded read; ignores any error.
fn detect_js_framework_from_pkg(cwd: &Path) -> Option<String> {
    let path = cwd.join("package.json");
    let meta = std::fs::metadata(&path).ok()?;
    if meta.len() > 1_000_000 {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;

    let has = |name: &str| {
        ["dependencies", "devDependencies"].iter().any(|k| {
            json.get(k)
                .and_then(|v| v.as_object())
                .map(|o| o.contains_key(name))
                .unwrap_or(false)
        })
    };

    // Most specific first.
    let ranked: &[(&str, &str)] = &[
        ("next", "Next.js"),
        ("nuxt", "Nuxt"),
        ("@nestjs/core", "NestJS"),
        ("vite", "Vite"),
        ("@remix-run/node", "Remix"),
        ("@remix-run/react", "Remix"),
        ("astro", "Astro"),
        ("express", "Express"),
        ("fastify", "Fastify"),
        ("koa", "Koa"),
        ("@hapi/hapi", "Hapi"),
        ("@angular/core", "Angular"),
        ("vue", "Vue"),
        ("react", "React"),
    ];
    for (dep, name) in ranked {
        if has(dep) {
            return Some((*name).to_string());
        }
    }
    None
}
