import { Container } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'container-manager',
  label: "Containers",
  icon: Container,
  description:
    "Manage containers, images, volumes, and networks across Docker-compatible runtimes (colima, Docker Desktop, Rancher Desktop, OrbStack, Podman): live CPU/memory usage, CPU and memory limits editable one-by-one or across a selection, and Compose projects grouped read-only by container label.",
  keywords: ["docker", "colima", "podman", "rancher desktop", "orbstack", "container", "compose", "docker-compose", "image", "volume", "network", "dockerfile", "containerd", "cpu", "memory", "resource", "limits", "stats", "quota", "prune", "disk usage", "tag", "subnet", "ipam"],
  route: '/container-manager',
  order: 190,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['container_', 'image_', 'mcp_respond', 'network_', 'volume_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/container/ContainerManager').then((m) => m.ContainerManager),
});
