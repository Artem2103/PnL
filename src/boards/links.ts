/**
 * Chart links an admin can paste into a timeframe slot instead of uploading a file.
 *
 * An FX Replay share link (`fxreplay.com/s/36df68fe64`) works the same way, except
 * its picture is fetched through our own `/api/chart-image`, because FX Replay
 * doesn't allow cross-origin reads.
 *
 * A TradingView snapshot link (`tradingview.com/x/AbCd1234/`) is a page, but the
 * picture behind it sits at a fixed address on TradingView's image host, which
 * allows cross-origin reads. So the browser fetches the PNG directly and it is
 * stored like any uploaded screenshot (original + canvas thumbnail), so the board
 * still works if the link ever goes away.
 */

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

/** The image address behind a pasted link, or null when it isn't one we can read. */
export function chartImageUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();

  if (host === 'tradingview.com' || host.endsWith('.tradingview.com')) {
    const snapshot = /^\/x\/([A-Za-z0-9]{6,16})\/?$/.exec(url.pathname);
    if (snapshot) {
      const id = snapshot[1]!;
      return `https://s3.tradingview.com/snapshots/${id[0]!.toLowerCase()}/${id}.png`;
    }
  }
  // An FX Replay share link: its picture is the same address + ".png", but FX Replay
  // doesn't let browsers read it from another site, so it comes through our
  // /api/chart-image function (see api/chart-image.ts).
  if (host === 'fxreplay.com' || host === 'www.fxreplay.com') {
    const share = /^\/s\/([A-Za-z0-9]{6,32})(?:\.png)?\/?$/.exec(url.pathname);
    if (share) return `/api/chart-image?fx=${share[1]}`;
  }
  // A direct link to a picture (TradingView's own image host included).
  if (imageTypeOf(url.pathname)) return url.href;
  return null;
}

function imageTypeOf(path: string): string | null {
  const ext = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (ext && IMAGE_TYPES[ext]) ?? null;
}

/** Downloads the picture behind a chart link as a File ready for `setFrame`. */
export async function fetchChartImage(imageUrl: string): Promise<File> {
  let response: Response;
  try {
    response = await fetch(imageUrl, { mode: 'cors', credentials: 'omit' });
  } catch {
    throw new Error('Could not download that picture. Check the link and try again.');
  }
  if (response.status === 403 || response.status === 404) {
    throw new Error('No picture at that link. Check the snapshot link is complete.');
  }
  if (!response.ok) throw new Error(`Could not download that picture (error ${response.status}).`);
  const blob = await response.blob();
  const type = Object.values(IMAGE_TYPES).includes(blob.type) ? blob.type : imageTypeOf(new URL(imageUrl, location.href).pathname);
  if (!type) throw new Error('That link is not a PNG, JPEG or WebP picture.');
  const name = new URL(imageUrl, location.href).pathname.split('/').pop() || 'chart';
  return new File([blob], name, { type });
}
