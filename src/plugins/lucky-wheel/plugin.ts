import { Disc3 } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'lucky-wheel',
  label: "Lucky Wheel",
  icon: Disc3,
  description:
    "Spin a wheel of your own choices (one per line) to pick a random winner.",
  keywords: ["wheel", "spinner", "random", "picker", "raffle", "choice", "winner", "decide", "draw"],
  route: '/lucky-wheel',
  order: 240,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/LuckyWheel').then((m) => m.LuckyWheel),
});
