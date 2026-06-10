# DevTool - Developer Utilities

A modern, cross-platform desktop application built with Tauri, React, and TypeScript, providing essential developer utilities in a clean and functional interface.

## Features

- **Cron Generator** - Create cron expressions with presets
- **Text Transformer** - Convert text between single line, multiple lines, and arrays
- **Base64 Encoder/Decoder** - Encode and decode Base64 strings
- **Hash & Encrypt** - Generate MD5, SHA-1, SHA-256, SHA-512 hashes and AES encryption
- **Unix Time Converter** - Convert between Unix timestamps and human-readable dates
- **JSON Formatter** - Format, minify, and validate JSON
- **JWT Debugger** - Decode and inspect JWT tokens
- **Regex Tester** - Test regular expressions with common patterns
- **URL Encoder/Decoder** - Encode and decode URL strings
- **UUID Generator** - Generate UUIDs (v4)
- **Text Diff** - Compare two texts and visualize differences
- **QR Code Generator** - Generate QR codes from text or URLs
- **Markdown Preview** - Write and preview Markdown in real-time
- **Array Deduplicator** - Remove duplicate items from arrays

## Tech Stack

- **Tauri** - Lightweight desktop framework (Rust backend)
- **React** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool
- **Tailwind CSS** - Utility-first CSS
- **shadcn/ui** - Beautiful, accessible components
- **React Router** - Client-side routing

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Rust and Cargo (for Tauri)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Run in development mode:
```bash
npm run tauri:dev
```

3. Build for production:
```bash
npm run tauri:build
```

## Development

- `npm run dev` - Start Vite dev server
- `npm run build` - Build for production
- `npm run tauri:dev` - Run Tauri in development mode
- `npm run tauri:build` - Build Tauri application

## Architecture

The app follows a modular architecture where each utility is a self-contained component:

```
src/
├── components/
│   ├── ui/           # Reusable UI components (shadcn/ui)
│   └── tools/        # Utility tool components
├── lib/              # Utility functions
├── styles/           # Global styles
└── App.tsx           # Main app with routing
```

### Adding New Tools

To add a new utility tool:

1. Create a new component in `src/components/tools/YourTool.tsx`
2. Import and register it in `src/App.tsx`:

```tsx
import { YourTool } from '@/components/tools/YourTool';

const tools = [
  // ... existing tools
  { path: '/your-tool', label: 'Your Tool', icon: YourIcon, component: YourTool },
];
```

## Design Principles

- **Clean UI/UX** - Intuitive interface with clear actions
- **Functional** - Each tool does one thing well
- **Scalable** - Easy to add new utilities
- **Responsive** - Works on different screen sizes
- **Accessible** - Built with accessibility in mind

## License

MIT
