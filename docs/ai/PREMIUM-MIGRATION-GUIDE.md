# Premium Design System Migration Guide

Step-by-step guide to migrate existing tools to the new premium design system.

---

## Quick Start

### 1. Import Premium Components
```tsx
import {
  PremiumCard,
  PremiumContainer,
  PremiumSection,
  PremiumLabel,
  PremiumHint,
  PremiumHeader,
  PremiumContentWrapper,
  PremiumGrid,
  PremiumStatCard,
  PremiumInputGroup,
  PremiumOutputGroup,
  PremiumBadge,
} from '@/components/ui/premium';
```

### 2. Use CSS Classes
```tsx
// For padding
<div className="tool-padding">

// For scrollable content
<div className="tool-scrollable">

// For premium cards
<div className="card-premium">

// For premium inputs
<input className="input-premium" />
```

---

## Migration Patterns

### Pattern 1: Simple Text Tool (Base64, Text Transformer)

**Before:**
```tsx
export function Base64Tool() {
  const [input, setInput] = useState('');
  const output = btoa(input);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Input</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full p-2 border rounded min-h-24"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-medium">Output</label>
          <textarea value={output} readOnly className="w-full p-2 border rounded min-h-24" />
        </div>
      </div>
    </div>
  );
}
```

**After:**
```tsx
import { PremiumContentWrapper, PremiumInputGroup, PremiumOutputGroup, PremiumLabel, PremiumHint } from '@/components/ui/premium';
import { Textarea } from '@/components/ui/textarea';

export function Base64Tool() {
  const [input, setInput] = useState('');
  const output = btoa(input);

  return (
    <div className="tool-full-height">
      <PremiumContentWrapper>
        <PremiumInputGroup>
          <PremiumLabel>Input Text</PremiumLabel>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to encode..."
            className="textarea-premium min-h-24"
          />
        </PremiumInputGroup>

        <PremiumOutputGroup>
          <PremiumLabel>Output</PremiumLabel>
          <Textarea
            value={output}
            readOnly
            className="textarea-premium min-h-24"
          />
        </PremiumOutputGroup>
      </PremiumContentWrapper>
    </div>
  );
}
```

### Pattern 2: Stats Display Tool (Text Counter)

**Before:**
```tsx
<div className="grid grid-cols-2 md:grid-cols-4 gap-2">
  <div className="flex flex-col items-center justify-center p-3 rounded-md border bg-card">
    <div className="text-lg font-bold">{stats.words}</div>
    <div className="text-xs text-muted-foreground mt-1">Words</div>
  </div>
  {/* more cards */}
</div>
```

**After:**
```tsx
import { PremiumGrid, PremiumStatCard } from '@/components/ui/premium';

<PremiumGrid cols={4}>
  <PremiumStatCard label="Words" value={stats.words} color="text-green-600 dark:text-green-400" />
  <PremiumStatCard label="Characters" value={stats.characters} color="text-blue-600 dark:text-blue-400" />
  {/* more stat cards */}
</PremiumGrid>
```

### Pattern 3: Form-Heavy Tool (API Client, Settings)

**Before:**
```tsx
<div className="p-4 space-y-4">
  <div className="space-y-2">
    <label className="text-sm font-medium">URL</label>
    <input type="text" placeholder="Enter URL" className="w-full p-2 border rounded" />
  </div>
  <div className="space-y-2">
    <label className="text-sm font-medium">Headers</label>
    {/* Headers form */}
  </div>
</div>
```

**After:**
```tsx
import { PremiumContainer, PremiumSection, PremiumHeader, PremiumInputGroup, PremiumLabel, PremiumContentWrapper } from '@/components/ui/premium';
import { Input } from '@/components/ui/input';

<PremiumContentWrapper>
  <PremiumSection>
    <PremiumHeader level="md">Request</PremiumHeader>
    <PremiumInputGroup>
      <PremiumLabel>URL</PremiumLabel>
      <Input className="input-premium" placeholder="https://api.example.com" />
    </PremiumInputGroup>
  </PremiumSection>

  <PremiumSection>
    <PremiumHeader level="md">Headers</PremiumHeader>
    <PremiumContainer>
      {/* Headers form inside container */}
    </PremiumContainer>
  </PremiumSection>
</PremiumContentWrapper>
```

### Pattern 4: Tabbed Interface (API Client)

**Before:**
```tsx
<div className="border-b flex gap-4">
  <button className={`px-4 py-2 ${activeTab === 'headers' ? 'border-b-2' : ''}`}>
    Headers
  </button>
  <button className={`px-4 py-2 ${activeTab === 'body' ? 'border-b-2' : ''}`}>
    Body
  </button>
</div>
```

