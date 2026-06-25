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
            let (family, internal) = classify_ip(ip);
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

/// Classify an address into its family label and whether it's "internal"
/// (loopback / link-local) — i.e. not a routable LAN address the UI should
/// surface prominently.
fn classify_ip(ip: IpAddr) -> (&'static str, bool) {
    match ip {
        IpAddr::V4(v4) => ("IPv4", v4.is_loopback() || v4.is_link_local()),
        IpAddr::V6(v6) => ("IPv6", v6.is_loopback()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, Ipv6Addr};

    #[test]
    fn ipv4_classification() {
        assert_eq!(classify_ip(Ipv4Addr::new(127, 0, 0, 1).into()), ("IPv4", true)); // loopback
        assert_eq!(classify_ip(Ipv4Addr::new(169, 254, 1, 1).into()), ("IPv4", true)); // link-local
        assert_eq!(classify_ip(Ipv4Addr::new(192, 168, 1, 5).into()), ("IPv4", false)); // private LAN — routable
        assert_eq!(classify_ip(Ipv4Addr::new(8, 8, 8, 8).into()), ("IPv4", false)); // public
    }

    #[test]
    fn ipv6_classification() {
        assert_eq!(classify_ip(Ipv6Addr::LOCALHOST.into()), ("IPv6", true)); // ::1 loopback
        assert_eq!(
            classify_ip(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1).into()),
            ("IPv6", false)
        );
    }

    #[test]
    fn local_network_info_is_well_formed_and_sorted() {
        let info = local_network_info().expect("local network info should be readable");
        // Families are always one of the two labels.
        for iface in &info.interfaces {
            assert!(iface.family == "IPv4" || iface.family == "IPv6", "bad family: {}", iface.family);
            assert!(!iface.ip.is_empty());
        }
        // Routable (internal == false) entries must sort before internal ones:
        // no `false` may appear after a `true`.
        let mut seen_internal = false;
        for iface in &info.interfaces {
            if iface.internal {
                seen_internal = true;
            } else {
                assert!(!seen_internal, "non-internal interface appeared after an internal one");
            }
        }
    }
}
