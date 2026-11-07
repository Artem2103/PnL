import { describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc } }));

import { PLANS_ENABLED, claimExport } from './billing';
import { createDefaultState } from './defaults';

describe('with plans off', () => {
  it('is the default', () => {
    expect(PLANS_ENABLED).toBe(false);
  });

  it('lets every export through without asking the server', async () => {
    const decision = await claimExport(createDefaultState(), 'png');
    expect(decision).toEqual({ allowed: true, status: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});
