type Snapshot = {
  id: string | null;
  playing: boolean;
  currentMs: number;
  durationMs: number;
  error: string | null;
};

const listeners = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let snapshot: Snapshot = { id: null, playing: false, currentMs: 0, durationMs: 0, error: null };

function emit(): void {
  for (const listener of listeners) listener();
}

function publish(next: Snapshot): void {
  snapshot = next;
  emit();
}

function element(): HTMLAudioElement | null {
  if (audio) return audio;
  if (typeof Audio === 'undefined') return null;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('timeupdate', () => {
    if (!snapshot.id) return;
    publish({ ...snapshot, currentMs: audio!.currentTime * 1000, durationMs: Number.isFinite(audio!.duration) ? audio!.duration * 1000 : snapshot.durationMs, playing: !audio!.paused });
  });
  audio.addEventListener('play', () => publish({ ...snapshot, playing: true, error: null }));
  audio.addEventListener('pause', () => publish({ ...snapshot, playing: false }));
  audio.addEventListener('ended', () => {
    if (audio) audio.currentTime = 0;
    publish({ ...snapshot, playing: false, currentMs: 0 });
  });
  audio.addEventListener('error', () => publish({ ...snapshot, playing: false, error: 'This recording cannot be played.' }));
  return audio;
}

export function voicePlaybackSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeVoicePlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function playVoice(id: string, url: string): Promise<void> {
  const player = element();
  if (!player) {
    publish({ ...snapshot, id, playing: false, error: 'This browser cannot play audio.' });
    return;
  }
  if (snapshot.id !== id || player.src !== url) {
    player.pause();
    player.src = url;
    publish({ id, playing: false, currentMs: 0, durationMs: 0, error: null });
  }
  try {
    await player.play();
  } catch {
    publish({ ...snapshot, id, playing: false, error: 'Playback was blocked.' });
  }
}

export function pauseVoice(id: string): void {
  if (snapshot.id !== id) return;
  audio?.pause();
}

export function seekVoice(id: string, ms: number): void {
  if (snapshot.id !== id || !audio) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration * 1000 : snapshot.durationMs;
  const next = Math.min(Math.max(0, ms), duration || ms);
  audio.currentTime = next / 1000;
  publish({ ...snapshot, currentMs: next });
}

export function stopVoice(id?: string): void {
  if (id && snapshot.id !== id) return;
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  publish({ id: null, playing: false, currentMs: 0, durationMs: 0, error: null });
}
