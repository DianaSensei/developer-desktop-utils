import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { createMemoryFs, DEMO_ROOT, type MemoryFs } from './memoryFs';
import { EditorStore, suggestFileName, type StorageLike } from './store';

const R = DEMO_ROOT;

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}

let fs: MemoryFs;
let storage: ReturnType<typeof memStorage>;
let store: EditorStore;
let view: EditorView;

function makeStore() {
  const s = new EditorStore(fs, storage);
  view = new EditorView({ state: EditorState.create({ doc: '' }), parent: document.body.appendChild(document.createElement('div')) });
  s.attachView(view);
  return s;
}

function type(text: string) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
}

beforeEach(async () => {
  fs = createMemoryFs({
    files: { 'a.txt': 'alpha\n', 'src/main.ts': 'let x = 1;\n', 'win.txt': 'one\r\ntwo\r\n' },
  });
  storage = memStorage();
  store = makeStore();
  await store.hydrate();
});

afterEach(() => {
  store.attachView(null);
  view.destroy();
  document.body.innerHTML = '';
});

const snap = () => store.getSnapshot();
const activeTab = () => store.tab(snap().activeId)!;

describe('EditorStore — folders and tree', () => {
  it('starts empty and lists a picked folder, folders first', async () => {
    expect(snap().folders).toEqual([]);
    await store.openFolder();
    expect(snap().folders).toEqual([R]);
    expect(snap().dirs[R].entries!.map((e) => e.name)).toEqual(['src', 'a.txt', 'win.txt']);
  });

  it('remembers folders, tabs and the active tab across a restart', async () => {
    await store.openFolder();
    await store.openFile(`${R}/a.txt`);
    await store.openFile(`${R}/src/main.ts`);
    store.activate(snap().tabs[0].id);
    store.flushPersist();

    const again = makeStore();
    await again.hydrate();
    expect(again.getSnapshot().folders).toEqual([R]);
    expect(again.getSnapshot().tabs.map((t) => t.name)).toEqual(['a.txt', 'main.ts']);
    expect(again.tab(again.getSnapshot().activeId)?.name).toBe('a.txt');
  });

  it('drops a remembered folder that is no longer authorised', async () => {
    await store.openFolder();
    store.flushPersist();
    await fs.forgetRoot(R);
    const again = makeStore();
    await again.hydrate();
    expect(again.getSnapshot().folders).toEqual([]);
  });
});

describe('EditorStore — editing and saving', () => {
  beforeEach(async () => { await store.openFolder(); });

  it('opens a file into the view and tracks dirty against the saved text', async () => {
    await store.openFile(`${R}/a.txt`);
    expect(activeTab().status).toBe('ready');
    expect(view.state.doc.toString()).toBe('alpha\n');
    type('beta');
    expect(activeTab().dirty).toBe(true);
    // Typing back to the saved text is clean again, as in VS Code.
    view.dispatch({ changes: { from: 6, to: 10, insert: '' } });
    expect(activeTab().dirty).toBe(false);
  });

  it('saves to disk and keeps CRLF line endings', async () => {
    await store.openFile(`${R}/win.txt`);
    expect(activeTab().eol).toBe('\r\n');
    type('three');
    expect(await store.save(activeTab().id)).toBe('saved');
    expect((await fs.readFile(`${R}/win.txt`)).content).toBe('one\r\ntwo\r\nthree');
    expect(activeTab().dirty).toBe(false);
  });

  it('reports a conflict when the file changed on disk, and Overwrite forces it', async () => {
    await store.openFile(`${R}/a.txt`);
    type('mine');
    fs.touch(`${R}/a.txt`, 'theirs');
    expect(await store.save(activeTab().id)).toBe('conflict');
    expect((await fs.readFile(`${R}/a.txt`)).content).toBe('theirs');
    expect(await store.save(activeTab().id, true)).toBe('saved');
    expect((await fs.readFile(`${R}/a.txt`)).content).toBe('alpha\nmine');
  });

  it('reloads a clean tab silently and flags a dirty one on external change', async () => {
    await store.openFile(`${R}/a.txt`);
    fs.touch(`${R}/a.txt`, 'changed');
    await store.checkTab(activeTab().id);
    expect(view.state.doc.toString()).toBe('changed');
    expect(activeTab().external).toBeNull();

    type('!');
    fs.touch(`${R}/a.txt`, 'changed again');
    await store.checkTab(activeTab().id);
    expect(activeTab().external).toBe('changed');
    expect(view.state.doc.toString()).toBe('changed!');
  });

  it('keeps each tab\'s own document when switching', async () => {
    await store.openFile(`${R}/a.txt`);
    type('A');
    await store.openFile(`${R}/src/main.ts`);
    expect(view.state.doc.toString()).toBe('let x = 1;\n');
    store.activate(snap().tabs[0].id);
    expect(view.state.doc.toString()).toBe('alpha\nA');
    expect(snap().tabs[0].dirty).toBe(true);
    expect(snap().tabs[1].dirty).toBe(false);
  });

  it('closing the active tab activates its right neighbour, else the left', async () => {
    await store.openFile(`${R}/a.txt`);
    await store.openFile(`${R}/src/main.ts`);
    await store.openFile(`${R}/win.txt`);
    const [a, b, c] = snap().tabs;
    store.activate(b.id);
    store.closeTab(b.id);
    expect(snap().activeId).toBe(c.id);
    store.closeTab(c.id);
    expect(snap().activeId).toBe(a.id);
  });
});

