import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  ImageError,
  acceptAttrFor,
  addMedia,
  deleteMedia,
  listMedia,
  maxImagesFor,
  releaseThumbnails,
  type ImageRole,
  type MediaSummary,
} from '../lib/library';
import { useAuth } from '../lib/auth';

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function ImagePickerView({
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
  // `userId`, not `user?.id`: with no Supabase credentials there is no `user`
  // at all, and reading the id off it left this whole picker keyed on the empty
  // string, so every refresh and every upload returned early and the library
  // was silently dead.
  const { userId: owner, mode, librarySyncedAt } = useAuth();
  const userId = owner ?? '';
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<MediaSummary[]>([]);
  // Read through a ref: the host may pass a new function on every render, and
  // `refresh` depending on it re-listed the library each time, which revoked
  // every thumbnail's URL and flashed the tiles black.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const listed = await listMedia(role, userId);
      // A tile already showing keeps its URL, so a refresh repaints nothing.
      const shown = new Map(itemsRef.current.filter((item) => !item.remoteOnly).map((item) => [item.id, item]));
      const replaced: MediaSummary[] = [];
      const next = listed.map((item) => {
        const old = shown.get(item.id);
        if (!old || item.remoteOnly) return item;
        shown.delete(item.id);
        replaced.push(item);
        return { ...item, url: old.url, posterUrl: old.posterUrl };
      });
      releaseThumbnails(replaced);
      releaseThumbnails([...shown.values()]);
      releaseThumbnails(itemsRef.current.filter((item) => item.remoteOnly));
      itemsRef.current = next;
      setItems(next);
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : 'Could not read your images.');
    }
  }, [role, userId]);

  // `librarySyncedAt` moves when the account's manifest has been pulled, which
  // is what turns files uploaded on another device into tiles here.
  useEffect(() => {
    void refresh();
    return () => {
      releaseThumbnails(itemsRef.current);
      itemsRef.current = [];
    };
  }, [librarySyncedAt, refresh]);

  const upload = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!userId) return;
      setBusy(true);
      try {
        // Resolves once the file is in this browser; the upload to the account
        // finishes after, and `refresh` clears the tile's "saving" badge.
        const record = await addMedia(file, role, userId, (uploadError) => {
          if (uploadError) onErrorRef.current(uploadError.message);
          void refresh();
        });
        await refresh();
        onSelect(record.id);
      } catch (error) {
        onErrorRef.current(
          error instanceof ImageError || error instanceof Error ? error.message : 'Upload failed.',
        );
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onSelect, refresh, role, userId],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteMedia(id);
        if (selectedId === id) onSelect(null);
        await refresh();
      } catch (error) {
        onErrorRef.current(error instanceof Error ? error.message : 'Could not delete that image.');
      }
    },
    [onSelect, refresh, selectedId],
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
              {item.kind === 'video' && !item.posterUrl ? (
                // Only clips saved before poster stills existed land here.
                // `preload="metadata"` is enough for a first frame and avoids
                // pulling the whole file into memory for a thumbnail.
                <video src={item.url} muted playsInline preload="metadata" />
              ) : (
                <img src={item.posterUrl ?? item.url} alt="" loading="lazy" decoding="async" />
              )}
            </button>
            {item.kind === 'video' ? (
              <span className="bg-tile__badge">{formatDuration(item.duration) || 'clip'}</span>
            ) : null}
            {item.pending ? (
              <span className="bg-tile__badge bg-tile__badge--sync" title="Saving to your account">
                Saving…
              </span>
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
        {items.length}/{maxImagesFor(role)}{' '}
        {mode === 'local' ? 'saved in this browser' : 'saved to your account'}
      </p>
    </div>
  );
}

/**
 * Memoised: the editor re-renders on every keystroke and every slider tick,
 * and this subtree carries the media thumbnails. Its props are stable, so a
 * change to the numbers on the card never touches it.
 */
export const ImagePicker = memo(ImagePickerView);
