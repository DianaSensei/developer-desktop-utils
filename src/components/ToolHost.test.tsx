import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { storageRemove } from '@/lib/persistentStore';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { WorkspaceProvider } from '@/contexts/WorkspaceContext';
import { SplitViewProvider } from '@/contexts/SplitViewContext';
import { useToolActiveRef } from '@/contexts/ToolActivityContext';
import { ToolHeaderActions } from './ToolHeaderActions';
import { SplitToggle, ToolHost, type HostedTool } from './ToolHost';

/** A tool with throwaway state (a counter), a window shortcut and a header action. */
function makeTool(name: string, keyLog: string[]) {
  return function FakeTool() {
    const [count, setCount] = useState(0);
    const [params] = useSearchParams();
    const activeRef = useToolActiveRef();
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (activeRef.current && e.key === 'F9') keyLog.push(name);
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [activeRef]);
    return (
      <div>
        <button type="button" onClick={() => setCount((c) => c + 1)}>{`${name} clicks ${count}`}</button>
        <span>{`${name} tab=${params.get('tab') ?? ''}`}</span>
        <ToolHeaderActions><span>{`${name} action`}</span></ToolHeaderActions>
      </div>
    );
  };
}

const keyLog: string[] = [];
const TOOLS: HostedTool[] = [
  { featureId: 'json', label: 'JSON Formatter', path: '/json', component: makeTool('json', keyLog), fullHeight: true },
  { featureId: 'unix-time', label: 'Date / Time', path: '/unix-time', component: makeTool('time', keyLog), fullHeight: true },
  { featureId: 'base64', label: 'Encode', path: '/base64', component: makeTool('b64', keyLog), fullHeight: true },
];

function Where() {
  const l = useLocation();
  return <span data-testid="path">{l.pathname + l.search}</span>;
}

function Harness() {
  return (
    <MemoryRouter initialEntries={['/json']}>
      <LocaleProvider>
        <FeatureProvider>
          <WorkspaceProvider>
            <SplitViewProvider>
              <div id="tool-header-actions" data-testid="header" />
              <Link to="/json">go json</Link>
              <Link to="/unix-time">go time</Link>
              <Link to="/base64?tab=jwt">go b64 jwt</Link>
              <Link to="/base64">go b64</Link>
              <SplitToggle />
              <Where />
              <ToolHost tools={TOOLS} fallback={<span>redirect</span>} />
            </SplitViewProvider>
          </WorkspaceProvider>
        </FeatureProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

const path = () => screen.getByTestId('path').textContent;

beforeEach(() => {
  for (const k of ['devtool-workspaces', 'devtool-split-view', 'devtool-recent-tools']) storageRemove(k);
  keyLog.length = 0;
});
afterEach(() => cleanup());

describe('ToolHost — keep alive', () => {
  it('a tab keeps its state when you switch away and back', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('json clicks 0'));
    fireEvent.click(screen.getByText('go time'));
    expect(screen.getByText('json clicks 1').closest('section')!.className).toContain('hidden');
    fireEvent.click(screen.getByText('go json'));
    expect(screen.getByText('json clicks 1')).toBeTruthy();
  });

  it('only the tool in front gets window shortcuts and the header slot', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('go time'));
    fireEvent.keyDown(window, { key: 'F9' });
    expect(keyLog).toEqual(['time']);
    expect(within(screen.getByTestId('header')).getByText('time action')).toBeTruthy();
    expect(within(screen.getByTestId('header')).queryByText('json action')).toBeNull();
  });

  it('a background tool keeps its own URL, and comes back with its query', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('go b64 jwt'));
    expect(screen.getByText('b64 tab=jwt')).toBeTruthy();
    fireEvent.click(screen.getByText('go json'));
    // Still reads its own ?tab while hidden.
    expect(screen.getByText('b64 tab=jwt')).toBeTruthy();
    fireEvent.click(screen.getByText('go b64'));
    expect(path()).toBe('/base64?tab=jwt');
  });

  it('a path that is no tool falls through to the redirects', () => {
    render(
      <MemoryRouter initialEntries={['/nope']}>
        <LocaleProvider><FeatureProvider><WorkspaceProvider><SplitViewProvider>
          <ToolHost tools={TOOLS} fallback={<span>redirect</span>} />
        </SplitViewProvider></WorkspaceProvider></FeatureProvider></LocaleProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('redirect')).toBeTruthy();
  });
});

describe('ToolHost — split view', () => {
  it('⌘\\ / Ctrl+\\ shows the last used tab beside this one; focus follows the click', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('go time'));
    fireEvent.keyDown(window, { code: 'Backslash', key: '\\', ctrlKey: true });
    const left = document.querySelector('[data-tool-pane="left"]')!;
    const right = document.querySelector('[data-tool-pane="right"]')!;
    expect(within(left as HTMLElement).getByText(/time clicks/)).toBeTruthy();
    expect(within(right as HTMLElement).getByText(/json clicks/)).toBeTruthy();
    expect(path()).toBe('/json');
    fireEvent.keyDown(window, { key: 'F9' });
    expect(keyLog).toEqual(['json']);

    fireEvent.pointerDown(left);
    expect(path()).toBe('/unix-time');
    fireEvent.keyDown(window, { key: 'F9' });
    expect(keyLog).toEqual(['json', 'time']);
    // Both stay mounted and visible: no state lost.
    fireEvent.click(within(right as HTMLElement).getByText('json clicks 0'));
    expect(within(right as HTMLElement).getByText('json clicks 1')).toBeTruthy();
  });

  it('opening another tool replaces the focused pane only; the header button closes the split', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('go time'));
    fireEvent.click(screen.getByText('go b64'));
    fireEvent.click(screen.getByRole('button', { name: 'Split view' }));
    // Right pane = last used other tab (time), focused.
    expect(within(document.querySelector('[data-tool-pane="right"]') as HTMLElement).getByText(/time clicks/)).toBeTruthy();
    fireEvent.click(screen.getByText('go json'));
    expect(within(document.querySelector('[data-tool-pane="right"]') as HTMLElement).getByText(/json clicks/)).toBeTruthy();
    expect(within(document.querySelector('[data-tool-pane="left"]') as HTMLElement).getByText(/b64 clicks/)).toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close split view' })); });
    expect(document.querySelector('[data-tool-pane="right"]')).toBeNull();
    expect(path()).toBe('/json');
  });
});
