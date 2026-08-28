import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CodeViewer, type CodeViewerHandle } from './code-viewer';

// CodeMirror mounts its own DOM inside the container, so these assert against
// the rendered `.cm-search` panel (see @codemirror/search's own class name)
// rather than any React-visible state — `openSearch` is an imperative escape
// hatch precisely because there's nothing else to hook into from outside.
describe('CodeViewer — openSearch', () => {
  it('opens the find panel for a normal (syntax-highlighted) viewer', () => {
    const ref = createRef<CodeViewerHandle>();
    const { container } = render(<CodeViewer ref={ref} value={'{"a":1}'} language="json" />);
    expect(container.querySelector('.cm-search')).toBeNull();

    ref.current?.openSearch();

    expect(container.querySelector('.cm-search')).not.toBeNull();
  });

  it('opens the find panel for a plain (large-body) viewer too', () => {
    // minimalSetup (used when `plain`) doesn't carry searchKeymap the way
    // basicSetup does — this is the gap that made Ctrl+F silently do nothing
    // on a large response before `keymap.of(searchKeymap)` was added for it.
    const ref = createRef<CodeViewerHandle>();
    const { container } = render(<CodeViewer ref={ref} value="hello world, findme" language="text" plain />);

    ref.current?.openSearch();

    expect(container.querySelector('.cm-search')).not.toBeNull();
  });
});
