import { describe, expect, it } from 'vitest';
import { parseScriptErrors } from './ResponsePanel';

describe('parseScriptErrors', () => {
  it('splits a single labelled error into label + message', () => {
    expect(parseScriptErrors('Pre-request script: TypeError: x is not a function (line 4)')).toEqual([
      { label: 'Pre-request script', message: 'TypeError: x is not a function (line 4)', jumpTab: 'script' },
    ]);
  });

  it('splits multiple \\n-joined errors into separate entries', () => {
    const joined = [
      'Post-response script: boom',
      'Inherited post-response script #2: from folder',
    ].join('\n');
    expect(parseScriptErrors(joined)).toEqual([
      { label: 'Post-response script', message: 'boom', jumpTab: 'script' },
      { label: 'Inherited post-response script #2', message: 'from folder', jumpTab: undefined },
    ]);
  });

  it('maps own-request script labels to the tab that holds them', () => {
    expect(parseScriptErrors('Test script: failed').map((e) => e.jumpTab)).toEqual(['tests']);
  });

  it('does not offer a jump for inherited (collection/folder) scripts', () => {
    expect(parseScriptErrors('Inherited pre-request script: boom')[0].jumpTab).toBeUndefined();
  });

  it('treats an unlabelled transport error as message-only', () => {
    expect(parseScriptErrors('connection refused')).toEqual([
      { label: '', message: 'connection refused' },
    ]);
  });
});
