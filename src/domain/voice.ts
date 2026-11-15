import { ARCHIVE_LIMITS } from '../archive/format';
import { EMBEDDED_ASSET_BUDGET } from '../ingest/admission';
import { VOICE_MAX_MS, VOICE_TITLE_LIMIT } from './types';

const AUDIO_BASES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/x-m4a'] as const;

const RECORDER_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function canonicalAudioMime(value: string): string | null {
  const mime = value.trim().toLowerCase();
  if (!mime || mime.length > 127) return null;
  const [base, params] = mime.split(';', 2).map((part) => part.trim());
  if (!base || !AUDIO_BASES.includes(base as (typeof AUDIO_BASES)[number])) return null;
  if (!params) return base;
  if (!params.startsWith('codecs=')) return null;
  const codec = params.slice('codecs='.length).replace(/^"|"$/g, '');
  if (!/^[a-z0-9._+-]+$/i.test(codec)) return null;
  return `${base};codecs=${codec.toLowerCase()}`;
}

export function preferredRecorderMime(isTypeSupported: (mime: string) => boolean): string | undefined {
  for (const candidate of RECORDER_CANDIDATES) {
    if (isTypeSupported(candidate)) return candidate;
  }
  return undefined;
}

export function audioExtension(mimeType: string): string {
  const base = canonicalAudioMime(mimeType)?.split(';', 1)[0];
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mpeg') return 'mp3';
  if (base === 'audio/wav') return 'wav';
  if (base === 'audio/webm') return 'webm';
  return 'm4a';
}

export function audioFilename(title: string, mimeType: string): string {
  const cleaned = title
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${cleaned || 'voice-note'}.${audioExtension(mimeType)}`;
}

export function defaultVoiceTitle(now: Date): string {
  const month = MONTHS[now.getMonth()] ?? 'Jan';
  return `Voice note · ${month} ${now.getDate()}, ${now.getFullYear()}`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function voiceTitleProblem(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > VOICE_TITLE_LIMIT) return 'Give the voice note a shorter title.';
  if (trimmed !== title) return 'The title cannot start or end with a space.';
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 32 || code === 127) return 'The title contains a character that cannot be saved.';
  }
  return null;
}

export function voiceDurationProblem(durationMs: number): string | null {
  if (!Number.isInteger(durationMs) || durationMs < 1 || durationMs > VOICE_MAX_MS) return 'That recording has an invalid length.';
  return null;
}

export function voiceSaveProblem(existingBytes: number, nextBytes: number): string | null {
  if (!Number.isFinite(nextBytes) || nextBytes <= 0) return 'The recording was empty.';
  if (nextBytes > ARCHIVE_LIMITS.maxFileBytes) return 'The recording is too large to keep.';
  if (existingBytes + nextBytes > EMBEDDED_ASSET_BUDGET) return 'This board does not have room for that recording.';
  return null;
}

export function recordingSupport(target: {
  isSecureContext?: boolean;
  mediaDevices?: { getUserMedia?: unknown };
  MediaRecorder?: unknown;
} | null): { ok: true } | { ok: false; message: string } {
  if (!target) return { ok: false, message: 'Recording is unavailable.' };
  if (target.isSecureContext === false) return { ok: false, message: 'Recording needs a secure page.' };
  if (typeof target.mediaDevices?.getUserMedia !== 'function' || typeof target.MediaRecorder !== 'function') {
    return { ok: false, message: 'This browser cannot record audio.' };
  }
  return { ok: true };
}
