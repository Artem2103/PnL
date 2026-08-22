import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ImageError,
  acceptAttrFor,
  addImage,
  deleteImage,
  listImages,
  maxImagesFor,
  releaseThumbnails,
  type ImageRole,
  type MediaSummary,
} from '../lib/images';

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

export function ImagePicker({
  role,
  selectedId,
  onSelect,
  onError,
  emptyLabel,
  hint,
}: {
  role: ImageRole;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onError: (message: string) => void;
  emptyLabel: string;
  hint?: string;
}) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<MediaSummary[]>([]);

  const refresh = useCallback(async () => {
    try {
      const next = await listImages(role);
      releaseThumbnails(itemsRef.current);
      itemsRef.current = next;
      setItems(next);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not read your images.');
    }
  }, [onError, role]);

  useEffect(() => {
    void refresh();
    return () => {
      releaseThumbnails(itemsRef.current);
      itemsRef.current = [];
    };
  }, [refresh]);

  const upload = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const record = await addImage(file, role);
        await refresh();
        onSelect(record.id);
      } catch (error) {
        onError(
          error instanceof ImageError || error instanceof Error ? error.message : 'Upload failed.',
        );
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onError, onSelect, refresh, role],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteImage(id);
        if (selectedId === id) onSelect(null);
        await refresh();
      } catch {
        onError('Could not delete that image.');
      }
    },
    [onError, onSelect, refresh, selectedId],
  );

  return (
    <div className="bg-picker">
      <div
        className={`dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void upload(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttrFor(role)}
          onChange={(event) => void upload(event.target.files)}
          hidden
        />
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? 'Processing…' : 'Upload'}
        </button>
        {hint ? <p className="dropzone__hint">{hint}</p> : null}
      </div>

      <div className="bg-grid">
        <button
          type="button"
          className={`bg-tile bg-tile--none${selectedId === null ? ' is-selected' : ''}`}
          onClick={() => onSelect(null)}
          aria-pressed={selectedId === null}
        >
          <span>{emptyLabel}</span>
        </button>

        {items.map((item) => (
          <div key={item.id} className={`bg-tile${selectedId === item.id ? ' is-selected' : ''}`}>
            <button
              type="button"
              className="bg-tile__select"
              onClick={() => onSelect(item.id)}
              aria-pressed={selectedId === item.id}
              title={item.kind === 'video' ? `${item.name} · clip` : item.name}
            >
              {item.kind === 'video' ? (
                // `preload="metadata"` is enough for a poster frame and avoids
                // pulling the whole clip into memory for a thumbnail.
                <video src={item.url} muted playsInline preload="metadata" />
              ) : (
                <img src={item.url} alt="" loading="lazy" />
              )}
            </button>
            {item.kind === 'video' ? (
              <span className="bg-tile__badge">{formatDuration(item.duration) || 'clip'}</span>
            ) : null}
            <button
              type="button"
              className="bg-tile__delete"
              onClick={() => void remove(item.id)}
              aria-label={`Delete ${item.name}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <p className="muted-note">
        {items.length}/{maxImagesFor(role)} saved in this browser
      </p>
    </div>
  );
}
