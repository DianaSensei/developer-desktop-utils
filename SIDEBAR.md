# Collapsible Sidebar

The sidebar can now be collapsed to show only icons or expanded to show full labels.

## Features

### Expanded Mode (Default)
- **Width**: 256px (16rem)
- **Shows**: Icons + Text labels
- **Displays**: App title, version info, collapse button

### Collapsed Mode
- **Width**: 64px (4rem)
- **Shows**: Icons only
- **Displays**: Minimal UI with icons centered

## How to Use

### Desktop (≥1024px)
1. **Collapse**: Click the "Collapse" button below the header
2. **Expand**: Click the chevron-right icon at the top when collapsed
3. **Hover**: Tooltips appear on icons showing tool names

### Mobile (<1024px)
- Always shows expanded mode when opened
- Swipe/tap overlay to close

## Controls

**Expanded State:**
- Header shows: Logo + Dark mode toggle
- "Collapse" button below header
- Full text labels visible
- Version info at bottom

**Collapsed State:**
- Only dark mode toggle in header (desktop)
- All icons centered
- Tooltips on hover
- No text labels
- No version info

## Keyboard Navigation

- Click any icon to navigate
- Settings always accessible at bottom
- Active page highlighted

## Persistence

Your sidebar preference is saved in localStorage:
- Key: `devtool-sidebar-collapsed`
- Persists across sessions
- Per-device setting

## Visual Design

**Collapsed (64px):**
```
┌────┐
│ 🌙 │  Dark mode toggle
├────┤
│ 📅 │  Tool icons (centered)
│ 📝 │
│ 🔐 │
│ ... │
├────┤
│ ⚙️  │  Settings
└────┘
```

**Expanded (256px):**
```
┌──────────────────┐
│ DevTool      🌙  │  Header + dark mode
├──────────────────┤
│   ◀ Collapse     │  Collapse button
├──────────────────┤
│ 📅 Cron Generator│  Tools with labels
│ 📝 Text Transform│
│ 🔐 Base64        │
│ ...              │
├──────────────────┤
│ ⚙️  Settings     │  Settings
├──────────────────┤
│ v0.1.0           │  Version info
└──────────────────┘
```

## Benefits

✅ **Save screen space** - collapsed mode gives more room for content  
✅ **Quick access** - icons always visible  
✅ **Flexible** - toggle based on workflow  
✅ **Tooltips** - hover to see tool names when collapsed  
✅ **Persistent** - remembers your preference  
✅ **Smooth animations** - 300ms transitions  

## Implementation Details

**State Management:**
- React state hook for collapse state
- localStorage for persistence
- Prop drilling to Sidebar component

**Styling:**
- Tailwind classes for responsive widths
- CSS transitions for smooth collapse/expand
- Dynamic padding and gaps based on state

**Accessibility:**
- Title attributes on collapsed icons
- ARIA-friendly button controls
- Keyboard navigation maintained