describe('EditorStore — file operations', () => {
  beforeEach(async () => { await store.openFolder(); });

  it('creates nested files, expands the way there and opens the file', async () => {
    const path = await store.create(R, 'docs/guide/intro.md', 'file');
    expect(path).toBe(`${R}/docs/guide/intro.md`);
    expect(snap().expanded[`${R}/docs`]).toBe(true);
    expect(snap().expanded[`${R}/docs/guide`]).toBe(true);
    expect(activeTab().path).toBe(path);
  });

  it('a failed create shows a notice instead of throwing', async () => {
    expect(await store.create(R, 'a.txt', 'file')).toBeNull();
    expect(snap().notice?.code).toBe('exists');
  });

  it('renaming a folder re-points its open tabs', async () => {
    await store.openFile(`${R}/src/main.ts`);
    expect(await store.rename(`${R}/src`, 'lib')).toBe(true);
    expect(activeTab().path).toBe(`${R}/lib/main.ts`);
    type('// still editable');
    expect(await store.save(activeTab().id)).toBe('saved');
    expect(fs.has(`${R}/lib/main.ts`)).toBe(true);
  });

  it('moves via cut and paste', async () => {
    await store.create(R, 'dest', 'dir');
    store.markCut(`${R}/a.txt`);
    await store.paste(`${R}/dest`);
    expect(fs.has(`${R}/dest/a.txt`)).toBe(true);
    expect(fs.has(`${R}/a.txt`)).toBe(false);
    expect(snap().cut).toBeNull();
  });

  it('deleting a folder closes the tabs inside it', async () => {
    await store.openFile(`${R}/src/main.ts`);
    await store.remove(`${R}/src`);
    expect(snap().tabs).toEqual([]);
    expect(fs.has(`${R}/src`)).toBe(false);
  });

  it('the workspace folder itself cannot be deleted', async () => {
    await expect(store.remove(R)).rejects.toMatchObject({ code: 'root' });
  });

  it('Quick Open lists every file in the open folders', async () => {
    const { files } = await store.allFiles();
    expect(files.map((f) => f.rel)).toEqual(['a.txt', 'src/main.ts', 'win.txt']);
  });
});

