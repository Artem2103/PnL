import { useState } from 'react';
import type { JournalSettings } from '../types';
import { addTrades, clearTrades, saveSettings, type JournalStorage } from '../store';
import { demoTrades } from '../demo';
import { Overlay } from './Overlay';
import { CloseIcon } from './icons';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'USDT'];

const STORAGE_NOTE: Record<JournalStorage, string> = {
  account: 'Trades are saved to your account.',
  browser: 'Accounts are off — trades are saved in this browser only.',
  'browser-fallback':
    'The journal tables are not in the database yet, so trades are saved in this browser for now. Run supabase/schema.sql to move them to the account.',
};

export function SettingsModal({
  settings,
  storage,
  tradeCount,
  account,
  onClose,
}: {
  settings: JournalSettings;
  storage: JournalStorage;
  tradeCount: number;
  /** Who is signed in, and the account actions the profile menu used to hold. */
  account: { name: string; label: string; onOpenPlans?: () => void; onSignOut?: () => void };
  onClose: () => void;
}) {
  const [balance, setBalance] = useState(String(settings.startingBalance));
  const [currency, setCurrency] = useState(settings.currency);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const act = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      setNote(done);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(balance.replace(/[,\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('The starting balance has to be a number above zero.');
      return;
    }
    void act(() => saveSettings({ startingBalance: value, currency }), 'Settings saved.');
  };

  return (
    <Overlay label="Journal settings" className="jx-settings" onClose={onClose}>
      <header className="jx-dialog__head">
        <h2>Settings</h2>
        <button type="button" className="jx-iconbtn" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </header>

      <form className="jx-settings__section" onSubmit={save}>
        <h3>Account balance</h3>
        <p className="jx-muted">Used for the balance curve and every percentage.</p>
        <div className="jx-settings__row">
          <div className="jx-field">
            <label htmlFor="jx-start">Starting balance</label>
            <input id="jx-start" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </div>
          <div className="jx-field">
            <label htmlFor="jx-currency">Account currency</label>
            <select id="jx-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="jx-btn jx-btn--accent" disabled={busy}>
            Save
          </button>
        </div>
      </form>

      <section className="jx-settings__section">
        <h3>Data</h3>
        <p className="jx-muted">
          {STORAGE_NOTE[storage]} {tradeCount} {tradeCount === 1 ? 'trade' : 'trades'} in the journal.
        </p>
        <div className="jx-settings__row">
          <button
            type="button"
            className="jx-btn jx-btn--ghost"
            disabled={busy}
            onClick={() => void act(() => addTrades(demoTrades()), 'Added 30 demo trades.')}
          >
            Load demo data
          </button>
          {confirmClear ? (
            <span className="jx-confirm">
              Delete all {tradeCount} trades?
              <button
                type="button"
                className="jx-btn jx-btn--danger"
                disabled={busy}
                onClick={() => {
                  setConfirmClear(false);
                  void act(clearTrades, 'All trades deleted.');
                }}
              >
                Delete all
              </button>
              <button type="button" className="jx-btn jx-btn--ghost" onClick={() => setConfirmClear(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="jx-btn jx-btn--ghost jx-btn--danger-text"
              disabled={busy || tradeCount === 0}
              onClick={() => setConfirmClear(true)}
            >
              Delete all trades
            </button>
          )}
        </div>
      </section>

      <section className="jx-settings__section">
        <h3>Account</h3>
        <p className="jx-muted">
          {account.name} · {account.label}
        </p>
        <div className="jx-settings__row">
          {account.onOpenPlans ? (
            <button type="button" className="jx-btn jx-btn--ghost" onClick={account.onOpenPlans}>
              Plans &amp; promo codes
            </button>
          ) : null}
          {account.onSignOut ? (
            <button type="button" className="jx-btn jx-btn--ghost" onClick={account.onSignOut}>
              Log out
            </button>
          ) : null}
        </div>
      </section>

      {error ? <p className="jx-form__failure" role="alert">{error}</p> : null}
      {note ? <p className="jx-settings__ok" role="status">{note}</p> : null}
    </Overlay>
  );
}
