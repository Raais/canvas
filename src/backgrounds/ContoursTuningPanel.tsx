import { useState, type PointerEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { contoursLabDocument, type ContoursPreview, type ContoursTuning } from './contours-tuning';

const FIELDS: Array<{ key: keyof ContoursTuning; label: string; min: number; max: number; step: number; digits: number; hint: string }> = [
  { key: 'minorInterval', label: 'Minor contour spacing', min: 0.025, max: 0.2, step: 0.005, digits: 3, hint: 'Elevation between neighboring fine lines.' },
  { key: 'majorEvery', label: 'Major contour frequency', min: 2, max: 8, step: 1, digits: 0, hint: 'Every nth fine line is drawn stronger.' },
  { key: 'minorWidthPx', label: 'Minor line width', min: 0.3, max: 2, step: 0.05, digits: 2, hint: 'Width of a fine contour, in CSS pixels.' },
  { key: 'majorWidthPx', label: 'Major line width', min: 0.5, max: 3, step: 0.05, digits: 2, hint: 'Width of a major contour, in CSS pixels.' },
  { key: 'minorOpacity', label: 'Minor opacity', min: 0, max: 0.5, step: 0.01, digits: 2, hint: 'Strength of the fine contours.' },
  { key: 'majorOpacity', label: 'Major opacity', min: 0, max: 0.7, step: 0.01, digits: 2, hint: 'Strength of the major contours.' },
  { key: 'coastlineOpacity', label: 'Coastline opacity', min: 0, max: 0.5, step: 0.01, digits: 2, hint: 'Strength of the land and ocean boundary.' },
  { key: 'lodFadeStartPx', label: 'LOD fade start', min: 1, max: 5, step: 0.5, digits: 1, hint: 'Backing-pixel spacing where a line starts to fade.' },
  { key: 'lodFadeEndPx', label: 'LOD fade end', min: 2, max: 10, step: 0.5, digits: 1, hint: 'Backing-pixel spacing where a line is fully visible.' },
];

function showValue(value: number, digits: number): string {
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}

export function ContoursTuningPanel({
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
  tuning: ContoursTuning;
  preview: ContoursPreview;
  seed: number;
  title: string;
  zoom: number;
  onChange: (tuning: ContoursTuning) => void;
  onPreview: (preview: ContoursPreview) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [copyNote, setCopyNote] = useState('');

  function hold(event: PointerEvent) {
    event.stopPropagation();
  }

  async function copy() {
    const text = JSON.stringify(contoursLabDocument(tuning, { seed, title, zoom, rendererVersion: 1 }), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote('Copied');
    } catch {
      setCopyNote('Copy failed');
    }
  }

  return (
    <aside
      className="atlas-lab contours-lab nodrag nopan nowheel"
      role="dialog"
      aria-label="Contours tuning lab"
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
        <strong>Contours lab</strong>
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
        {FIELDS.map((field) => (
          <label key={field.key} title={field.hint}>
            <span>{field.label}</span>
            <b>{showValue(tuning[field.key], field.digits)}</b>
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={field.step}
              value={tuning[field.key]}
              aria-label={field.label}
              onChange={(event) => onChange({ ...tuning, [field.key]: Number(event.target.value) })}
            />
            <small>{field.hint}</small>
          </label>
        ))}
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
