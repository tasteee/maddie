import type { TrackMetaT } from './types';

/** Colors given to tracks in order. Wraps around after the last one. */
export const TRACK_COLORS = ['#8b7cf6', '#f472b6', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#60a5fa', '#c084fc'] as const;

/** The color a track draws in: its own, or a palette color for its position. */
export const getTrackColor = (track: TrackMetaT, index: number): string => {
  const ownColor = track.color;
  if (ownColor) return ownColor;
  return TRACK_COLORS[index % TRACK_COLORS.length];
};

/** The first palette color no track uses yet. Wraps when all are taken. */
export const pickNewTrackColor = (tracks: readonly TrackMetaT[]): string => {
  const usedColors = new Set(tracks.map((track, index) => getTrackColor(track, index)));
  const freeColor = TRACK_COLORS.find((color) => !usedColors.has(color));
  if (freeColor) return freeColor;
  return TRACK_COLORS[tracks.length % TRACK_COLORS.length];
};

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
