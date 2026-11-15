import { Mic } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ARCHIVE_LIMITS } from '../archive/format';
import { VoiceCapture } from '../domain/voice-capture';
import { VOICE_MAX_MS } from '../domain/types';
import { canonicalAudioMime, defaultVoiceTitle, formatClock, preferredRecorderMime, recordingSupport, voiceTitleProblem } from '../domain/voice';

export type SavedVoice = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  title: string;
};

export function VoiceRecorderDialog({
  now = new Date(),
  onCancel,
  onSave,
}: {
  now?: Date;
  onCancel: () => void;
  onSave: (recording: SavedVoice) => string | null;
}) {
  const [capture] = useState(() => new VoiceCapture({
    getUserMedia: typeof navigator !== 'undefined' ? navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices) : undefined,
    createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined),
    now: () => performance.now(),
    isTypeSupported: (mime) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime),
    preferredMime: preferredRecorderMime,
    maxDurationMs: VOICE_MAX_MS,
    maxBytes: ARCHIVE_LIMITS.maxFileBytes,
  }));
  const [state, setState] = useState(() => capture.snapshot());
  const [title, setTitle] = useState(() => defaultVoiceTitle(now));
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const support = recordingSupport(typeof window === 'undefined' ? null : {
    isSecureContext: window.isSecureContext,
    mediaDevices: navigator.mediaDevices,
    MediaRecorder,
  });

  useEffect(() => capture.subscribe(() => setState(capture.snapshot())), [capture]);

  useEffect(() => {
    const recording = capture.recording();
    if (state.phase !== 'ready' || !recording) {
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      return;
    }
    const url = URL.createObjectURL(recording.blob);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return url;
    });
    return () => URL.revokeObjectURL(url);
  }, [capture, state.phase, state.byteSize]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      capture.enforceTimeLimit();
      setTick((value) => value + 1);
    }, 200);
    const close = () => capture.interrupt();
    window.addEventListener('pagehide', close);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', close);
      capture.interrupt();
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
    };
  }, [capture]);

  const titleProblem = voiceTitleProblem(title);
  void tick;

  return (
    <div className="password-layer">
      <form
        className="password-dialog voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="New voice note"
        onSubmit={(event) => {
          event.preventDefault();
          const recording = capture.recording();
          if (!recording || titleProblem) return;
          const mimeType = canonicalAudioMime(recording.mimeType);
          if (!mimeType) {
            setSaveError('This recording uses an unsupported audio format.');
            return;
          }
          const problem = onSave({ ...recording, mimeType, title });
          if (problem) setSaveError(problem);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== 'Escape') return;
          event.preventDefault();
          capture.cancel();
          onCancel();
        }}
      >
        <p className="menu-label"><Mic size={15} strokeWidth={1.75} /> New voice note</p>
        <p className="voice-privacy">Audio is stored on this device.</p>
        {support.ok ? null : <p className="voice-error">{support.message}</p>}
        {state.error ? <p className="voice-error">{state.error}</p> : null}
        {saveError ? <p className="voice-error">{saveError}</p> : null}
        {state.phase === 'recording' || state.phase === 'stopping' ? (
          <p className="voice-live" role="status">{state.phase === 'recording' ? 'Recording' : 'Finishing'} · {formatClock(capture.elapsed())}</p>
        ) : null}
        {state.phase === 'ready' ? (
          <>
            <label>
              Title
              <input aria-label="Recording title" value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <p className="voice-privacy">{formatClock(state.durationMs)}</p>
            {previewUrl ? <audio className="voice-preview" controls src={previewUrl} preload="metadata" /> : null}
          </>
        ) : null}
        <div className="voice-dialog-actions">
          {state.phase === 'idle' || state.phase === 'error' ? (
            <button type="button" disabled={!support.ok} onClick={() => { setSaveError(null); capture.start(); }}>Start recording</button>
          ) : null}
          {state.phase === 'requesting-permission' ? <button type="button" disabled>Waiting for microphone…</button> : null}
          {state.phase === 'recording' ? <button type="button" onClick={() => capture.stop()}>Stop recording</button> : null}
          {state.phase === 'stopping' ? <button type="button" disabled>Stopping…</button> : null}
          {state.phase === 'ready' ? <button type="submit" disabled={Boolean(titleProblem)}>Save to canvas</button> : null}
          <button
            type="button"
            onClick={() => {
              if (state.phase === 'ready' || state.phase === 'recording' || state.phase === 'stopping') capture.cancel();
              else capture.discard();
              onCancel();
            }}
          >
            {state.phase === 'ready' || state.phase === 'recording' ? 'Discard' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  );
}
