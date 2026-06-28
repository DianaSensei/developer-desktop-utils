// Listening ports / process viewer — enumerates the machine's own listening TCP
// sockets and UDP sockets together with the owning process (pid + name). Read
// locally via `netstat2` (sockets) and `sysinfo` (process names); nothing leaves
// the machine and no elevated privileges are required for the user's own
// processes. This is the local diagnostic half of the Network tool — "what is
// listening on my machine".

use serde::Serialize;
use std::collections::HashMap;

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
}

#[tauri::command]
pub fn list_listening_ports() -> Result<Vec<PortEntry>, String> {
    use netstat2::{
        get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState,
    };

    let af_flags = AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6;
    let proto_flags = ProtocolFlags::TCP | ProtocolFlags::UDP;
    let sockets = get_sockets_info(af_flags, proto_flags).map_err(|e| e.to_string())?;

    // Resolve pid → process name once up front so we don't query per socket.
    // Prefer the executable's file name (full, accurate, and consistent across
    // macOS/Linux/Windows) and fall back to the kernel "comm" name, which macOS
    // truncates to 15 chars and which can be empty for some processes.
    let names: HashMap<u32, String> = {
        let sys = sysinfo::System::new_all();
        sys.processes()
            .iter()
            .map(|(pid, proc_)| {
                let name = proc_
                    .exe()
                    .and_then(|p| p.file_name())
                    .map(|s| s.to_string_lossy().into_owned())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| proc_.name().to_string_lossy().into_owned());
                (pid.as_u32(), name)
            })
            .collect()
    };

    let mut out = Vec::new();
    for si in sockets {
        let (protocol, addr, port, state) = match &si.protocol_socket_info {
            ProtocolSocketInfo::Tcp(tcp) => {
                // Only TCP sockets in LISTEN are actually open/bound ports.
                if tcp.state != TcpState::Listen {
                    continue;
                }
                ("TCP", tcp.local_addr, tcp.local_port, "LISTEN".to_string())
            }
            // Every UDP socket is effectively "listening" — there's no state.
            ProtocolSocketInfo::Udp(udp) => ("UDP", udp.local_addr, udp.local_port, String::new()),
        };

        let pid = si.associated_pids.first().copied();
        let process_name = pid.and_then(|p| names.get(&p).cloned());

        out.push(PortEntry {
            protocol: protocol.to_string(),
            family: if addr.is_ipv6() { "IPv6".into() } else { "IPv4".into() },
            local_address: addr.to_string(),
            local_port: port,
            state,
            pid,
            process_name,
        });
    }

    // Sort by port, then protocol — a stable, scannable order.
    out.sort_by(|a, b| {
        a.local_port
            .cmp(&b.local_port)
            .then_with(|| a.protocol.cmp(&b.protocol))
    });
    Ok(out)
}
