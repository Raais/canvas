import { VOICE_MAX_MS } from './types';
import { canonicalAudioMime } from './voice';

export type CapturePhase = 'idle' | 'requesting-permission' | 'recording' | 'stopping' | 'ready' | 'error';

export type CaptureEffect = 'request-mic' | 'start-recorder' | 'stop-recorder' | 'release-tracks';

export type CaptureState = {
  phase: CapturePhase;
  token: number;
  error: string | null;
  mimeType: string | null;
  durationMs: number;
  byteSize: number;
  overBytes: boolean;
};

export type CaptureEvent =
  | { type: 'start' }
  | { type: 'granted'; token: number; mimeType: string }
  | { type: 'denied'; token: number; message: string }
  | { type: 'unavailable'; token: number; message: string }
  | { type: 'cancel'; token: number }
  | { type: 'stop'; token: number }
  | { type: 'chunk'; token: number; bytes: number }
  | { type: 'limit-time'; token: number }
  | { type: 'recorder-error'; token: number; message: string }
  | { type: 'stream-ended'; token: number }
  | { type: 'finalized'; token: number; byteSize: number; mimeType: string; durationMs: number }
  | { type: 'discard' }
  | { type: 'interrupt' };

export function initialCaptureState(): CaptureState {
  return { phase: 'idle', token: 0, error: null, mimeType: null, durationMs: 0, byteSize: 0, overBytes: false };
}

export function reduceCapture(state: CaptureState, event: CaptureEvent, maxBytes: number): { state: CaptureState; effects: CaptureEffect[] } {
  if (event.type === 'start') {
    if (state.phase === 'requesting-permission' || state.phase === 'recording' || state.phase === 'stopping') {
      return { state, effects: [] };
    }
    return {
      state: { ...initialCaptureState(), phase: 'requesting-permission', token: state.token + 1 },
      effects: ['request-mic'],
    };
  }
  if (event.type === 'discard') {
    if (state.phase !== 'ready' && state.phase !== 'error') return { state, effects: [] };
    return { state: { ...initialCaptureState(), token: state.token }, effects: [] };
  }
  if (event.type === 'interrupt' || (event.type === 'cancel' && event.token === state.token)) {
    if (state.phase === 'idle') return { state, effects: [] };
    const effects: CaptureEffect[] = state.phase === 'recording' || state.phase === 'stopping' ? ['stop-recorder', 'release-tracks'] : [];
    return { state: { ...initialCaptureState(), token: state.token + 1 }, effects };
  }
  if ('token' in event && event.token !== state.token) {
    return { state, effects: event.type === 'granted' ? ['release-tracks'] : [] };
  }
  if (event.type === 'granted') {
    if (state.phase !== 'requesting-permission') return { state, effects: ['release-tracks'] };
    return { state: { ...state, phase: 'recording', mimeType: event.mimeType, error: null }, effects: ['start-recorder'] };
  }
  if (event.type === 'denied' || event.type === 'unavailable') {
    if (state.phase !== 'requesting-permission') return { state, effects: [] };
    return { state: { ...state, phase: 'error', error: event.message }, effects: [] };
  }
  if (event.type === 'stop' || event.type === 'limit-time' || event.type === 'stream-ended') {
    if (state.phase !== 'recording') return { state, effects: [] };
    return { state: { ...state, phase: 'stopping' }, effects: ['stop-recorder'] };
  }
  if (event.type === 'chunk') {
    if (state.phase !== 'recording' && state.phase !== 'stopping') return { state, effects: [] };
    const byteSize = state.byteSize + Math.max(0, event.bytes);
    const overBytes = byteSize > maxBytes;
    if (state.phase === 'recording' && overBytes) {
      return { state: { ...state, byteSize, overBytes, phase: 'stopping' }, effects: ['stop-recorder'] };
    }
    return { state: { ...state, byteSize, overBytes }, effects: [] };
  }
  if (event.type === 'recorder-error') {
    if (state.phase === 'idle' || state.phase === 'ready') return { state, effects: [] };
    const effects: CaptureEffect[] = state.phase === 'recording' || state.phase === 'stopping' ? ['stop-recorder', 'release-tracks'] : ['release-tracks'];
    return {
      state: { ...initialCaptureState(), token: state.token + 1, phase: 'error', error: event.message },
      effects,
    };
  }
  if (event.type === 'finalized') {
    if (state.phase !== 'stopping' && state.phase !== 'recording') return { state, effects: [] };
    const mimeType = canonicalAudioMime(event.mimeType);
    const durationMs = Math.min(VOICE_MAX_MS, Math.round(event.durationMs));
    const byteSize = event.byteSize;
    if (!mimeType) {
      return { state: { ...state, phase: 'error', error: 'This browser produced an audio format that cannot be saved.', byteSize, mimeType: null }, effects: ['release-tracks'] };
    }
    if (byteSize <= 0 || state.overBytes || byteSize > maxBytes) {
      return { state: { ...state, phase: 'error', error: byteSize <= 0 ? 'The recording was empty.' : 'The recording is too large to keep.', byteSize, mimeType }, effects: ['release-tracks'] };
    }
    if (durationMs < 1) {
      return { state: { ...state, phase: 'error', error: 'The recording was empty.', byteSize, mimeType }, effects: ['release-tracks'] };
    }
    return { state: { ...state, phase: 'ready', mimeType, durationMs, byteSize, error: null }, effects: ['release-tracks'] };
  }
  return { state, effects: [] };
}

