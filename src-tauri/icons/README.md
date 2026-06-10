# Icons

You'll need to generate icons for the Tauri application. You can use the Tauri icon generator or provide your own icons in the following formats:

Required icon files:
- 32x32.png
- 128x128.png
- 128x128@2x.png
- icon.icns (macOS)
- icon.ico (Windows)

## Using Tauri Icon Generator

You can use the `tauri icon` command to generate all required icon formats from a single source image:

```bash
npm install -g @tauri-apps/cli
tauri icon path/to/your/icon.png
```

The source icon should be at least 512x512 pixels, preferably 1024x1024 PNG with transparency.

## Temporary Solution

For development, you can create simple placeholder icons or the app will use default Tauri icons.
