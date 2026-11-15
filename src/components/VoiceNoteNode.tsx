import { memo, useEffect, useState, useSyncExternalStore } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';
import { Download, Mic, Pause, Play } from 'lucide-react';
import { VOICE_MIN_HEIGHT, VOICE_MIN_WIDTH } from '../domain/types';
import { formatClock } from '../domain/voice';
import { useBoardActions } from './board-context';
import { NodeDateLabel } from './NodeDateLabel';
import { PortHandles } from './PortHandles';
import { pauseVoice, seekVoice, stopVoice, subscribeVoicePlayback, voicePlaybackSnapshot } from './voice-playback';

export type VoiceNodeData = {
  title: string;
  durationMs: number;
  missing: boolean;
  readOnly: boolean;
  lastEditedAt?: string;
};

export type VoiceFlowNode = Node<VoiceNodeData, 'voice'>;

function VoiceNoteComponent({ id, data, selected }: NodeProps<VoiceFlowNode>) {
  const actions = useBoardActions();
  const [draft, setDraft] = useState<string | null>(null);
  const title = draft ?? data.title;
  const playback = useSyncExternalStore(subscribeVoicePlayback, voicePlaybackSnapshot, voicePlaybackSnapshot);
  const active = playback.id === id;
  const playing = active && playback.playing;
  const elapsed = active ? playback.currentMs : 0;
  const total = data.durationMs;

  useEffect(() => () => {
    stopVoice(id);
    actions.releaseVoice(id);
  }, [actions, id]);

  return (
    <article className={`voice-note${selected ? ' is-selected' : ''}${playing ? ' is-playing' : ''}${data.missing ? ' is-missing' : ''}`} aria-label={data.title}>
      <NodeResizer isVisible={selected} minWidth={VOICE_MIN_WIDTH} minHeight={VOICE_MIN_HEIGHT} />
      <PortHandles />
      <div className="voice-note-top">
        <Mic className="voice-note-icon" size={16} strokeWidth={1.75} />
        <input
          className="voice-title nodrag nopan"
          aria-label="Voice note title"
          value={title}
          disabled={data.readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={() => setDraft(data.title)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            actions.renameVoice(id, title);
            setDraft(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className="voice-download nodrag nopan"
          aria-label={`Download ${data.title}`}
          title="Download audio"
          disabled={data.missing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => actions.downloadVoice(id)}
        >
          <Download size={15} strokeWidth={1.75} />
        </button>
      </div>
      <div className="voice-transport nodrag nopan" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={data.missing}
          onClick={() => {
            if (data.missing) return;
            if (playing) pauseVoice(id);
            else void actions.playVoice(id);
          }}
        >
          {playing ? <Pause size={15} strokeWidth={1.75} /> : <Play size={15} strokeWidth={1.75} />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(total, 1)}
          step={1}
          value={Math.min(elapsed, total)}
          aria-label="Seek"
          disabled={data.missing}
          onChange={(event) => {
            const ms = Number(event.target.value);
            if (active) {
              seekVoice(id, ms);
              return;
            }
            void actions.playVoice(id).then(() => {
              seekVoice(id, ms);
              pauseVoice(id);
            });
          }}
        />
        <span className="voice-time">{data.missing ? 'Audio unavailable' : `${formatClock(elapsed)} / ${formatClock(total)}`}</span>
      </div>
      {active && playback.error ? <p className="voice-error">{playback.error}</p> : null}
      <NodeDateLabel iso={data.lastEditedAt} />
    </article>
  );
}

export const VoiceNoteNode = memo(VoiceNoteComponent);
