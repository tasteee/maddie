import { svg, type SVGTemplateResult } from 'lit';

/**
 * Icons follow Zest's iconography rules: 24 grid, stroke 2, round caps and joins, `currentColor`,
 * no width or height. A `<z-button>` sizes and colors a slotted icon; elsewhere, size `.icon` in CSS.
 * Paths are from Lucide (ISC), the stroke set Zest's docs recommend.
 */
const icon = (body: SVGTemplateResult) =>
  svg`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** The toolbar set: drawn on a 16 grid at stroke 1.6, so it reads lighter and tighter than the 24 grid Lucide set. */
const icon16 = (body: SVGTemplateResult) =>
  svg`<svg class="icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const icon16Solid = (body: SVGTemplateResult) =>
  svg`<svg class="icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const icons = {
  select: icon(svg`<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"/>`),
  draw: icon(svg`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`),
  erase: icon(svg`<path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/>`),
  velocity: icon(svg`<path d="M5 21v-6"/><path d="M12 21V3"/><path d="M19 21V9"/>`),
  magnet: icon16(svg`<path d="M3.5 2.5h3v5a1.5 1.5 0 0 0 3 0v-5h3v5a4.5 4.5 0 0 1-9 0z"/><path d="M3.5 5.5h3M9.5 5.5h3"/>`),
  grid: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>`),
  music: icon16(svg`<path d="M6 12.5V3.5l7-1.5v9"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="11" r="1.5"/>`),
  piano: icon(svg`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16M8 5v6h2V5m4 0v6h2V5"/>`),
  chordTrack: icon(svg`<rect x="3" y="4" width="13" height="3" rx="1"/><rect x="6" y="10.5" width="13" height="3" rx="1"/><rect x="9" y="17" width="12" height="3" rx="1"/>`),
  more: icon(svg`<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>`),
  lock: icon16(svg`<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>`),
  fold: icon16(svg`<path d="M8 1.5v4M5.5 3.5L8 6l2.5-2.5"/><path d="M8 14.5v-4M5.5 12.5L8 10l2.5 2.5"/><path d="M3 8h10"/>`),
  rowsTaller: icon(svg`<path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3 3-3-3"/><path d="m15 5-3-3-3 3"/>`),
  rowsShorter: icon(svg`<path d="M12 22v-6"/><path d="M12 8V2"/><path d="M4 12H2"/><path d="M10 12H8"/><path d="M16 12h-2"/><path d="M22 12h-2"/><path d="m15 19-3-3-3 3"/><path d="m15 5-3 3-3-3"/>`),
  play: icon16Solid(svg`<path d="M5 3.2v9.6c0 .5.5.8.9.5l7.4-4.8c.4-.2.4-.8 0-1L5.9 2.7c-.4-.3-.9 0-.9.5z"/>`),
  pause: icon16Solid(svg`<rect x="4" y="3" width="3" height="10" rx="1"/><rect x="9" y="3" width="3" height="10" rx="1"/>`),
  stop: icon(svg`<rect width="18" height="18" x="3" y="3" rx="2"/>`),
  loop: icon16(svg`<path d="M3 7.5V6.5a2 2 0 0 1 2-2h7.5"/><path d="M10.5 2.5l2 2-2 2"/><path d="M13 8.5v1a2 2 0 0 1-2 2H3.5"/><path d="M5.5 13.5l-2-2 2-2"/>`),
  undo: icon16(svg`<path d="M6 4L3 7l3 3"/><path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H8"/>`),
  redo: icon16(svg`<path d="M10 4l3 3-3 3"/><path d="M13 7H6.5a3.5 3.5 0 0 0 0 7H8"/>`),
  timeInward: icon(svg`<path d="M2 12h7m-4-4 4 4-4 4m17-4h-7m4-4-4 4 4 4"/>`),
  timeOutward: icon(svg`<path d="M9 12H2m4-4-4 4 4 4m9-4h7m-4-4 4 4-4 4"/>`),
  fit: icon(svg`<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>`),
  back: icon(svg`<path d="m15 5-7 7 7 7"/>`),
  check: icon16(svg`<path d="M3.5 8.5l3 3 6-7"/>`),
  zoomIn: icon(svg`<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>`),
  zoomOut: icon(svg`<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>`),
  duplicate: icon(svg`<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  mute: icon16(svg`<path d="M2.5 6.2v3.6h2.4L8.5 13V3L4.9 6.2z"/><path d="M11 6l3 4M14 6l-3 4"/>`),
  trash: icon(svg`<path d="M10 11v6"/><path d="M14 11v6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`),
  legato: icon(svg`<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>`),
  download: icon(svg`<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>`),
  upload: icon(svg`<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>`),
  rewind: icon16(svg`<path d="M4 3.5v9"/><path d="M12.5 4v8L6.5 8z"/>`),
  settings: icon16(svg`<path d="M2 4.5h6"/><path d="M12 4.5h2"/><circle cx="10" cy="4.5" r="1.5"/><path d="M2 11.5h2"/><path d="M8 11.5h6"/><circle cx="6" cy="11.5" r="1.5"/>`),
  metronome: icon16(svg`<path d="M6 2.5h4l2.5 11h-9z"/><path d="M8 10.5l3.5-6"/>`),
  volume: icon16(svg`<path d="M2.5 6.2v3.6h2.4L8.5 13V3L4.9 6.2z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5"/>`),
  keyboard: icon16(svg`<rect x="1.5" y="4" width="13" height="8" rx="1.5"/><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5.5 9.5h5"/>`),
  record: icon16Solid(svg`<circle cx="8" cy="8" r="4.5"/>`),
  capture: icon16(svg`<path d="M3.2 9.2A5 5 0 1 0 4.5 4.4"/><path d="M4.2 1.8v2.8H7"/><circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none"/>`),
  midi: icon(svg`<path d="M17 19a1 1 0 0 1-1-1v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2a1 1 0 0 1-1 1z"/><path d="M17 21v-2"/><path d="M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"/><path d="M21 21v-2"/><path d="M3 5V3"/><path d="M4 10a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2a2 2 0 0 1-2 2z"/><path d="M7 5V3"/>`),
  chevron: icon16(svg`<path d="M4 6l4 4 4-4"/>`),
  chords: icon(svg`<path d="M16 5H3"/><path d="M11 12H3"/><path d="M11 19H3"/><path d="M21 16V5"/><circle cx="18" cy="16" r="3"/>`),
  wand: icon16(svg`<path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3z"/>`),
  follow: icon16(svg`<circle cx="8" cy="8" r="4.5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/>`),
  plus: icon16(svg`<path d="M8 3.5v9M3.5 8h9"/>`),
  minus: icon16(svg`<path d="M3.5 8h9"/>`),
  close: icon16(svg`<path d="M4 4l8 8M12 4l-8 8"/>`),
};
