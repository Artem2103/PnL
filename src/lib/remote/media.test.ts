import { describe, expect, it } from 'vitest';
import { objectFileName, objectPath, posterObjectPath } from './media';

const ID = '3f2a9c1b-0000-4000-8000-000000000001';
const USER = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('storage object names', () => {
  it('leads with the upload name and keeps the id and extension', () => {
    expect(objectFileName(ID, 'ssstiktok_7412.mp4', 'video/mp4')).toBe(`ssstiktok_7412--${ID}.mp4`);
  });

  it('keeps the user id as the first segment, which the policies match on', () => {
    expect(objectPath(USER, ID, 'clip.mp4', 'video/mp4')).toBe(`${USER}/clip--${ID}.mp4`);
  });

  it('replaces characters Storage would reject', () => {
    expect(objectFileName(ID, 'мой клип (1).MOV', 'video/quicktime')).toBe(`1--${ID}.mov`);
    expect(objectFileName(ID, 'a/b\\c?.png', 'image/png')).toBe(`a_b_c--${ID}.png`);
  });

  it('falls back to the mime type and to the bare id', () => {
    expect(objectFileName(ID, 'pasted', 'image/png')).toBe(`pasted--${ID}.png`);
    expect(objectFileName(ID, '', '')).toBe(ID);
  });

  it('names the poster after its clip', () => {
    expect(posterObjectPath(USER, ID, 'clip.mp4')).toBe(`${USER}/clip--${ID}.poster.webp`);
  });
});
