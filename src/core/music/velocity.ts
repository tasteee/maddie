const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0–1 → 1–127. Never 0, because a 0-velocity note-on means note-off. */
export const toMidiVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(clamp01(v) * 127)));

/** 0–127 → 0–1. */
export const fromMidiVelocity = (v: number): number => clamp01(v / 127);

export const clampVelocity = clamp01;
