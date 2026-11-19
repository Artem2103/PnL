import { describe, expect, it } from 'vitest';
import { handleChartImage } from '../../api/chart-image';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function upstream(response: () => Response) {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return response();
  }) as typeof fetch;
  return { impl, urls };
}

const ask = (query: string) => new Request(`https://www.astracards.app/api/chart-image${query}`);

describe('chart-image', () => {
  it('passes through the FX Replay share picture', async () => {
    const fx = upstream(() => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }));
    const res = await handleChartImage(ask('?fx=36df68fe64'), fx.impl);
    expect(fx.urls).toEqual(['https://fxreplay.com/s/36df68fe64.png']);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('only fetches FX Replay, from a plain id', async () => {
    for (const q of ['', '?fx=', '?fx=../../etc', '?fx=evil.com%2Fx', '?fx=a/b', '?url=https://example.com/x.png']) {
      const fx = upstream(() => new Response(PNG));
      expect((await handleChartImage(ask(q), fx.impl)).status).toBe(400);
      expect(fx.urls).toEqual([]);
    }
  });

  it('refuses anything that is not a picture', async () => {
    const html = upstream(() => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }));
    expect((await handleChartImage(ask('?fx=36df68fe64'), html.impl)).status).toBe(404);
    const missing = upstream(() => new Response('', { status: 404 }));
    expect((await handleChartImage(ask('?fx=36df68fe64'), missing.impl)).status).toBe(404);
  });
});
