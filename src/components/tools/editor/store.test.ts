import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { createMemoryFs, DEMO_ROOT, type MemoryFs } from './memoryFs';
import { EditorStore, type StorageLike } from './store';

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
