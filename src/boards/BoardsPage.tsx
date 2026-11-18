import { useCallback, useEffect, useMemo, useState } from 'react';
import { ProfileMenu } from '../components/ProfileMenu';
import { SiteNav } from '../components/SiteNav';
import { ThemeMenu } from '../components/ThemeMenu';
import { useAuth } from '../lib/auth';
import { STUDIO_PATH, navigate, setAfterSignIn } from '../lib/route';
import { AdminPanel } from './AdminPanel';
import { BoardCanvas } from './BoardCanvas';
import { demoBoard } from './demo';
import { layoutBoard } from './model';
import { PositionViewer } from './PositionViewer';
import { hasPositions, isBoardAdmin, loadBoard, toBoard, type BoardSource } from './repository';
import '../styles/boards.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'That did not work.');

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function BoardsPage() {
  const { mode, session, loading } = useAuth();
  const [source, setSource] = useState<BoardSource | null>(null);
  const [admin, setAdmin] = useState(false);
  const [managing, setManaging] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [space, setSpace] = useState(false);
  const [sharp, setSharp] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const signedIn = mode === 'local' || Boolean(session);
  const accountId = session?.user.id ?? null;

  const reload = useCallback(async () => {
    try {
      setSource(await loadBoard());
    } catch (error) {
      setSource({ kind: 'unavailable', reason: 'not-installed' });
      setToast({ text: messageOf(error), error: true });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!accountId) {
      setAdmin(false);
      return;
    }
    let cancelled = false;
    void isBoardAdmin().then((yes) => {
      if (!cancelled) setAdmin(yes);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast]);

  // Space held = hand tool. Kept from scrolling or pressing a focused button.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target)) return;
      event.preventDefault();
      if (!event.repeat) setSpace(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpace(false);
    };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const showingDemo = !(source?.kind === 'remote' && hasPositions(source.raw));
  const categories = useMemo(() => {
    if (!source) return [];
    return source.kind === 'remote' && hasPositions(source.raw) ? toBoard(source.raw) : demoBoard();
  }, [source]);
  const layout = useMemo(() => layoutBoard(categories), [categories]);

  // An admin edit can shrink the board under an open viewer.
  useEffect(() => {
    if (open != null && open >= layout.items.length) setOpen(null);
  }, [layout, open]);

  const signIn = () => {
    setAfterSignIn('/boards');
    navigate(STUDIO_PATH);
  };

  return (
    <div className="app bd">
      <header className="topbar">
        <SiteNav current="boards" />
        <div className="topbar__actions">
          {admin && source?.kind === 'remote' ? (
            <button type="button" className={`btn btn--small${managing ? ' btn--primary' : ''}`} onClick={() => setManaging((v) => !v)}>
              Manage
            </button>
          ) : null}
          {signedIn ? (
            <ProfileMenu />
          ) : (
            <>
              <button type="button" className="btn btn--primary btn--small" onClick={signIn} disabled={loading}>
                Sign in
              </button>
              <ThemeMenu />
            </>
          )}
        </div>
      </header>

      <main className="bd-main">
        <BoardCanvas layout={layout} spaceHeld={space} sharp={sharp} onSharpChange={setSharp} onOpen={setOpen} />

        {open != null ? (
          <PositionViewer items={layout.items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} peek={space} />
        ) : null}

        {managing && admin && source?.kind === 'remote' ? (
          <AdminPanel
            raw={source.raw}
            showingDemo={showingDemo}
            onChanged={reload}
            onError={(error) => setToast({ text: messageOf(error), error: true })}
            onClose={() => setManaging(false)}
          />
        ) : null}
      </main>

      {toast ? (
        <div className="toast-area" role="status">
          <div className={`toast${toast.error ? ' toast--error' : ''}`}>{toast.text}</div>
        </div>
      ) : null}
    </div>
  );
}
