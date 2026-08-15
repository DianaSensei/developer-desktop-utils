import { lazy, type ComponentType } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { TOOL_DEFS } from '@/lib/toolDefs';

/**
 * Đăng ký tool: id → { route, component code-split, icon, mô tả… }.
 *
 * Tách khỏi App.tsx để `CommandPalette.tsx` tra được đường dẫn của mọi tool mà
 * không phải import ngược App.tsx (App.tsx render CommandPalette → vòng import).
 * `App.tsx` giờ chỉ còn CONSUME `allTools`, không định nghĩa nó.
 */

// Tools are code-split: each loads its own chunk on first navigation instead of
// being bundled into the initial payload. This keeps app startup fast and avoids
// parsing heavy libs (CodeMirror, jsQR, qrcode, react-markdown) until needed.
const named = <T,>(p: Promise<Record<string, T>>, key: string) =>
  p.then((m) => ({ default: (m as Record<string, ComponentType>)[key] }));

const CronGenerator = lazy(() => named(import('@/components/tools/CronGenerator'), 'CronGenerator'));
const TextTransformer = lazy(() => named(import('@/components/tools/TextTransformer'), 'TextTransformer'));
const EncodeHashEncrypt = lazy(() => named(import('@/components/tools/EncodeHashEncrypt'), 'EncodeHashEncrypt'));
const DateTimeTool = lazy(() => named(import('@/components/tools/DateTimeTool'), 'DateTimeTool'));
const JsonFormatter = lazy(() => named(import('@/components/tools/JsonFormatter'), 'JsonFormatter'));
const DataConverter = lazy(() => named(import('@/components/tools/DataConverter'), 'DataConverter'));
const JwtDebugger = lazy(() => named(import('@/components/tools/JwtDebugger'), 'JwtDebugger'));
const RegexTester = lazy(() => named(import('@/components/tools/RegexTester'), 'RegexTester'));
const Generator = lazy(() => named(import('@/components/tools/Generator'), 'Generator'));
const TextDiff = lazy(() => named(import('@/components/tools/diff/TextDiff'), 'TextDiff'));
const QRCodeTool = lazy(() => named(import('@/components/tools/QRCodeTool'), 'QRCodeTool'));
const MarkdownPreview = lazy(() => named(import('@/components/tools/MarkdownPreview'), 'MarkdownPreview'));
const ArrayDeduplicator = lazy(() => named(import('@/components/tools/ArrayDeduplicator'), 'ArrayDeduplicator'));
const TextCounter = lazy(() => named(import('@/components/tools/TextCounter'), 'TextCounter'));
const ColorPicker = lazy(() => named(import('@/components/tools/ColorPicker'), 'ColorPicker'));
const Settings = lazy(() => named(import('@/components/Settings'), 'Settings'));
const KafkaExplorer = lazy(() => named(import('@/components/tools/kafka/KafkaExplorer'), 'KafkaExplorer'));
const RabbitClient = lazy(() => named(import('@/components/tools/rabbit/RabbitClient'), 'RabbitClient'));
const SqlFormatter = lazy(() => named(import('@/components/tools/SqlFormatter'), 'SqlFormatter'));
const TimeTracker = lazy(() => named(import('@/components/tools/clockify/Suite'), 'ClockifySuite'));
const NetworkTools = lazy(() => named(import('@/components/tools/NetworkTools'), 'NetworkTools'));
const LuckyWheel = lazy(() => named(import('@/components/tools/LuckyWheel'), 'LuckyWheel'));
const ApiClient = lazy(() => named(import('@/components/tools/apiclient/ApiClient'), 'ApiClient'));
const TwoFactorAuth = lazy(() => named(import('@/components/tools/TwoFactorAuth'), 'TwoFactorAuth'));
const MockServer = lazy(() => named(import('@/components/tools/mockserver/MockServer'), 'MockServer'));

export const TOOL_ROUTES: Record<string, { path: string; component: ComponentType; fullHeight?: boolean }> = {
  'cron-generator': { path: '/',              component: CronGenerator,      fullHeight: true },
  'text-transform': { path: '/text-transform', component: TextTransformer,   fullHeight: true },
  'text-counter':   { path: '/text-counter',   component: TextCounter,       fullHeight: true },
  'color-picker':   { path: '/color-picker',   component: ColorPicker,       fullHeight: true },
  'base64':         { path: '/base64',         component: EncodeHashEncrypt, fullHeight: true },
  'unix-time':      { path: '/unix-time',      component: DateTimeTool,      fullHeight: true },
  'json':           { path: '/json',           component: JsonFormatter,     fullHeight: true },
  'data-converter': { path: '/data-converter', component: DataConverter,     fullHeight: true },
  'jwt':            { path: '/jwt',            component: JwtDebugger,       fullHeight: true },
  'regex':          { path: '/regex',          component: RegexTester,       fullHeight: true },
  'diff':           { path: '/diff',           component: TextDiff,          fullHeight: true },
  'qrcode':         { path: '/qrcode',         component: QRCodeTool,        fullHeight: true },
  'markdown':       { path: '/markdown',       component: MarkdownPreview,   fullHeight: true },
  'deduplicate':    { path: '/deduplicate',    component: ArrayDeduplicator, fullHeight: true },
  'generator':      { path: '/generator',      component: Generator,         fullHeight: true },
  'kafka-explorer': { path: '/kafka-explorer', component: KafkaExplorer,     fullHeight: true },
  'rabbit-client':  { path: '/rabbit-client',  component: RabbitClient,      fullHeight: true },
  'sql-formatter':  { path: '/sql-formatter',  component: SqlFormatter,      fullHeight: true },
  'task-tracker':   { path: '/task-tracker',   component: TimeTracker,       fullHeight: true },
  'network':        { path: '/network',        component: NetworkTools,      fullHeight: true },
  'lucky-wheel':    { path: '/lucky-wheel',    component: LuckyWheel,        fullHeight: true },
  'api-client':     { path: '/api-client',     component: ApiClient,         fullHeight: true },
  'mock-server':    { path: '/mock-server',    component: MockServer,        fullHeight: true },
  '2fa':            { path: '/2fa',            component: TwoFactorAuth,     fullHeight: true },
};

export const allTools = [
  ...TOOL_DEFS.map((def) => ({
    featureId: def.id,
    label: def.label,
    icon: def.icon,
    description: def.description,
    keywords: def.keywords ?? [],
    ...TOOL_ROUTES[def.id],
  })),
  { featureId: 'settings', label: 'Settings', icon: SettingsIcon, description: '', keywords: ['preferences', 'options', 'config'], path: '/settings', component: Settings },
];

/** id tool → đường dẫn route. Bao gồm cả 'settings', không có trong TOOL_DEFS. */
export const TOOL_PATHS = new Map(allTools.map((t) => [t.featureId, t.path]));

export function toolPath(id: string): string {
  return TOOL_PATHS.get(id) ?? '/';
}
