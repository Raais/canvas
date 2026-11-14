import { useEffect, useRef } from 'react';
import { useViewport } from '@xyflow/react';
import { AtlasRenderer } from './atlas-renderer';
import type { AtlasTuning } from './atlas-tuning';

export default function DitherAtlasLayer({
  seed,
  appearance,
  tuning,
  onUnavailable,
}: {
  seed: number;
  appearance: 'dark' | 'light';
  tuning: AtlasTuning;
  onUnavailable: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AtlasRenderer | null>(null);
  const viewport = useViewport();
  const sceneRef = useRef({ viewport, seed, appearance, tuning });
  sceneRef.current = { viewport, seed, appearance, tuning };

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const renderer = AtlasRenderer.create(canvas, onUnavailable);
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
        devicePixelRatio: window.devicePixelRatio || 1,
        tuning: current.tuning,
      });
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(parent);
    const onVisible = () => {
      if (document.visibilityState === 'visible') renderer.redraw();
    };
    document.addEventListener('visibilitychange', onVisible);
    let media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onResolution = () => {
      media.removeEventListener('change', onResolution);
      paint();
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      media.addEventListener('change', onResolution);
    };
    media.addEventListener('change', onResolution);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      media.removeEventListener('change', onResolution);
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
      devicePixelRatio: window.devicePixelRatio || 1,
      tuning,
    });
  }, [viewport.x, viewport.y, viewport.zoom, seed, appearance, tuning]);

  return <canvas ref={canvasRef} className="dither-atlas" aria-hidden="true" />;
}
