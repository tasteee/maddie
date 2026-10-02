export const MIN_PITCH = 0;
export const MAX_PITCH = 127;

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export const pitchClass = (pitch: number) => ((pitch % 12) + 12) % 12;
export const isBlackKey = (pitch: number) => BLACK[pitchClass(pitch)];
/** C4 = 60. */
export const octaveOf = (pitch: number) => Math.floor(pitch / 12) - 1;
export const pitchClassName = (pc: number) => NAMES[pitchClass(pc)];
export const pitchName = (pitch: number) => `${NAMES[pitchClass(pitch)]}${octaveOf(pitch)}`;
export const clampPitch = (p: number) => Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(p)));

const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "C", "c#", "Db", "F♯" → pitch class. */
export function parsePitchClass(input: string): number | null {
  const m = /^([a-g])([#♯b♭]?)$/i.exec(input.trim());
  if (!m) return null;
  let pc = LETTERS[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return pitchClass(pc);
}
