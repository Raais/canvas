import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { AtlasRenderer } from './atlas-renderer';

export default function DitherAtlasLayer({
  seed,
  appearance,
  onUnavailable,
}: {
  seed: number;
  appearance: 'dark' | 'light';
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AtlasRenderer | null>(null);
  const viewport = useViewport();
  const sceneRef = useRef({ viewport, seed, appearance });
  sceneRef.current = { viewport, seed, appearance };

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const renderer = AtlasRenderer.create(canvas);
    if (!renderer) {
      onUnavailable();
      return;
    }
    rendererRef.current = renderer;
    const paint = () => {
      const current = sceneRef.current;
      const rect = parent.getBoundingClientRect();
      renderer.setScene({
        viewport: current.viewport,
        cssWidth: Math.max(1, rect.width),
        cssHeight: Math.max(1, rect.height),
        seed: current.seed,
        appearance: current.appearance,
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(parent);
    const onVisible = () => {
      if (document.visibilityState === 'visible') renderer.redraw();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [onUnavailable]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const parent = canvasRef.current?.parentElement;
    if (!renderer || !parent) return;
    const rect = parent.getBoundingClientRect();
    renderer.setScene({
      viewport,
      cssWidth: Math.max(1, rect.width),
      cssHeight: Math.max(1, rect.height),
      seed,
      appearance,
    });
  }, [viewport.x, viewport.y, viewport.zoom, seed, appearance]);

  return <canvas ref={canvasRef} className="dither-atlas" aria-hidden="true" />;
}