**After:**
```tsx
import { PremiumTab } from '@/components/ui/premium';

<div className="flex gap-0.5 border-b border-border">
  <PremiumTab isActive={activeTab === 'headers'} onClick={() => setActiveTab('headers')}>
    Headers
  </PremiumTab>
  <PremiumTab isActive={activeTab === 'body'} onClick={() => setActiveTab('body')}>
    Body
  </PremiumTab>
</div>
```

### Pattern 5: Split Pane Layout (API Client)

**Before:**
```tsx
<div className="flex gap-4 h-full">
  <div className="w-1/2 border-r">Left panel</div>
  <div className="w-1/2">Right panel</div>
</div>
```

**After:**
```tsx
<div className="split-pane">
  <div className="flex-1 border-r border-border">Left panel</div>
  <div className="flex-1">Right panel</div>
</div>
```

---

## Component Conversion Examples

### Step 1: Text Input Section
```tsx
// OLD
<div className="space-y-2">
  <label>API Key</label>
  <input type="password" placeholder="Enter key" />
</div>

// NEW
<PremiumInputGroup>
  <PremiumLabel>API Key</PremiumLabel>
  <Input type="password" className="input-premium" placeholder="Enter key" />
  <PremiumHint>Keep this secret and secure</PremiumHint>
</PremiumInputGroup>
```

### Step 2: Output Display
```tsx
// OLD
<div className="space-y-2">
  <label>Result</label>
  <textarea readOnly value={result} />
</div>

// NEW
<PremiumOutputGroup>
  <PremiumLabel>Result</PremiumLabel>
  <Textarea readOnly value={result} className="textarea-premium" />
</PremiumOutputGroup>
```

### Step 3: Button Actions
```tsx
// OLD
<button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
  Send
</button>

// NEW
<button className="btn-primary-premium">
  Send
</button>
```

### Step 4: Status Badges
```tsx
// OLD
<span className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm">
  Success
</span>

// NEW
<PremiumBadge variant="primary">
  Success
</PremiumBadge>
```

---

## Priority Migration Order

### Phase 1: High Impact (Most Visible)
1. **Sidebar** ✅ (Already updated)
2. **Header** ✅ (Already updated)
3. **API Client** (Complex, high visibility)
4. **JSON Formatter** (Common tool)

### Phase 2: Medium Priority
5. **Text Transformer** (Popular tool)
6. **Hash Tool** (Already partially styled)
7. **Base64 Tool** (Simple, good practice)
8. **Text Counter** (Already styled)

### Phase 3: Remaining Tools
9. **Regex Tester**
10. **Unix Time Converter**
11. **QR Code Generator**
12. **Image Base64 Tool**
13. **Markdown Preview**
14. **And all remaining tools...**

---

## Detailed Migration: API Client Example

### Current Structure Analysis
```
ApiClient.tsx
├── RequestPanel
│   ├── AddressBar (URL input)
│   ├── RequestTabs
│   │   ├── Headers Tab
│   │   ├── Body Tab
│   │   ├── Auth Tab
│   │   └── Params Tab
│   └── Send Button
├── ResponsePanel
│   ├── Status/Timing
│   └── Response Body
└── Sidebar (History, Env)
```

### Migration Steps

#### Step 1: Wrap Main Container
```tsx
// Before
<div className="h-full flex flex-col">

// After
<div className="tool-full-height">
  <PremiumContentWrapper>
```

#### Step 2: Update Address Bar
```tsx
// Before
<div className="flex gap-2 p-2 border-b">
  <select className="border rounded px-2">{/* Method */}</select>
  <input className="border rounded px-2 flex-1" placeholder="URL" />
  <button className="bg-blue-600 text-white px-4 py-2 rounded">Send</button>
</div>

// After
<div className="flex gap-2 p-4 border-b border-border">
  <select className="input-premium">{/* Method */}</select>
  <input className="input-premium flex-1" placeholder="https://api.example.com/..." />
  <button className="btn-primary-premium">Send</button>
</div>
```

#### Step 3: Update Tabs
```tsx
// Before
<div className="flex border-b">
  <button className={`px-4 py-2 border-b-2 ${active ? 'border-blue-600' : ''}`}>
    Headers ({headers.length})
  </button>
  {/* more tabs */}
</div>

// After
<div className="flex gap-0.5 border-b border-border">
  <PremiumTab isActive={activeTab === 'headers'}>
    Headers ({headers.length})
  </PremiumTab>
  {/* more tabs */}
</div>
```

