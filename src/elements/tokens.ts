import { css } from 'lit';

/**
 * Design tokens. Public: `--maddie-*` (set them anywhere above the element).
 * Internal: `--_*` (resolved per element, so overrides work at any level).
 * Light/dark via `light-dark()`, driven by `color-scheme` on <maddie-root>.
 */
export const tokens = css`
  :host {
    --_font: var(--maddie-font, 'DM Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
    --_font-mono: var(--maddie-font-mono, 'DM Mono', ui-monospace, 'SF Mono', Menlo, monospace);

    --_bg: var(--maddie-bg, light-dark(#ffffff, #0c0c0f));
    --_surface: var(--maddie-surface, light-dark(#ffffff, #111115));
    --_surface-2: var(--maddie-surface-2, light-dark(#f4f4f6, #19191f));
    --_raised: var(--maddie-raised, light-dark(#ffffff, #26262e));
    --_hover: var(--maddie-hover, light-dark(rgb(15 15 25 / 0.05), rgb(255 255 255 / 0.065)));
    --_border: var(--maddie-border, light-dark(rgb(15 15 25 / 0.085), rgb(255 255 255 / 0.075)));
    --_text: var(--maddie-text, light-dark(#111114, #f2f2f5));
    --_text-muted: var(--maddie-text-muted, light-dark(#6c6c78, #8e8e9a));
    --_text-faint: var(--maddie-text-faint, light-dark(#a6a6b0, #55555f));

    --_accent: var(--maddie-accent, light-dark(#111114, #f2f2f5));
    --_accent-text: var(--maddie-accent-text, light-dark(#ffffff, #0c0c0f));
    --_focus: var(--maddie-focus, var(--_accent));

    --_row-white: var(--maddie-row-white, light-dark(#ffffff, #121216));
    --_row-black: var(--maddie-row-black, light-dark(#f7f7f9, #0e0e12));
    --_row-out: var(--maddie-row-out-of-scale, light-dark(#e8e8ee, #08080a));
    /* Scale: tints the root row and marks in-scale keys. */
    --_scale: var(--maddie-scale, light-dark(#4f46e5, #8f8aff));
    --_line-bar: var(--maddie-line-bar, light-dark(rgb(15 15 25 / 0.17), rgb(255 255 255 / 0.15)));
    --_line-beat: var(--maddie-line-beat, light-dark(rgb(15 15 25 / 0.085), rgb(255 255 255 / 0.075)));
    --_line-sub: var(--maddie-line-sub, light-dark(rgb(15 15 25 / 0.04), rgb(255 255 255 / 0.035)));
    --_line-row: var(--maddie-line-row, light-dark(rgb(15 15 25 / 0.035), rgb(255 255 255 / 0.028)));

    --_note: var(--maddie-note, light-dark(#3a3a42, #c8c8d0));
    --_note-selected: var(--maddie-note-selected, light-dark(#111114, #ffffff));
    --_note-outline: var(--maddie-note-outline, light-dark(#111114, #ffffff));
    --_note-text: var(--maddie-note-text, light-dark(#ffffff, #0c0c0f));
    /* Pitch colors: hue sweeps low → high. Lightness/chroma default per theme (set to override). */
    --_pitch-lightness: var(--maddie-pitch-lightness, auto);
    --_pitch-chroma: var(--maddie-pitch-chroma, auto);
    --_pitch-hue-low: var(--maddie-pitch-hue-low, 265);
    --_pitch-hue-high: var(--maddie-pitch-hue-high, 15);
    --_note-min-opacity: var(--maddie-note-min-opacity, 0.42);
    --_note-radius: var(--maddie-note-radius, 3px);

    --_playhead: var(--maddie-playhead, var(--_text));
    --_loop: var(--maddie-loop, var(--_text-muted));
    --_record: var(--maddie-record, light-dark(#e5484d, #ff6369));
    --_key-white: var(--maddie-key-white, light-dark(#ffffff, #1b1b21));
    --_key-black: var(--maddie-key-black, light-dark(#2b2b33, #050507));
    --_key-out: var(--maddie-key-out-of-scale, light-dark(#e4e4ea, #101014));

    --_radius: var(--maddie-radius, 12px);
    --_radius-sm: var(--maddie-radius-sm, 8px);
    --_motion-fast: var(--maddie-motion-fast, 90ms);
    --_motion-medium: var(--maddie-motion-medium, 150ms);
    --_motion-slow: var(--maddie-motion-slow, 220ms);
    --_ease: var(--maddie-ease, cubic-bezier(0.2, 0.8, 0.2, 1));

    --_keyboard-width: var(--maddie-keyboard-width, 64px);
    --_ruler-height: var(--maddie-ruler-height, 30px);
    --_lane-height: var(--maddie-lane-height, 92px);
    --_toolbar-height: var(--maddie-toolbar-height, 52px);

    font-family: var(--_font);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  @media (prefers-reduced-motion: reduce) {
    :host {
      --_motion-fast: 0ms;
      --_motion-medium: 0ms;
      --_motion-slow: 0ms;
    }
  }
`;

/** Theme palette resolved to concrete colors for canvas drawing. */
export const PALETTE_TOKENS = [
  'bg',
  'surface',
  'surface-2',
  'text',
  'text-muted',
  'text-faint',
  'accent',
  'border',
  'hover',
  'row-white',
  'row-black',
  'row-out',
  'scale',
  'line-bar',
  'line-beat',
  'line-sub',
  'line-row',
  'note',
  'note-selected',
  'note-outline',
  'note-text',
  'playhead',
  'loop',
  'record',
  'key-white',
  'key-black',
  'key-out',
] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export interface PitchColorConfig {
  lightness: number;
  chroma: number;
  hueLow: number;
  hueHigh: number;
}

export type Palette = Record<PaletteToken, string> & {
  noteMinOpacity: number;
  noteRadius: number;
  fontMono: string;
  font: string;
  dark: boolean;
  pitch: PitchColorConfig;
  /** Cached rgba per pitch / pitch class. Filled lazily. */
  pitchCache: Map<string, string>;
};
