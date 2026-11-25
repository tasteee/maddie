import { unsafeCSS } from 'lit';
import zestTokens from '@tasteee/zest/tokens.css?raw';

/**
 * Design tokens. Maddie speaks Zest (`@tasteee/zest`): every `--_*` value resolves to a Zest semantic
 * token from `ink.css`, so the editor follows the Zest theme set on it or above it.
 *
 * Public: `--maddie-*` (set them anywhere above the element to override one value).
 * Internal: `--_*` (resolved per element, so overrides work at any level).
 *
 * Colors name a role, never a literal: `dom` is Zest's dominant accent (purple), `sub` its subordinate
 * one (pink). `error` is left to destructive actions.
 */
// The declarations live in one string so a themed region inside a shadow root
// can re-run them (see `themeRegion`). Custom properties resolve where they're
// declared, so a region that flips the theme must declare them again.
const tokenDeclarations = `
    --_font: var(--maddie-font, var(--font-sans));
    --_font-mono: var(--maddie-font-mono, var(--font-mono));

    --_bg: var(--maddie-bg, var(--surface-default));
    --_surface: var(--maddie-surface, var(--surface-page));
    --_surface-2: var(--maddie-surface-2, var(--surface-subtle));
    --_raised: var(--maddie-raised, var(--surface-overlay));
    --_hover: var(--maddie-hover, color-mix(in oklch, var(--text-primary) 8%, transparent));
    --_border: var(--maddie-border, var(--border-default));
    --_text: var(--maddie-text, var(--text-primary));
    --_text-muted: var(--maddie-text-muted, var(--text-secondary));
    --_text-faint: var(--maddie-text-faint, var(--text-tertiary));

    /* Dominant accent: tools, toggles that are on, the marquee, the scale. */
    --_accent: var(--maddie-accent, var(--accent-secondary));
    --_accent-text: var(--maddie-accent-text, var(--on-accent));
    --_focus: var(--maddie-focus, var(--border-focus));

    --_row-white: var(--maddie-row-white, var(--surface-default));
    --_row-black: var(--maddie-row-black, var(--surface-page));
    --_row-out: var(--maddie-row-out-of-scale, var(--surface-page));
    /* Scale: tints the root row and marks in-scale keys. */
    --_scale: var(--maddie-scale, var(--accent-secondary));
    --_line-bar: var(--maddie-line-bar, var(--border-strong));
    --_line-beat: var(--maddie-line-beat, color-mix(in oklch, var(--border-default) 75%, transparent));
    --_line-sub: var(--maddie-line-sub, color-mix(in oklch, var(--border-default) 45%, transparent));
    --_line-row: var(--maddie-line-row, var(--_line-sub));

    --_note: var(--maddie-note, color-mix(in oklch, var(--text-primary) 42%, var(--surface-page)));
    --_note-selected: var(--maddie-note-selected, color-mix(in oklch, var(--text-primary) 82%, var(--surface-page)));
    --_note-outline: var(--maddie-note-outline, var(--text-primary));
    --_note-text: var(--maddie-note-text, var(--surface-page));
    /* Pitch colors: hue sweeps low → high, dominant accent (purple) to subordinate (pink). Lightness/chroma default per theme (set to override). */
    --_pitch-lightness: var(--maddie-pitch-lightness, auto);
    --_pitch-chroma: var(--maddie-pitch-chroma, auto);
    --_pitch-hue-low: var(--maddie-pitch-hue-low, 288);
    --_pitch-hue-high: var(--maddie-pitch-hue-high, 361);
    --_note-min-opacity: var(--maddie-note-min-opacity, 0.42);
    --_note-radius: var(--maddie-note-radius, 3px);

    /* The playhead and the record light are the subordinate accent. */
    --_playhead: var(--maddie-playhead, var(--accent-secondary));
    --_loop: var(--maddie-loop, var(--accent-secondary));
    --_record: var(--maddie-record, var(--status-danger));
    --_key-white: var(--maddie-key-white, var(--surface-default));
    --_key-black: var(--maddie-key-black, var(--color-neutral-7));
    --_key-out: var(--maddie-key-out-of-scale, var(--surface-page));
    --_key-out-indicator: var(--maddie-key-out-of-scale-indicator, var(--status-warning));

    --_radius: var(--maddie-radius, var(--radius-lg));
    --_radius-sm: var(--maddie-radius-sm, var(--radius-md));
    --_motion-fast: var(--maddie-motion-fast, var(--motion-fast));
    --_motion-medium: var(--maddie-motion-medium, var(--motion-base));
    --_motion-slow: var(--maddie-motion-slow, 220ms);
    --_ease: var(--maddie-ease, var(--ease-move));

    --_keyboard-width: var(--maddie-keyboard-width, 64px);
    --_ruler-height: var(--maddie-ruler-height, 30px);
    --_lane-height: var(--maddie-lane-height, 92px);
    --_toolbar-height: var(--maddie-toolbar-height, 52px);

    font-family: var(--_font);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
`;

export const tokens = unsafeCSS(`
  :host {
${tokenDeclarations}
  }
  @media (prefers-reduced-motion: reduce) {
    :host {
      --_motion-fast: 0ms;
      --_motion-medium: 0ms;
      --_motion-slow: 0ms;
    }
  }
`);

/**
 * Themed regions inside a shadow root. Zest's theme rules live in a document
 * stylesheet, which can't reach into shadow trees, so the region loads Zest's
 * tokens itself and re-declares Maddie's. Put `data-theme="dark"` (or `light`)
 * on any element in the shadow root to theme that subtree.
 */
export const themeRegion = [
  unsafeCSS(zestTokens),
  unsafeCSS(`[data-theme] {${tokenDeclarations}  color: var(--_text);\n  }`),
];

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
  'key-out-indicator',
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
  trackTokens: CSSStyleDeclaration;
};