#### Step 4: Update Response Panel
```tsx
// Before
<div className="p-4 space-y-2">
  <div className="flex gap-2 text-sm">
    <span>Status: {response.status}</span>
    <span>Time: {response.time}ms</span>
  </div>
  <textarea readOnly value={response.body} className="border rounded p-2 w-full h-48" />
</div>

// After
<PremiumContentWrapper>
  <PremiumGrid cols={3}>
    <PremiumStatCard label="Status" value={response.status} />
    <PremiumStatCard label="Time" value={`${response.time}ms`} />
    <PremiumStatCard label="Size" value={`${response.size}B`} />
  </PremiumGrid>

  <PremiumOutputGroup>
    <PremiumLabel>Response Body</PremiumLabel>
    <Textarea readOnly value={response.body} className="textarea-premium h-48" />
  </PremiumOutputGroup>
</PremiumContentWrapper>
```

---

## Common Patterns Reference

### Input Section
```tsx
<PremiumInputGroup>
  <PremiumLabel>Label Text</PremiumLabel>
  <Input className="input-premium" placeholder="Placeholder" />
  <PremiumHint>Helper text</PremiumHint>
</PremiumInputGroup>
```

### Output Section
```tsx
<PremiumOutputGroup>
  <PremiumLabel>Label Text</PremiumLabel>
  <Input readOnly value={value} className="input-premium" />
</PremiumOutputGroup>
```

### Card Section
```tsx
<PremiumCard>
  <div className="p-4">
    <PremiumHeader level="sm">Section Title</PremiumHeader>
    {/* Content */}
  </div>
</PremiumCard>
```

### Container Section
```tsx
<PremiumContainer>
  <PremiumSection>
    {/* Content with space-y-3 */}
  </PremiumSection>
</PremiumContainer>
```

### Action Buttons
```tsx
<div className="tool-button-group">
  <button className="btn-primary-premium">Primary</button>
  <button className="btn-secondary-premium">Secondary</button>
  <button className="btn-ghost-premium">Cancel</button>
</div>
```

---

## Testing Checklist

After migrating each tool:

- [ ] Light mode looks correct (colors, spacing, shadows)
- [ ] Dark mode looks correct
- [ ] All text has proper contrast (4.5:1 minimum)
- [ ] Borders are visible (not too subtle)
- [ ] Shadows look premium (not too harsh)
- [ ] Rounded corners are consistent (1rem)
- [ ] Spacing is consistent (multiples of 4px)
- [ ] Responsive design works (mobile, tablet, desktop)
- [ ] Hover/focus states visible
- [ ] No layout shift on hover
- [ ] Transitions are smooth (150-200ms)

---

## Tailwind Configuration

The design system uses these Tailwind utilities:
- `rounded-lg` (1rem) — Primary border radius
- `shadow-sm-premium` — Default shadow
- `shadow-md-premium` — Hover shadow
- `shadow-lg-premium` — Elevated shadow
- `card-premium` — Card styling
- `input-premium` — Input styling
- `btn-primary-premium` — Primary button
- `split-pane` — Two-column layout

All defined in `src/styles/globals.css`

---

## Troubleshooting

### Issue: Border looks too subtle
**Solution:** Use `border-border` class, verify in both light/dark modes

### Issue: Text not readable in dark mode
**Solution:** Check contrast, use `text-foreground` for primary text, `text-muted-foreground` for secondary

### Issue: Shadows not appearing
**Solution:** Use `shadow-sm-premium` or `shadow-md-premium`, verify class is applied

### Issue: Spacing feels off
**Solution:** Use `space-y-*` utilities, multiples of 4px (2, 3, 4, 5, 6)

### Issue: Rounded corners inconsistent
**Solution:** Always use `rounded-lg` for main components, never `rounded-md` or `rounded-xl`

---

## Performance Notes

- Premium components use CSS classes, zero runtime overhead
- Shadow system uses CSS variables, minimal DOM impact
- No additional dependencies required
- All utilities are pre-compiled by Tailwind

---

## Examples by Tool Type

### Text Processing Tools
- Base64 Tool
- Text Transformer
- Text Counter
- Hash Tool
- Checksum Tool

**Common Pattern:** Input textarea → Processing → Output textarea

### API/Network Tools
- API Client
- Network Tools
- Kafka Explorer

**Common Pattern:** Request form → Send → Response display

### Utility Tools
- Color Picker
- QR Code Generator
- UUID Generator
- Image Base64 Tool

**Common Pattern:** Input → Generation → Output/Preview

### Reference Tools
- Unix Time Converter
- Regex Tester
- SQL Formatter
- JSON Formatter

**Common Pattern:** Input → Format/Convert → Output

---

## Need Help?

Refer to:
1. **PREMIUM-DESIGN-SYSTEM.md** — Complete design specification
2. **src/components/ui/premium.tsx** — Component implementations
3. **src/styles/globals.css** — CSS classes and variables
4. **Refactored tools** — TextCounter.tsx, HashTool.tsx (examples)

Good luck with the migration! 🚀
