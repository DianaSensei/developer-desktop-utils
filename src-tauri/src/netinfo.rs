// Local network info — enumerates the machine's own hostname, primary LAN
// addresses, and network interfaces. This is the *local* side of the Network
// tool's "What's My IP" view; the public IP / ISP / geo half is fetched over
// HTTP from the frontend. Everything here is read locally — nothing leaves
// the machine.

use serde::Serialize;
use std::net::IpAddr;

#[derive(Serialize)]
pub struct NetInterface {
    name: String,
    ip: String,
    family: String, // "IPv4" | "IPv6"
    /// Loopback / link-local — not a routable LAN address. Lets the UI
    /// de-emphasise interfaces like `lo` / 127.0.0.1 / fe80::.
    internal: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNetworkInfo {
    hostname: String,
    /// Primary outbound LAN IPv4 (the address used to reach the default route).
    primary_ipv4: Option<String>,
    primary_ipv6: Option<String>,
    interfaces: Vec<NetInterface>,
}

#[tauri::command]
pub fn local_network_info() -> Result<LocalNetworkInfo, String> {
    let hostname = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_default();

    let primary_ipv4 = local_ip_address::local_ip().ok().map(|ip| ip.to_string());
    let primary_ipv6 = local_ip_address::local_ipv6().ok().map(|ip| ip.to_string());

    let mut interfaces = Vec::new();
    if let Ok(list) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in list {
            let (family, internal) = match ip {
                IpAddr::V4(v4) => ("IPv4", v4.is_loopback() || v4.is_link_local()),
                IpAddr::V6(v6) => ("IPv6", v6.is_loopback()),
            };
            interfaces.push(NetInterface {
                name,
                ip: ip.to_string(),
                family: family.to_string(),
                internal,
            });
        }
        // Routable addresses first, then by name for a stable list.
        interfaces.sort_by(|a, b| {
            a.internal
                .cmp(&b.internal)
                .then_with(|| a.name.cmp(&b.name))
        });
    }

    Ok(LocalNetworkInfo {
        hostname,
        primary_ipv4,
        primary_ipv6,
        interfaces,
    })
}
