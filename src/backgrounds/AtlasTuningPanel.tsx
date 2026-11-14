import { useState, type PointerEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { atlasLabDocument, type AtlasPreview, type AtlasTuning } from './atlas-tuning';

const FIELDS: Array<{ key: keyof AtlasTuning; label: string; min: number; max: number; step: number; hint: string; smoothOnly?: boolean }> = [
  { key: 'largeScale', label: 'Large noise scale', min: 250, max: 2500, step: 10, hint: 'Size of the broad landmasses.' },
  { key: 'mediumScale', label: 'Medium noise scale', min: 80, max: 1200, step: 10, hint: 'Size of the secondary shapes.' },
  { key: 'detailScale', label: 'Detail noise scale', min: 20, max: 450, step: 5, hint: 'Size of the fine shoreline detail.' },
  { key: 'largeWeight', label: 'Large noise weight', min: 0, max: 1, step: 0.01, hint: 'How much the broad shapes contribute.' },
  { key: 'mediumWeight', label: 'Medium noise weight', min: 0, max: 1, step: 0.01, hint: 'How much the secondary shapes contribute.' },
  { key: 'detailWeight', label: 'Detail noise weight', min: 0, max: 1, step: 0.01, hint: 'How much the fine detail contributes.' },
  { key: 'densityLow', label: 'Density lower threshold', min: -0.8, max: 0.3, step: 0.01, hint: 'Where empty space begins.' },
  { key: 'densityHigh', label: 'Density upper threshold', min: 0, max: 0.9, step: 0.01, hint: 'Where dense land begins.' },
  { key: 'cellSize', label: 'Dither cell size', min: 1, max: 32, step: 1, hint: 'World size of one dither cell at normal zoom.' },
  { key: 'smoothFadeStart', label: 'Smooth fade start', min: 0.2, max: 3, step: 0.1, hint: 'Cell size, in pixels, where Smooth dither starts fading.', smoothOnly: true },
  { key: 'smoothFadeEnd', label: 'Smooth fade end', min: 0.5, max: 6, step: 0.1, hint: 'Cell size, in pixels, where Smooth dither is fully visible.', smoothOnly: true },
  { key: 'adaptiveTargetPixels', label: 'Adaptive target pixels', min: 1, max: 6, step: 0.25, hint: 'Desired visible pixel size when zoomed out.' },
  { key: 'inkStrength', label: 'Ink strength', min: 0, max: 1, step: 0.01, hint: 'Contrast of the terrain against the canvas.' },
];

function showValue(value: number, step: number): string {
  return step < 1 ? value.toFixed(2) : String(Math.round(value));
}

export function AtlasTuningPanel({
  tuning,
  preview,
  seed,
  title,
  zoom,
  onChange,
  onPreview,
  onReset,
  onClose,
}: {
  tuning: AtlasTuning;
  preview: AtlasPreview;
  seed: number;
  title: string;
  zoom: number;
  onChange: (tuning: AtlasTuning) => void;
  onPreview: (preview: AtlasPreview) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [copyNote, setCopyNote] = useState('');

  function hold(event: PointerEvent) {
    event.stopPropagation();
  }

  async function copy() {
    const text = JSON.stringify(atlasLabDocument(tuning, { seed, title, zoom, rendererVersion: 1 }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy failed');
    }
  }

  return (
    <aside
      className="atlas-lab nodrag nopan nowheel"
      role="dialog"
      aria-label="Dither Atlas tuning lab"
      onPointerDown={hold}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <SlidersHorizontal size={15} strokeWidth={1.75} />
        <strong>Atlas lab</strong>
        <button type="button" onClick={onClose}>Close</button>
      </header>
      <div className="atlas-lab-scroll">
        <section>
          <p>Preview</p>
          <div className="atlas-segment" role="group" aria-label="Preview">
            {(['original', 'experimental'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={preview === mode} onClick={() => onPreview(mode)}>
                {mode === 'original' ? 'Original' : 'Experimental'}
              </button>
            ))}
          </div>
        </section>
        <section>
          <p>Dithering</p>
          <div className="atlas-segment" role="group" aria-label="Dither mode">
            {(['smooth', 'adaptive'] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={tuning.ditherMode === mode} onClick={() => onChange({ ...tuning, ditherMode: mode })}>
                {mode === 'smooth' ? 'Smooth' : 'Adaptive'}
              </button>
            ))}
          </div>
        </section>
        {tuning.largeWeight + tuning.mediumWeight + tuning.detailWeight <= 0 ? <small>All weights are zero, so the renderer uses an equal split.</small> : null}
        {FIELDS.map((field) => {
          const disabled = Boolean(field.smoothOnly && tuning.ditherMode === 'adaptive');
          const value = tuning[field.key];
          return (
            <label key={field.key} className={disabled ? 'is-disabled' : ''} title={field.hint}>
              <span>{field.label}</span>
              <b>{showValue(Number(value), field.step)}{field.key === 'adaptiveTargetPixels' ? ' px' : ''}</b>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={Number(value)}
                disabled={disabled}
                aria-label={field.label}
                onChange={(event) => onChange({ ...tuning, [field.key]: Number(event.target.value) })}
              />
              <small>{field.hint}</small>
            </label>
          );
        })}
        <section className="atlas-lab-actions">
          <button type="button" onClick={onReset}>Reset to defaults</button>
          <button type="button" onClick={() => void copy()}>Copy configuration</button>
          <small>{copyNote || 'Experimental values are not saved with the project.'}</small>
          <small>Seed {seed} · zoom {zoom.toFixed(2)} · renderer 1</small>
        </section>
      </div>
    </aside>
  );
}
