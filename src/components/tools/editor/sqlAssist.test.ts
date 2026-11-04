import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { sql, MySQL } from '@codemirror/lang-sql';
import { ensureSyntaxTree } from '@codemirror/language';
import { insertColumnHints, sqlMarks, tokenizeSql } from './sqlAssist';

/** Hints as `column@first-token-of-the-value` for readable assertions. */
function hints(src: string) {
  return insertColumnHints(src).map((h) => `${h.column}@${/^(?:'(?:[^']|'')*'|[\w@.]+|\()/.exec(src.slice(h.pos))?.[0]}`);
}

describe('tokenizeSql', () => {
  it('skips comments and keeps strings and quoted names whole', () => {
    const toks = tokenizeSql("SELECT 'a, b' -- x, y\n, `my col` /* , */ FROM t # z");
    expect(toks.map((t) => t.text)).toEqual(['SELECT', "'a, b'", ',', '`my col`', 'FROM', 't']);
  });

  it('handles doubled and escaped quotes', () => {
    expect(tokenizeSql("'it''s' 'a\\'b' x").map((t) => t.text)).toEqual(["'it''s'", "'a\\'b'", 'x']);
  });
});

describe('insertColumnHints', () => {
  it('maps INSERT … SELECT values to their columns, skipping values that already name them', () => {
    const src = `INSERT INTO db.user_wallet
  (user_wallet_id, wallet_id, user_id, currency, balance, lock_version, hash)
SELECT t.user_wallet_id, @wallet_id, t.owner_id, t.currency, t.balance, 0,
       SHA2(CONCAT_WS('|', t.a, t.b), 256)
FROM target t;`;
    expect(hints(src)).toEqual(['user_id@t.owner_id', 'lock_version@0', 'hash@SHA2']);
  });

  it('maps every VALUES row', () => {
    const src = "INSERT INTO t (id, name, note) VALUES (1, 'a', NULL), (2, 'b, c', 'x');";
    expect(hints(src)).toEqual(['id@1', "name@'a'", 'note@NULL', 'id@2', "name@'b, c'", "note@'x'"]);
  });

  it('stops the SELECT list at FROM / WHERE and ignores nested subqueries', () => {
    const src = 'INSERT INTO t (a, b) SELECT (SELECT max(x) FROM y), 2 FROM z WHERE q = 1, 3';
    expect(hints(src)).toEqual(['a@(', 'b@2']);
  });

  it('understands modifiers and quoted table names', () => {
    expect(hints('INSERT IGNORE INTO `s`.`t` (`a`) VALUES (5)')).toEqual(['a@5']);
    expect(hints('INSERT OR REPLACE INTO t (a) VALUES (5)')).toEqual(['a@5']);
  });

  it('gives nothing without a column list, and ignores REPLACE() the function', () => {
    expect(hints('INSERT INTO t VALUES (1, 2)')).toEqual([]);
    expect(hints("SELECT REPLACE(a, 'x', 'y') FROM t")).toEqual([]);
  });

  it('matches `AS name` and is case-insensitive', () => {
    expect(hints('insert into t (Total) select sum(x) as total from y')).toEqual([]);
  });
});

describe('sqlMarks', () => {
  it('marks function calls and types in SQL only', () => {
    const doc = "SELECT SUM(x), CAST(y AS CHAR), CONCAT_WS('|', z), w IN(1) FROM t";
    const view = new EditorView({ state: EditorState.create({ doc, extensions: [sql({ dialect: MySQL })] }) });
    ensureSyntaxTree(view.state, doc.length, 5000);
    const marked: string[] = [];
    sqlMarks(view).between(0, doc.length, (from, to, deco) => {
      marked.push(`${deco.spec.class}:${doc.slice(from, to)}`);
    });
    expect(marked).toEqual(['cm-sql-fn:SUM', 'cm-sql-fn:CAST', 'cm-sql-type:CHAR', 'cm-sql-fn:CONCAT_WS']);
    view.destroy();

    const plain = new EditorView({ state: EditorState.create({ doc }) });
    expect(sqlMarks(plain).size).toBe(0);
    plain.destroy();
  });
});
