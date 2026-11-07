import { Silhouette } from '../components/ProfileMenu';
import { imageUrl, type CommunityRepository, type Member } from './repository';

/** What every part of the community needs from the page around it. */
export interface Community {
  repo: CommunityRepository;
  /** Null when signed out. */
  me: Member | null;
  /** The viewer's id, or sends them to sign in and answers null. */
  requireMember: () => string | null;
  go: (path: string) => void;
  openTag: (tag: string) => void;
  say: (message: string) => void;
  fail: (error: unknown) => void;
}

export function Avatar({ path }: { path: string | null }) {
  const url = imageUrl(path);
  return url ? <img src={url} alt="" /> : <Silhouette />;
}
