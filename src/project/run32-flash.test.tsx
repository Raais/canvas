import './happy-dom-setup';
import { act, Suspense, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, test } from 'bun:test';
import { PdfPageFrame } from '../components/PdfPageFrame';

function SuspendingPage(): ReactNode {
  throw new Promise(() => undefined);
}

function ViewerShell({ pages }: { pages: number[] }) {
  return (
    <div className="pdf-viewer" data-viewer="">
      <div className="pdf-toolbar">Scroll</div>
      <div className="pdf-stage" data-stage="">
        <div className="pdf-scroll">
          {pages.map((page) => (
            <div key={page} className="pdf-sheet" data-pdf-page={page} style={{ top: page * 320, height: 300 }}>
              <PdfPageFrame width={220} height={300} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

describe('pdf page loading stays inside the viewer', () => {
  test('a suspending page replaces the outer viewer, and a paper frame does not', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(
        <Suspense fallback={<div data-fallback="">Opening PDF…</div>}>
          <div className="pdf-viewer"><SuspendingPage /></div>
        </Suspense>,
      );
    });
    expect(host.querySelector('[data-fallback]') !== null).toBe(true);
    expect(host.querySelector('.pdf-viewer')).toBeNull();

    await act(async () => {
      root.render(
        <Suspense fallback={<div data-fallback="">Opening PDF…</div>}>
          <ViewerShell pages={[1, 2, 3]} />
        </Suspense>,
      );
    });
    const stage = host.querySelector('[data-stage]');
    expect(host.querySelector('[data-fallback]')).toBeNull();
    expect(host.querySelector('.pdf-toolbar') !== null).toBe(true);
    expect(stage !== null).toBe(true);
    const paper = host.querySelector('[data-pdf-paper]') as HTMLElement | null;
    expect(paper !== null).toBe(true);
    expect(paper?.style.width).toBe('220px');
    expect(paper?.style.height).toBe('300px');
    const background = getComputedStyle(paper as Element).backgroundColor;
    expect(background === '#fff' || background === 'rgb(255, 255, 255)').toBe(true);
    expect(host.querySelectorAll('[data-pdf-page]').length <= 8).toBe(true);

    await act(async () => {
      root.render(
        <Suspense fallback={<div data-fallback="">Opening PDF…</div>}>
          <ViewerShell pages={[8, 9, 10]} />
        </Suspense>,
      );
    });
    expect(host.querySelector('[data-stage]')).toBe(stage);
    expect(host.querySelector('[data-fallback]')).toBeNull();
    expect(host.querySelector('[data-pdf-page="1"]')).toBeNull();
    expect(host.querySelector('[data-pdf-page="9"]') !== null).toBe(true);
    root.unmount();
    host.remove();
  });

  test('switching the visible window does not reset the shell', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    function Harness() {
      const [pages, setPages] = useState([1, 2]);
      return (
        <Suspense fallback={<div data-fallback="">Opening PDF…</div>}>
          <button type="button" onClick={() => setPages([14, 15, 16])}>Advance</button>
          <ViewerShell pages={pages} />
        </Suspense>
      );
    }
    await act(async () => {
      root.render(<Harness />);
    });
    const viewer = host.querySelector('[data-viewer]');
    const stage = host.querySelector('[data-stage]');
    const button = host.querySelector('button');
    if (!button) throw new Error('missing advance button');
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('[data-viewer]')).toBe(viewer);
    expect(host.querySelector('[data-stage]')).toBe(stage);
    expect(host.querySelector('[data-fallback]')).toBeNull();
    expect(host.querySelector('[data-pdf-page="15"]') !== null).toBe(true);
    root.unmount();
    host.remove();
  });
});