export type CaptureStream = {
  getTracks: () => { readyState: string; stop: () => void; addEventListener?: (type: 'ended', listener: () => void) => void }[];
};

export type CaptureRecorder = {
  state: string;
  mimeType: string;
  start: (timeslice?: number) => void;
  stop: () => void;
  addEventListener: (type: 'dataavailable' | 'stop' | 'error', listener: (event: { data?: Blob }) => void) => void;
};

export type VoiceCaptureDeps = {
  getUserMedia?: (constraints: { audio: boolean }) => Promise<CaptureStream>;
  createRecorder: (stream: CaptureStream, mimeType: string | undefined) => CaptureRecorder;
  now: () => number;
  isTypeSupported: (mime: string) => boolean;
  preferredMime: (isTypeSupported: (mime: string) => boolean) => string | undefined;
  maxDurationMs: number;
  maxBytes: number;
};

export class VoiceCapture {
  private state: CaptureState = initialCaptureState();
  private stream: CaptureStream | null = null;
  private recorder: CaptureRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stopRequested = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: VoiceCaptureDeps) {}

  snapshot(): CaptureState {
    return this.state;
  }

  elapsed(): number {
    if (this.state.phase === 'recording' || this.state.phase === 'stopping') {
      return Math.min(this.deps.maxDurationMs, Math.max(0, Math.round(this.deps.now() - this.startedAt)));
    }
    return this.state.durationMs;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    const next = reduceCapture(this.state, { type: 'start' }, this.deps.maxBytes);
    this.commit(next);
    if (!next.effects.includes('request-mic')) return;
    const token = next.state.token;
    const request = this.deps.getUserMedia;
    if (!request) {
      this.commit(reduceCapture(this.state, { type: 'unavailable', token, message: 'This browser cannot record audio.' }, this.deps.maxBytes));
      return;
    }
    void request({ audio: true }).then(
      (stream) => {
        if (this.state.token !== token || this.state.phase !== 'requesting-permission') {
          stopStream(stream);
          return;
        }
        this.stream = stream;
        let recorder: CaptureRecorder;
        try {
          recorder = this.deps.createRecorder(stream, this.deps.preferredMime(this.deps.isTypeSupported));
        } catch {
          this.fail(token, 'Recording could not start.');
          return;
        }
        this.recorder = recorder;
        this.chunks = [];
        this.stopRequested = false;
        this.startedAt = this.deps.now();
        const mimeType = canonicalAudioMime(recorder.mimeType) ?? recorder.mimeType;
        const started = reduceCapture(this.state, { type: 'granted', token, mimeType }, this.deps.maxBytes);
        this.commit(started);
        if (started.state.phase !== 'recording') {
          this.release();
          return;
        }
        recorder.addEventListener('dataavailable', (event) => {
          const size = event.data?.size ?? 0;
          if (event.data && size > 0) this.chunks.push(event.data);
          const reduced = reduceCapture(this.state, { type: 'chunk', token, bytes: size }, this.deps.maxBytes);
          this.commit(reduced);
          if (reduced.effects.includes('stop-recorder')) this.stopRecorder();
        });
        recorder.addEventListener('stop', () => {
          const blob = new Blob(this.chunks, { type: recorder.mimeType || this.state.mimeType || '' });
          const reduced = reduceCapture(this.state, {
            type: 'finalized',
            token,
            byteSize: blob.size,
            mimeType: blob.type || recorder.mimeType,
            durationMs: Math.max(0, this.deps.now() - this.startedAt),
          }, this.deps.maxBytes);
          this.blob = reduced.state.phase === 'ready' ? blob : null;
          this.commit(reduced);
        });
        recorder.addEventListener('error', () => {
          this.fail(token, 'Recording stopped because the microphone failed.');
        });
        try {
          recorder.start(1000);
        } catch {
          this.fail(token, 'Recording could not start.');
          return;
        }
        for (const track of stream.getTracks()) {
          track.addEventListener?.('ended', () => {
            if (this.state.token === token) this.noteStreamEnded();
          });
        }
      },
      (error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        const message = name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone permission was denied.'
          : name === 'NotFoundError'
            ? 'No microphone is available.'
            : 'The microphone could not be opened.';
        this.commit(reduceCapture(this.state, { type: 'denied', token, message }, this.deps.maxBytes));
      },
    );
  }

  private blob: Blob | null = null;

  stop(): void {
    const next = reduceCapture(this.state, { type: 'stop', token: this.state.token }, this.deps.maxBytes);
    this.commit(next);
    if (next.effects.includes('stop-recorder')) this.stopRecorder();
  }

  cancel(): void {
    this.finishEarly('cancel');
  }

  interrupt(): void {
    this.finishEarly('interrupt');
  }

  discard(): void {
    this.blob = null;
    this.commit(reduceCapture(this.state, { type: 'discard' }, this.deps.maxBytes));
  }

  enforceTimeLimit(): void {
    if (this.state.phase !== 'recording') return;
    if (this.deps.now() - this.startedAt < this.deps.maxDurationMs) return;
    const next = reduceCapture(this.state, { type: 'limit-time', token: this.state.token }, this.deps.maxBytes);
    this.commit(next);
    if (next.effects.includes('stop-recorder')) this.stopRecorder();
  }

  noteStreamEnded(): void {
    const next = reduceCapture(this.state, { type: 'stream-ended', token: this.state.token }, this.deps.maxBytes);
    this.commit(next);
    if (next.effects.includes('stop-recorder')) this.stopRecorder();
  }

  recording(): { blob: Blob; mimeType: string; durationMs: number } | null {
    if (this.state.phase !== 'ready' || !this.blob || !this.state.mimeType) return null;
    return { blob: this.blob, mimeType: this.state.mimeType, durationMs: this.state.durationMs };
  }

  private finishEarly(type: 'cancel' | 'interrupt'): void {
    const next = type === 'cancel'
      ? reduceCapture(this.state, { type: 'cancel', token: this.state.token }, this.deps.maxBytes)
      : reduceCapture(this.state, { type: 'interrupt' }, this.deps.maxBytes);
    this.blob = null;
    this.apply(next);
  }

  private fail(token: number, message: string): void {
    this.blob = null;
    this.apply(reduceCapture(this.state, { type: 'recorder-error', token, message }, this.deps.maxBytes));
  }

  private stopRecorder(): void {
    if (this.stopRequested) return;
    const recorder = this.recorder;
    if (!recorder || recorder.state === 'inactive') return;
    this.stopRequested = true;
    try {
      recorder.stop();
    } catch {
      this.fail(this.state.token, 'Recording could not be saved.');
    }
  }

  private release(): void {
    stopStream(this.stream);
    this.stream = null;
  }

  private commit(next: { state: CaptureState; effects: CaptureEffect[] }): void {
    this.apply(next);
  }

  private apply(next: { state: CaptureState; effects: CaptureEffect[] }): void {
    this.state = next.state;
    for (const effect of next.effects) {
      if (effect === 'stop-recorder') this.stopRecorder();
      else if (effect === 'release-tracks') this.release();
    }
    for (const listener of this.listeners) listener();
  }
}

function stopStream(stream: CaptureStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}
