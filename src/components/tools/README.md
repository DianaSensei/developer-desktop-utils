# DevTool - Available Tools

## Text Tools

### Text Counter (NEW!)
**Path:** `/text-counter`  
**Icon:** Type  
**Features:**
- Real-time character count (with and without spaces)
- Word count
- Line count
- Paragraph count
- Sentence count
- Average word length
- Reading time estimate (200 words/min)
- Detailed text statistics
- Words per sentence
- Sentences per paragraph

**Use Cases:**
- Content writing
- SEO optimization
- Academic writing
- Social media posts
- Character limits checking

### Text Transformer
**Path:** `/text-transform`  
**Features:**
- Convert to single line
- Convert to multiple lines
- Convert to array format

### Text Diff
**Path:** `/diff`  
**Features:**
- Compare two texts
- Highlight differences
- Show additions/removals

## Encoding/Decoding

### Base64
**Path:** `/base64`  
**Features:**
- Encode text to Base64
- Decode Base64 to text

### URL Encoder/Decoder
**Path:** `/url`  
**Features:**
- URL encode
- URL decode

### Hash & Encrypt
**Path:** `/hash`  
**Features:**
- MD5, SHA-1, SHA-256, SHA-512
- AES encryption/decryption

## Development Tools

### Cron Generator
**Path:** `/`  
**Features:**
- Generate cron expressions
- Common presets
- Visual builder

### JSON Formatter
**Path:** `/json`  
**Features:**
- Format JSON
- Minify JSON
- Validate JSON

### JWT Debugger
**Path:** `/jwt`  
**Features:**
- Decode JWT tokens
- View header and payload
- No signature verification

### Regex Tester
**Path:** `/regex`  
**Features:**
- Test regex patterns
- Common patterns library
- Match highlighting

## Generators

### UUID Generator
**Path:** `/uuid`  
**Features:**
- Generate UUIDs v4
- Bulk generation (up to 100)
- Copy individual or all

### QR Code Generator
**Path:** `/qrcode`  
**Features:**
- Generate QR codes
- Download as PNG
- Text or URL input

## Utilities

### Unix Time Converter
**Path:** `/unix-time`  
**Features:**
- Unix timestamp ↔ Date
- Current timestamp
- Multiple formats

### Markdown Preview
**Path:** `/markdown`  
**Features:**
- Live preview
- CommonMark spec
- Side-by-side view

### Array Deduplicator
**Path:** `/deduplicate`  
**Features:**
- Remove duplicates
- Sort option
- Statistics

## Settings

### Feature Management
**Path:** `/settings`  
**Features:**
- Toggle features on/off
- Reset to defaults
- Feature counter
- About information

---

## Adding New Tools

To add a new tool:

1. Create component in `src/components/tools/YourTool.tsx`
2. Import in `src/App.tsx`
3. Add to `allTools` array with:
   - `path`: Route path
   - `label`: Display name
   - `icon`: Lucide icon
   - `component`: Component reference
   - `featureId`: Unique ID (kebab-case)
4. Add `featureId` to `DEFAULT_FEATURES` in `src/contexts/FeatureContext.tsx`
5. Add to `FEATURE_LIST` in `src/components/Settings.tsx`

## Shared Hooks

Tools use shared hooks in `src/hooks/` so they all behave consistently. Use them instead of
re-implementing local state + a "Process" button:

- `usePersistentState(key, initial)` — `useState` that persists to localStorage. Key format:
  `devtool:<tool>:<field>`. Keeps a tool's input across restarts.
- `useQuickPaste(onPaste)` — ⌘V / Ctrl+V pastes the clipboard straight into the tool. Also
  exports `quickPasteHint` for placeholder text.
- `useInputHistory(value, setValue)` — ⌘Z / ⌘⇧Z undo/redo on the tool's primary input.

## Tool Template

Process in real time (`useMemo`), persist the input, and wire up paste/undo:

```tsx
import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { quickPasteHint, useQuickPaste } from '@/hooks/useQuickPaste';
import { usePersistentState } from '@/hooks/usePersistentState';
import { useInputHistory } from '@/hooks/useInputHistory';

export function YourTool() {
  const [input, setInput] = usePersistentState('devtool:yourTool:input', '');
  const output = useMemo(() => input, [input]); // your transform here

  useQuickPaste(setInput);
  useInputHistory(input, setInput);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Name</CardTitle>
        <CardDescription>Tool description</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Input</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={quickPasteHint}
          />
        </div>

        {output && (
          <div className="space-y-2">
            <Label>Output</Label>
            <Textarea value={output} readOnly />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

## Design Guidelines

- Keep tools focused on one task
- Use Card components for consistency
- Process input in real time — avoid a manual "Process" button where the tool just transforms input
- Persist input with `usePersistentState`; support `useQuickPaste` + `useInputHistory`
- Add copy buttons for outputs
- Include helpful descriptions
- Handle errors gracefully
- Make it keyboard accessible
