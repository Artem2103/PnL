import { describe, expect, it } from 'vitest';
import { chartImageUrl } from './links';

describe('chartImageUrl', () => {
  it('turns a TradingView snapshot link into its PNG', () => {
    expect(chartImageUrl('https://www.tradingview.com/x/AbCd1234/')).toBe('https://s3.tradingview.com/snapshots/a/AbCd1234.png');
    expect(chartImageUrl('  https://tradingview.com/x/Zq9xY8wv  ')).toBe('https://s3.tradingview.com/snapshots/z/Zq9xY8wv.png');
    expect(chartImageUrl('https://www.tradingview.com/x/e7Qpaqln/')).toBe('https://s3.tradingview.com/snapshots/e/e7Qpaqln.png');
    expect(chartImageUrl('https://ru.tradingview.com/x/kLm0NoPq/')).toBe('https://s3.tradingview.com/snapshots/k/kLm0NoPq.png');
  });

  it('sends an FX Replay share link through our own image function', () => {
    expect(chartImageUrl('https://fxreplay.com/s/36df68fe64')).toBe('/api/chart-image?fx=36df68fe64');
    expect(chartImageUrl('https://www.fxreplay.com/s/36df68fe64/')).toBe('/api/chart-image?fx=36df68fe64');
    expect(chartImageUrl('https://fxreplay.com/s/36df68fe64.png')).toBe('/api/chart-image?fx=36df68fe64');
    expect(chartImageUrl('https://fxreplay.com/pricing')).toBeNull();
  });

  it('keeps a direct picture link as it is', () => {
    expect(chartImageUrl('https://s3.tradingview.com/snapshots/a/AbCd1234.png')).toBe(
      'https://s3.tradingview.com/snapshots/a/AbCd1234.png',
    );
    expect(chartImageUrl('https://example.com/shot.JPG')).toBe('https://example.com/shot.JPG');
  });

  it('refuses links it cannot read a picture from', () => {
    expect(chartImageUrl('https://www.tradingview.com/chart/abc/')).toBeNull();
    expect(chartImageUrl('https://example.com/page')).toBeNull();
    expect(chartImageUrl('javascript:alert(1)//x.png')).toBeNull();
    expect(chartImageUrl('not a link')).toBeNull();
  });
});
