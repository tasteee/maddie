import type { TrackMetaT, TrackRouteT } from './types';

/** Colors given to tracks in order. Wraps around after the last one. */
export const TRACK_COLORS = [
  'var(--accent-spark-1)', 'var(--accent-spark-2)', 'var(--accent-spark-4)',
  'var(--accent-spark-3)', 'var(--accent-spark-5)',
] as const;

/** The color a track draws in: its own, or a palette color for its position. */
export const getTrackColor = (track: TrackMetaT, index: number): string => {
  const ownColor = track.color;
  if (ownColor) return ownColor;
  return TRACK_COLORS[index % TRACK_COLORS.length];
};

export const pickNewTrackColor = (tracks: readonly TrackMetaT[]): string =>
  TRACK_COLORS[tracks.length % TRACK_COLORS.length];

/** The name shown for a track: its own, or "Track N" for its position. */
export const getTrackName = (track: TrackMetaT, index: number): string => {
  const ownName = track.name?.trim();
  if (ownName) return ownName;
  return `Track ${index + 1}`;
};

/** The first "Track N" no track is using. */
export const pickNewTrackName = (tracks: readonly TrackMetaT[]): string => {
  const takenNames = new Set(tracks.map(getTrackName));
  const candidates = Array.from({ length: tracks.length + 1 }, (_, index) => `Track ${index + 1}`);
  const freeName = candidates.find((name) => !takenNames.has(name));
  return freeName ?? `Track ${tracks.length + 1}`;
};

/**
 * Ids of the tracks that play. A track plays when it is not muted
 * and, if any track is soloed, when it is soloed too.
 */
export const getAudibleTrackIds = (tracks: readonly TrackMetaT[]): Set<string> => {
  const hasSolo = tracks.some((track) => track.solo);
  const audibleTracks = tracks.filter((track) => {
    if (track.muted) return false;
    if (!hasSolo) return true;
    return !!track.solo;
  });
  return new Set(audibleTracks.map((track) => track.id));
};

/** Why a track is silent: muted itself, or left out by a solo on other tracks. Null when it plays. */
export type TrackSilenceT = { kind: 'muted' } | { kind: 'solo'; soloedNames: string[] };

export const getTrackSilence = (tracks: readonly TrackMetaT[], trackId: string): TrackSilenceT | null => {
  const track = tracks.find((item) => item.id === trackId);
  if (!track) return null;
  if (track.muted) return { kind: 'muted' };
  const soloedTracks = tracks.filter((item) => item.solo);
  const isLeftOutBySolo = soloedTracks.length > 0 && !track.solo;
  if (!isLeftOutBySolo) return null;
  const soloedNames = soloedTracks.map((item) => getTrackName(item, tracks.indexOf(item)));
  return { kind: 'solo', soloedNames };
};

/** Are two routes the same destination? Two missing routes are the same (both follow the default). */
export const areRoutesEqual = (first: TrackRouteT | undefined, second: TrackRouteT | undefined): boolean => {
  if (!first || !second) return first === second;
  if (first.kind === 'sound' && second.kind === 'sound') return first.soundId === second.soundId;
  if (first.kind === 'midi' && second.kind === 'midi') {
    const isSamePort = first.portId === second.portId;
    const isSameChannel = (first.channel ?? 0) === (second.channel ?? 0);
    return isSamePort && isSameChannel;
  }
  return false;
};
