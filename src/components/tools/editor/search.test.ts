import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { createMemoryFs, DEMO_ROOT, type MemoryFs } from './memoryFs';
import { EditorStore, type StorageLike } from './store';
import { SearchSession } from './search';

const R = DEMO_ROOT;

function memStorage(): StorageLike {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

let fs: MemoryFs;
let store: EditorStore;
let view: EditorView;
let search: SearchSession;

beforeEach(async () => {
  fs = createMemoryFs({
    authorised: [R],
    files: {
      'a.sql': 'SELECT user_id FROM wallet;\n-- user_id again\n',
      'src/b.ts': 'const userId = 1;\nconst user_id = 2;\n',
      'build/out.js': 'user_id',
      'node_modules/x/i.js': 'user_id',
      '.gitignore': 'build/\n',
    },
  });
  const storage = memStorage();
  store = new EditorStore(fs, storage);
  view = new EditorView({ state: EditorState.create({ doc: '' }), parent: document.body.appendChild(document.createElement('div')) });
  store.attachView(view);
  await store.hydrate();
  await store.addFolder(R);
  search = new SearchSession(store, storage);
});

afterEach(() => {
  store.attachView(null);
  view.destroy();
});

async function find(query: string) {
  search.setQuery(query);
  await search.run();
  return search.getSnapshot();
}

describe('SearchSession', () => {
  it('searches every opened folder, skipping node_modules and .gitignore entries', async () => {
    const s = await find('user_id');
    expect(s.status).toBe('done');
    expect(s.result!.files.map((f) => f.rel)).toEqual(['a.sql', 'src/b.ts']);
    expect(s.result!.matchCount).toBe(3);
  });

  it('applies options and file filters', async () => {
    search.setOptions({ caseSensitive: true });
    expect((await find('USER_ID')).result!.matchCount).toBe(0);
    search.setOptions({ caseSensitive: false, details: true, include: '*.ts' });
    expect((await find('user_id')).result!.files.map((f) => f.rel)).toEqual(['src/b.ts']);
    search.setOptions({ include: '', useIgnoreFiles: false, exclude: 'src' });
    expect((await find('user_id')).result!.files.map((f) => f.rel)).toEqual(['a.sql', 'build/out.js']);
  });

  it('reports an invalid regex instead of searching', async () => {
    search.setOptions({ regex: true });
    const s = await find('(');
    expect(s.status).toBe('error');
    expect(s.error).toBeTruthy();
  });

  it('searches unsaved tabs as they are on screen', async () => {
    await store.openFile(`${R}/src/b.ts`);
    view.dispatch({ changes: { from: 0, insert: 'user_id; ' } });
    const s = await find('user_id');
    const b = s.result!.files.find((f) => f.rel === 'src/b.ts')!;
    expect(b.matches.map((m) => m.line)).toEqual([1, 2]);
  });

  it('opens a result with the match selected', async () => {
    const s = await find('wallet');
    const f = s.result!.files[0];
    const hit = f.matches[0];
    await store.openAt(f.path, hit.line, hit.column, hit.length);
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe('wallet');
  });

  it('replaces in open tabs (unsaved) and on disk for the rest', async () => {
    await store.openFile(`${R}/a.sql`);
    await find('user_id');
    search.setReplace('account_id');
    const summary = await search.replace();
    expect(summary).toEqual({ occurrences: 3, files: 2, failed: [] });
    // Open tab: changed in the editor, not on disk yet.
    expect(view.state.doc.toString()).toContain('SELECT account_id');
    expect((await fs.readFile(`${R}/a.sql`)).content).toContain('SELECT user_id');
    expect(store.getSnapshot().tabs.find((t) => t.path === `${R}/a.sql`)!.dirty).toBe(true);
    // Closed file: written.
    expect((await fs.readFile(`${R}/src/b.ts`)).content).toBe('const userId = 1;\nconst account_id = 2;\n');
    // Results refresh after replacing.
    expect(search.getSnapshot().result!.matchCount).toBe(0);
  });

  it('dismisses a file or a single line from the results', async () => {
    await find('user_id');
    search.dismiss(`${R}/a.sql`, 2, 3);
    expect(search.getSnapshot().result!.matchCount).toBe(2);
    search.dismiss(`${R}/src/b.ts`);
    expect(search.getSnapshot().result!.files.map((f) => f.rel)).toEqual(['a.sql']);
  });
});
