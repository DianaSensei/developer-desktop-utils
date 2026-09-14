import { Network } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'network',
  label: "Network Tools",
  icon: Network,
  description:
    "DNS records (A, AAAA, CNAME, NS, TXT, SOA, SRV, CAA…), propagation, DNSSEC, listening ports & processes, plus what's my IP and IP geolocation lookup.",
  keywords: ["dns", "ip address", "geolocation", "lookup", "propagation", "dnssec", "nslookup", "dig", "whats my ip", "cname", "txt record", "ports", "listening ports", "open ports", "port viewer", "port in use", "whats using my port", "kill port", "process", "netstat", "lsof", "pid", "tcp", "udp", "socket"],
  route: '/network',
  order: 250,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native', 'http'],
  commands: ['list_listening_ports', 'local_network_info'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/NetworkTools').then((m) => m.NetworkTools),
});
