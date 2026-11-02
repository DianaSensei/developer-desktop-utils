// One glyph per kind of file, monochrome like the rest of the app (the icon
// says *what* a file is; color is reserved for state).

import {
  Braces, File, FileArchive, FileCode2, FileCog, FileImage, FileLock2, FileSpreadsheet, FileTerminal,
  FileText, FileType2, Folder, FolderOpen, type LucideIcon,
} from 'lucide-react';
import { basename, extname } from './paths';

const BY_EXT: Record<string, LucideIcon> = {};
const add = (icon: LucideIcon, exts: string[]) => { for (const e of exts) BY_EXT[e] = icon; };

add(FileCode2, [
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'py', 'rb', 'rs', 'go', 'java', 'kt', 'kts', 'scala',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'cs', 'swift', 'php', 'lua', 'dart', 'vue', 'svelte', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'sql', 'r', 'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'elm', 'zig', 'nim', 'wasm', 'wat',
]);
add(Braces, ['json', 'jsonc', 'json5', 'geojson']);
add(FileCog, ['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'properties', 'env', 'xml', 'plist', 'editorconfig']);
add(FileTerminal, ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd']);
add(FileText, ['md', 'mdx', 'markdown', 'txt', 'rst', 'adoc', 'log', 'rtf']);
add(FileImage, ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif', 'tif', 'tiff']);
add(FileArchive, ['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'jar']);
add(FileSpreadsheet, ['csv', 'tsv', 'xls', 'xlsx', 'ods']);
add(FileType2, ['ttf', 'otf', 'woff', 'woff2']);
add(FileLock2, ['lock', 'pem', 'key', 'crt', 'cer', 'p12', 'pfx']);

const BY_NAME: Record<string, LucideIcon> = {
  dockerfile: FileCog,
  makefile: FileTerminal,
  '.gitignore': FileCog,
  '.gitattributes': FileCog,
  '.npmrc': FileCog,
  'package-lock.json': FileLock2,
  'cargo.lock': FileLock2,
  'yarn.lock': FileLock2,
  license: FileText,
};

export function fileIcon(path: string): LucideIcon {
  const name = basename(path).toLowerCase();
  return BY_NAME[name] ?? BY_EXT[extname(name)] ?? File;
}

export function folderIcon(open: boolean): LucideIcon {
  return open ? FolderOpen : Folder;
}
