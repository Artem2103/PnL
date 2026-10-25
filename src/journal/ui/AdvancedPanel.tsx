import { useRef, useState } from 'react';
import type { StudioAspect, StudioState, StudioTrack } from '../../types';
import { ASPECTS, EXPORT_SIZE } from '../../lib/studio/frame';
import { MAX_TRACKS, type SoundSummary } from '../../lib/studio/sounds';
import { PlusIcon, TrashIcon } from './icons';

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Range({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="jx-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={Math.max(min + step, max)}
        step={step}
        value={Math.min(Math.max(value, min), max)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <b>{format(value)}</b>
    </label>
  );
}

export const secs = (v: number) => `${v.toFixed(1)} s`;
export const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The reference's "Advanced": the size of the video, and sounds of your own
 * laid under it. Nothing else — the clip itself is picked, trimmed and moved
 * on the sheet.
 */
export function AdvancedPanel({
  studio,
  total,
  sounds,
  onStudio,
  onAddSound,
  onError,
}: {
  studio: StudioState;
  /** Length of the video, seconds. */
  total: number;
  sounds: SoundSummary[];
  onStudio: (patch: Partial<StudioState>) => void;
  onAddSound: (file: File) => Promise<SoundSummary | null>;
  onError: (message: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState(false);

  const setTracks = (tracks: StudioTrack[]) => onStudio({ tracks });
  const patchTrack = (id: string, patch: Partial<StudioTrack>) =>
    setTracks(studio.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const addFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, MAX_TRACKS - studio.tracks.length);
    if (!list.length) return;
    setBusy(true);
    try {
      const added: StudioTrack[] = [];
      for (const file of list) {
        const sound = await onAddSound(file);
        if (!sound) continue;
        added.push({
          id: `${sound.id}-${Date.now().toString(36)}`,
          soundId: sound.id,
          name: sound.name,
          at: 0,
          start: 0,
          length: Math.max(0.5, Math.min(sound.duration || 10, total || sound.duration || 10)),
          volume: 0.8,
        });
      }
      setTracks([...studio.tracks, ...added]);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'That sound could not be added.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="jx-adv">
      <div className="jx-adv__sizes" role="radiogroup" aria-label="Video size">
        <strong>Resolution</strong>
        {ASPECTS.map((a) => {
          const { width, height } = EXPORT_SIZE[a.id];
          return (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={studio.aspect === a.id}
              className={`jx-adv__size${studio.aspect === a.id ? ' is-active' : ''}`}
              onClick={() => onStudio({ aspect: a.id as StudioAspect })}
            >
              <span
                className="jx-adv__shape"
                style={{ aspectRatio: `${width} / ${height}` }}
                aria-hidden="true"
              />
              <b>{a.label}</b>
              <span>
                {width}×{height}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className={`jx-adv__audio${dropping ? ' is-dropping' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          void addFiles(event.dataTransfer.files);
        }}
      >
        <div className="jx-adv__audio-head">
          <strong>
            Audio ({studio.tracks.length}/{MAX_TRACKS})
          </strong>
          <button
            type="button"
            className="jx-adv__add"
            onClick={() => fileRef.current?.click()}
            disabled={busy || studio.tracks.length >= MAX_TRACKS}
            aria-label="Add audio"
            title="Add audio"
          >
            <PlusIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"
            multiple
            hidden
            onChange={(event) => void addFiles(event.target.files)}
          />
        </div>
        {studio.tracks.length ? (
          <ul className="jx-adv__tracks">
            {studio.tracks.map((t) => {
              const full = sounds.find((s) => s.id === t.soundId)?.duration ?? t.start + t.length;
              const missing = !sounds.some((s) => s.id === t.soundId);
              return (
                <li key={t.id} className={missing ? 'is-missing' : ''}>
                  <div className="jx-adv__track-head">
                    <strong title={t.name}>{t.name}</strong>
                    <button
                      type="button"
                      className="jx-iconbtn"
                      onClick={() => setTracks(studio.tracks.filter((x) => x.id !== t.id))}
                      aria-label={`Remove ${t.name}`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  {missing ? <p className="jx-adv__hint">Not in this browser — added on another device.</p> : null}
                  <Range label="Starts at" value={t.at} min={0} max={Math.max(0.1, total)} step={0.1} format={secs} onChange={(at) => patchTrack(t.id, { at })} />
                  <Range
                    label="From"
                    value={t.start}
                    min={0}
                    max={Math.max(0.1, full - 0.5)}
                    step={0.1}
                    format={secs}
                    onChange={(start) => patchTrack(t.id, { start, length: Math.min(t.length, Math.max(0.5, full - start)) })}
                  />
                  <Range
                    label="Length"
                    value={t.length}
                    min={0.5}
                    max={Math.max(0.5, full - t.start)}
                    step={0.1}
                    format={secs}
                    onChange={(length) => patchTrack(t.id, { length })}
                  />
                  <Range label="Volume" value={t.volume} min={0} max={1} step={0.01} format={percent} onChange={(volume) => patchTrack(t.id, { volume })} />
                </li>
              );
            })}
          </ul>
        ) : (
          <button type="button" className="jx-adv__drop" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? 'Adding…' : 'Drop or add audio'}
          </button>
        )}
      </div>
    </div>
  );
}
