/**
 * GET /api/chart-image?fx=<id> — the picture behind an FX Replay share link
 * (`https://fxreplay.com/s/<id>`), passed through from `https://fxreplay.com/s/<id>.png`.
 *
 * FX Replay serves that PNG without an Access-Control-Allow-Origin header, so
 * the Boards admin page can't read it from the browser the way it reads
 * TradingView snapshots. This function fetches it server side and answers it
 * from our own origin.
 *
 * It only ever fetches that one FX Replay address, built from an id that must
 * match `ID`, so it can't be turned into a general proxy.
 *
 * Self-contained on purpose (see `checkout.ts`).
 */

const ID = /^[A-Za-z0-9]{6,32}$/;
/** Vercel functions can answer at most 4.5 MB; share pictures are a few hundred KB. */
const MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function fail(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleChartImage(request, fetch);
}

export async function handleChartImage(request: Request, fetchImpl: typeof fetch): Promise<Response> {
  const id = new URL(request.url).searchParams.get('fx') ?? '';
  if (!ID.test(id)) return fail(400, 'Not an FX Replay share id.');

  let upstream: Response;
  try {
    upstream = await fetchImpl(`https://fxreplay.com/s/${id}.png`, { redirect: 'follow' });
  } catch {
    return fail(502, 'FX Replay did not answer.');
  }
  if (upstream.status === 404) return fail(404, 'No picture at that FX Replay link.');
  if (!upstream.ok) return fail(502, `FX Replay answered ${upstream.status}.`);

  const type = (upstream.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(type)) return fail(404, 'No picture at that FX Replay link.');
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return fail(413, 'That picture is too large.');

  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': type,
      // A share link's picture doesn't change; let the CDN keep it.
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
}
