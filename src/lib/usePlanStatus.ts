import { useCallback, useEffect, useState } from 'react';
import { fetchPlanStatus, type PlanStatus } from './billing';

/**
 * The signed-in account's plan, kept fresh: on sign-in, whenever the window
 * comes back into focus (a payment finished in another tab, a new month began),
 * and whenever `set` is handed a newer answer — `claim_export` returns one with
 * every export, so the counter moves without a second request.
 *
 * `status` is null in local mode and until the billing SQL is installed; the
 * UI then says nothing about plans rather than something wrong.
 */
export function usePlanStatus(userId: string | null, enabled: boolean) {
  const [status, setStatus] = useState<PlanStatus | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !userId) {
      setStatus(null);
      setLoading(false);
      return null;
    }
    try {
      const next = await fetchPlanStatus();
      setStatus(next);
      setError(null);
      return next;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your plan.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, userId]);

  useEffect(() => {
    setLoading(enabled);
    void refresh();
    if (!enabled) return;
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [enabled, refresh]);

  return { status, loading, error, refresh, set: setStatus };
}
