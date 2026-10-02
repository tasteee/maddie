import { svg, type SVGTemplateResult } from 'lit';

const icon = (body: SVGTemplateResult) =>
  svg`<svg class="icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  select: icon(svg`<path d="M4 2.75 12.4 7.3l-3.85 1.15-1.8 3.8L4 2.75Z"/>`),
  draw: icon(svg`<path d="M10.75 2.75l2.5 2.5L6 12.5l-3.25.75.75-3.25 7.25-7.25Z"/><path d="M9.25 4.25l2.5 2.5"/>`),
  erase: icon(svg`<path d="M6.5 13.25h6.75"/><path d="M3.1 9.4 8.9 3.6a1.3 1.3 0 0 1 1.85 0l2.15 2.15a1.3 1.3 0 0 1 0 1.85L7.25 13.25H5.4L3.1 10.95a1.1 1.1 0 0 1 0-1.55Z"/><path d="m5.9 6.6 3.5 3.5"/>`),
  velocity: icon(svg`<path d="M3 13.25V10M6.33 13.25V5.5M9.67 13.25V8M13 13.25V3"/><circle cx="3" cy="9" r=".9" fill="currentColor" stroke="none"/><circle cx="6.33" cy="4.5" r=".9" fill="currentColor" stroke="none"/><circle cx="9.67" cy="7" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="2" r=".9" fill="currentColor" stroke="none"/>`),
  magnet: icon(svg`<path d="M3.5 2.75h2.75v5a1.75 1.75 0 0 0 3.5 0v-5h2.75v5a4.5 4.5 0 0 1-9 0v-5Z"/><path d="M3.5 5.25h2.75M9.75 5.25h2.75"/>`),
  grid: icon(svg`<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M6.17 2.5v11M9.83 2.5v11M2.5 8h11"/>`),
  music: icon(svg`<path d="M6 12.25V3.75l7-1.5v8.5"/><circle cx="4.25" cy="12.25" r="1.75"/><circle cx="11.25" cy="10.75" r="1.75"/><path d="M6 6.25l7-1.5"/>`),
  lock: icon(svg`<rect x="3.25" y="7" width="9.5" height="6.5" rx="1.75"/><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7"/>`),
  fold: icon(svg`<path d="M2.75 3.25h10.5M2.75 12.75h10.5"/><path d="M2.75 8h2M7 8h2M11.25 8h2" opacity=".55"/>`),
  rowsTaller: icon(svg`<path d="M8 1.75v4.5M5.75 3.75 8 1.5l2.25 2.25M8 14.25v-4.5M5.75 12.25 8 14.5l2.25-2.25M2.75 8h10.5"/>`),
  rowsShorter: icon(svg`<path d="M8 1.75v4M5.75 3.75 8 6l2.25-2.25M8 14.25v-4M5.75 12.25 8 10l2.25 2.25M2.75 8h10.5"/>`),
  play: icon(svg`<path d="M5.25 3.3v9.4a.6.6 0 0 0 .92.5l7.3-4.7a.6.6 0 0 0 0-1L6.17 2.8a.6.6 0 0 0-.92.5Z" fill="currentColor" stroke="none"/>`),
  pause: icon(svg`<rect x="4" y="3" width="2.75" height="10" rx=".8" fill="currentColor" stroke="none"/><rect x="9.25" y="3" width="2.75" height="10" rx=".8" fill="currentColor" stroke="none"/>`),
  stop: icon(svg`<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none"/>`),
  loop: icon(svg`<path d="M11 2.25 13.25 4.5 11 6.75"/><path d="M2.75 8.25V7.5a3 3 0 0 1 3-3h7.5"/><path d="M5 13.75 2.75 11.5 5 9.25"/><path d="M13.25 7.75v.75a3 3 0 0 1-3 3h-7.5"/>`),
  undo: icon(svg`<path d="M5.5 3.75 2.75 6.5 5.5 9.25"/><path d="M2.75 6.5h6.5a3.5 3.5 0 0 1 0 7H7"/>`),
  redo: icon(svg`<path d="M10.5 3.75l2.75 2.75-2.75 2.75"/><path d="M13.25 6.5h-6.5a3.5 3.5 0 0 0 0 7H9"/>`),
  zoomIn: icon(svg`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M5 7h4M7 5v4"/>`),
  zoomOut: icon(svg`<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3M5 7h4"/>`),
  duplicate: icon(svg`<rect x="5.25" y="5.25" width="8" height="8" rx="1.75"/><path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75"/>`),
  mute: icon(svg`<path d="M2.75 6.25v3.5h2.5L8.5 12.5v-9L5.25 6.25h-2.5Z"/><path d="m11 6 3 3m0-3-3 3"/>`),
  trash: icon(svg`<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.4a1 1 0 0 0 1 .85h4.3a1 1 0 0 0 1-.85l.6-8.4"/>`),
  legato: icon(svg`<rect x="2" y="6" width="4.5" height="4" rx="1"/><path d="M6.5 8h5.25M10 6.25 11.75 8 10 9.75M13.75 5v6"/>`),
  download: icon(svg`<path d="M8 2.5v7.75M4.75 7 8 10.25 11.25 7"/><path d="M2.75 11v1.25a1.25 1.25 0 0 0 1.25 1.25h8a1.25 1.25 0 0 0 1.25-1.25V11"/>`),
  upload: icon(svg`<path d="M8 10.25V2.5M4.75 5.75 8 2.5l3.25 3.25"/><path d="M2.75 11v1.25a1.25 1.25 0 0 0 1.25 1.25h8a1.25 1.25 0 0 0 1.25-1.25V11"/>`),
  rewind: icon(svg`<path d="M3.25 3v10"/><path d="M12.75 3.6v8.8a.6.6 0 0 1-.94.5L5.6 8.5a.6.6 0 0 1 0-1l6.2-4.4a.6.6 0 0 1 .95.5Z" fill="currentColor" stroke="none"/>`),
  metronome: icon(svg`<path d="M5.4 13.5h5.2L9 2.75H7L5.4 13.5Z"/><path d="M8 10.5 12 4.5"/><path d="M5.9 10.5h4.2" opacity=".6"/>`),
  volume: icon(svg`<path d="M2.75 6.25v3.5h2.5L8.5 12.5v-9L5.25 6.25h-2.5Z"/><path d="M10.75 6a2.75 2.75 0 0 1 0 4M12.5 4.25a5.25 5.25 0 0 1 0 7.5"/>`),
  keyboard: icon(svg`<rect x="1.75" y="4" width="12.5" height="8" rx="1.75"/><path d="M4.25 6.75h.01M6.75 6.75h.01M9.25 6.75h.01M11.75 6.75h.01M5.25 9.5h5.5"/>`),
  chevron: icon(svg`<path d="m4.75 6.25 3.25 3.25 3.25-3.25"/>`),
  chords: icon(svg`<rect x="3" y="2.5" width="10" height="2.75" rx=".9"/><rect x="3" y="6.63" width="10" height="2.75" rx=".9"/><rect x="3" y="10.75" width="10" height="2.75" rx=".9"/>`),
  follow: icon(svg`<path d="M2.75 8h7.5M7.5 5.25 10.25 8 7.5 10.75"/><path d="M13.25 3v10"/>`),
};