describe('EditorStore — untitled tabs (hot exit)', () => {
  const docOf = (id: string) => store.currentState(id)!.doc.toString();

  it('opens without any folder, is named after its first line, and is backed up', async () => {
    const id = store.newUntitled();
    expect(activeTab().kind).toBe('untitled');
    expect(activeTab().name).toBe('Untitled-1');
    type('\n  shopping list  \nmilk');
    expect(activeTab().name).toBe('shopping list');
    expect(activeTab().dirty).toBe(true);
    await store.flushBackups();
    const key = activeTab().path.replace('untitled:', '');
    expect(await fs.backups.read(key)).toBe('\n  shopping list  \nmilk');
    expect(docOf(id)).toContain('milk');
  });

  it('numbers untitled tabs with the lowest free number', () => {
    store.newUntitled();
    store.newUntitled();
    expect(snap().tabs.map((t) => t.name)).toEqual(['Untitled-1', 'Untitled-2']);
    store.closeTab(snap().tabs[0].id);
    store.newUntitled();
    expect(snap().tabs.map((t) => t.name).sort()).toEqual(['Untitled-1', 'Untitled-2']);
  });

  it('comes back with its text after a restart, in tab order', async () => {
    await store.openFolder();
    store.newUntitled('first draft');
    await store.openFile(`${R}/a.txt`);
    store.newUntitled('second draft');
    store.flushPersist();
    await store.flushBackups();

    const again = makeStore();
    await again.hydrate();
    const tabs = again.getSnapshot().tabs;
    expect(tabs.map((t) => t.name)).toEqual(['first draft', 'a.txt', 'second draft']);
    expect(again.tab(again.getSnapshot().activeId)?.name).toBe('second draft');
    expect(view.state.doc.toString()).toBe('second draft');
  });

  it('closing one with text keeps it under Recently Closed and offers Restore', async () => {
    store.newUntitled('keep me');
    const key = activeTab().path.replace('untitled:', '');
    store.closeTab(activeTab().id);
    expect(snap().tabs).toEqual([]);
    expect(snap().closed[0]).toMatchObject({ kind: 'untitled', key, name: 'keep me' });
    expect(snap().notice).toMatchObject({ code: 'closedUntitled', restoreKey: key });

    await store.reopenClosed(key);
    expect(activeTab().name).toBe('keep me');
    expect(view.state.doc.toString()).toBe('keep me');
    expect(snap().closed).toEqual([]);
  });

  it('an empty one is simply discarded', () => {
    store.newUntitled();
    store.closeTab(activeTab().id);
    expect(snap().closed).toEqual([]);
    expect(snap().notice).toBeNull();
  });

  it('Recently Closed survives a restart and can still be restored', async () => {
    store.newUntitled('closed before quitting');
    store.closeTab(activeTab().id);
    store.flushPersist();

    const again = makeStore();
    await again.hydrate();
    expect(again.getSnapshot().closed.map((c) => c.name)).toEqual(['closed before quitting']);
    await again.reopenClosed();
    expect(view.state.doc.toString()).toBe('closed before quitting');
  });

  it('⌘⇧T also reopens closed file tabs', async () => {
    await store.openFolder();
    await store.openFile(`${R}/a.txt`);
    store.closeTab(activeTab().id);
    await store.reopenClosed();
    expect(activeTab().path).toBe(`${R}/a.txt`);
  });

  it('discard and clear delete the backups; orphans are cleaned up on start', async () => {
    store.newUntitled('one');
    store.closeTab(activeTab().id);
    store.newUntitled('two');
    store.closeTab(activeTab().id);
    const [two, one] = snap().closed;
    store.discardClosed(two.key);
    expect(await fs.backups.read(two.key)).toBeNull();
    store.clearClosed();
    expect(await fs.backups.read(one.key)).toBeNull();

    await fs.backups.write('orphan', 'left behind');
    const again = makeStore();
    await again.hydrate();
    await Promise.resolve();
    expect(await fs.backups.list()).toEqual([]);
  });

  it('Save As turns it into a normal file tab and drops the backup', async () => {
    await store.openFolder();
    store.newUntitled('notes body');
    const key = activeTab().path.replace('untitled:', '');
    await store.flushBackups();
    expect(await store.save(activeTab().id)).toBe('saved');
    expect(activeTab()).toMatchObject({ kind: 'file', path: `${R}/notes body.txt`, name: 'notes body.txt', dirty: false });
    expect((await fs.readFile(`${R}/notes body.txt`)).content).toBe('notes body');
    expect(await fs.backups.read(key)).toBeNull();

    type('!');
    expect(await store.save(activeTab().id)).toBe('saved');
    expect((await fs.readFile(`${R}/notes body.txt`)).content).toBe('notes body!');
    // Closing it now is an ordinary file close (no Recently Closed text).
    store.closeTab(activeTab().id);
    expect(snap().closed[0]).toMatchObject({ kind: 'file' });
  });
});

describe('suggestFileName', () => {
  it('uses the first line, strips path characters, adds .txt', () => {
    expect(suggestFileName({ kind: 'untitled', name: 'a/b: c?' })).toBe('a b c.txt');
    expect(suggestFileName({ kind: 'untitled', name: 'query.sql' })).toBe('query.sql');
    expect(suggestFileName({ kind: 'untitled', name: 'Untitled-3' })).toBe('Untitled-3.txt');
    expect(suggestFileName({ kind: 'file', name: 'x.ts' })).toBe('x.ts');
  });
});
