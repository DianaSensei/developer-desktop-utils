# Feature Toggle System

The app now includes a feature toggle system that allows you to enable/disable individual tools.

## How It Works

### Settings Page

Access the Settings page by:
- Clicking the **Settings** button at the bottom of the sidebar
- Navigating to `/settings` route

### Feature Controls

In the Settings page, you can:
- **Toggle individual features** on/off using the switches
- **See enabled feature count** at the top
- **Reset to defaults** using the "Reset to Defaults" button

### Behavior

- **Enabled features**: Appear in the sidebar and are accessible
- **Disabled features**: Hidden from the sidebar but routes still work if accessed directly
- **Persistent**: Your preferences are saved in localStorage and persist across sessions
- **Default state**: All features are enabled by default

## Implementation Details

### Files Created

1. **`src/contexts/FeatureContext.tsx`** - React Context for managing feature state
2. **`src/components/Settings.tsx`** - Settings page component with toggle switches

### Files Modified

1. **`src/App.tsx`** - Integrated FeatureProvider and Settings route

### Features List

All 14 tools can be toggled:
- Cron Generator
- Text Transformer
- Base64 Encoder/Decoder
- Hash & Encrypt
- Unix Time Converter
- JSON Formatter
- JWT Debugger
- Regex Tester
- URL Encoder/Decoder
- UUID Generator
- Text Diff
- QR Code Generator
- Markdown Preview
- Array Deduplicator

## Usage

### For Users

1. Open the app
2. Click **Settings** in the sidebar
3. Toggle any feature on/off
4. The sidebar updates immediately
5. Changes are saved automatically

### For Developers

To add a new feature:

1. Add the feature ID to `DEFAULT_FEATURES` in `FeatureContext.tsx`
2. Add the feature to `FEATURE_LIST` in `Settings.tsx`
3. Add the tool with `featureId` to `allTools` in `App.tsx`

Example:
```tsx
// In App.tsx
{ 
  path: '/new-tool', 
  label: 'New Tool', 
  icon: NewIcon, 
  component: NewTool, 
  featureId: 'new-tool' 
}
```

## Storage

Settings are stored in `localStorage` under the key `devtool-features`.

Format:
```json
{
  "cron-generator": true,
  "base64": false,
  "json": true,
  ...
}
```

## Benefits

✅ Customize your workflow by hiding unused tools  
✅ Reduce sidebar clutter  
✅ Focus on tools you use most  
✅ Easy to experiment - just toggle back on  
✅ Persistent across sessions  
