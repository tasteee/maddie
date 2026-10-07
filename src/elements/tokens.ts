import { css } from 'lit';

/**
 * Design tokens. Maddie speaks Zest (`@tasteee/zest`): every `--_*` value resolves to a Zest semantic
 * token (`--background`, `--card`, `--border`, `--purple`, …) that `ink.css` defines, so the editor follows
 * whichever Zest theme (`data-theme` = dark, light, console, studio) is set on it or above it.
 *
 * Public: `--maddie-*` (set them anywhere above the element to override one value).
 * Internal: `--_*` (resolved per element, so overrides work at any level).
 *
 * Colors name a role, never a literal: `dom` is Zest's dominant accent (purple), `sub` its subordinate
 * one (pink). `error` is left to destructive actions.
 */
export const tokens = css`
  :host {
    --_font: var(--maddie-font, var(--font-sans));
    --_font-mono: var(--maddie-font-mono, var(--font-mono));

    --_bg: var(--maddie-bg, var(--background));
    --_surface: var(--maddie-surface, var(--card));
    --_surface-2: var(--maddie-surface-2, var(--background-light));
    --_raised: var(--maddie-raised, var(--popover));
    --_hover: var(--maddie-hover, color-mix(in oklch, var(--foreground) 8%, transparent));
    --_border: var(--maddie-border, var(--border));
    --_text: var(--maddie-text, var(--foreground));
    --_text-muted: var(--maddie-text-muted, var(--muted-foreground));
    --_text-faint: var(--maddie-text-faint, var(--secondary));

    /* Dominant accent: tools, toggles that are on, the marquee, the scale. */
    --_accent: var(--maddie-accent, var(--purple));
    --_accent-text: var(--maddie-accent-text, var(--on-accent));
    --_focus: var(--maddie-focus, var(--focus-ring));

    --_row-white: var(--maddie-row-white, color-mix(in oklch, var(--background) 95%, var(--foreground)));
    --_row-black: var(--maddie-row-black, color-mix(in oklch, var(--background) 98%, var(--foreground)));
    --_row-out: var(--maddie-row-out-of-scale, var(--background));
    /* Scale: tints the root row and marks in-scale keys. */
    --_scale: var(--maddie-scale, var(--purple));
    --_line-bar: var(--maddie-line-bar, color-mix(in oklch, var(--foreground) 17%, transparent));
    --_line-beat: var(--maddie-line-beat, color-mix(in oklch, var(--foreground) 8.5%, transparent));
    --_line-sub: var(--maddie-line-sub, color-mix(in oklch, var(--foreground) 4%, transparent));
    --_line-row: var(--maddie-line-row, color-mix(in oklch, var(--foreground) 3.5%, transparent));

    --_note: var(--maddie-note, color-mix(in oklch, var(--foreground) 42%, var(--background)));
    --_note-selected: var(--maddie-note-selected, color-mix(in oklch, var(--foreground) 82%, var(--background)));
    --_note-outline: var(--maddie-note-outline, var(--foreground));
    --_note-text: var(--maddie-note-text, var(--background));
    /* Pitch colors: hue sweeps low → high, dominant accent (purple) to subordinate (pink). Lightness/chroma default per theme (set to override). */
    --_pitch-lightness: var(--maddie-pitch-lightness, auto);
    --_pitch-chroma: var(--maddie-pitch-chroma, auto);
    --_pitch-hue-low: var(--maddie-pitch-hue-low, 288);
    --_pitch-hue-high: var(--maddie-pitch-hue-high, 361);
    --_note-min-opacity: var(--maddie-note-min-opacity, 0.42);
    --_note-radius: var(--maddie-note-radius, 3px);

    /* The playhead and the record light are the subordinate accent. */
    --_playhead: var(--maddie-playhead, var(--pink));
    --_loop: var(--maddie-loop, var(--muted-foreground));
    --_record: var(--maddie-record, var(--pink));
    --_key-white: var(--maddie-key-white, var(--card));
    --_key-black: var(--maddie-key-black, color-mix(in oklch, var(--background) 35%, black));
    --_key-out: var(--maddie-key-out-of-scale, var(--background));

    --_radius: var(--maddie-radius, var(--radius-lg));
    --_radius-sm: var(--maddie-radius-sm, var(--radius-md));
    --_motion-fast: var(--maddie-motion-fast, var(--duration-fast));
    --_motion-medium: var(--maddie-motion-medium, var(--duration-move));
    --_motion-slow: var(--maddie-motion-slow, 220ms);
    --_ease: var(--maddie-ease, var(--easing-standard));

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
