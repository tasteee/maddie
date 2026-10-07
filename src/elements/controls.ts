import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  detectKey,
  downloadMidi,
  exportFilename,
  formatBBT,
  formatKey,
  inScale,
  pitchName,
  toMidiFile,
  GRID_OPTIONS,
  pitchClassName,
  SCALE_IDS,
  SCALES,
  type Editor,
  type FoldMode,
  type ScaleId,
  type Tool,
  ZOOM_LIMITS,
} from '../core';
import type { Engine } from '../engine/engine';
import { pitchForOffset, scaleMapped, setComputerKeyboard, setKeyboardScale } from '../engine/computer-keyboard';
import { modKeyLabel, rowZoomBy } from '../engine/keymap';
import { MidiInput, setMidiDevice, setMidiInput } from '../engine/midi-input';
import { MIDI_SOURCE, OutputRouter } from '../engine/output-router';
import { MaddieElement } from './base';
import { icons } from './icons';
import { pickMidiFile } from './midi-io';
import { tokens } from './tokens';

/** Shared look for every toolbar control. */
export const controlStyles = css`
  :host {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--_text);
    font-size: 12.5px;
    font-weight: 500;
    letter-spacing: -0.005em;
  }
  button,
  .select {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 30px;
    min-width: 30px;
    padding: 0 7px;
    margin: 0;
    border: 0;
    border-radius: var(--_radius-sm);
    background: transparent;
    color: var(--_text-muted);
    font: inherit;
    cursor: pointer;
    transition:
      background-color var(--_motion-fast) var(--_ease),
      color var(--_motion-fast) var(--_ease),
      transform var(--_motion-fast) var(--_ease);
    -webkit-tap-highlight-color: transparent;
  }
  button:hover,
  .select:hover {
    background: var(--_hover);
    color: var(--_text);
  }
  button:active {
    transform: scale(0.96);
  }
  button[aria-pressed='true'] {
    color: var(--_accent);
    background: color-mix(in oklab, var(--_accent) 12%, transparent);
  }
  button:disabled {
    opacity: 0.35;
    cursor: default;
    background: transparent;
    transform: none;
  }
  button:focus-visible,
  .select:focus-within {
    outline: 2px solid var(--_focus);
    outline-offset: 1px;
  }
  .select {
    color: var(--_text);
    padding: 0 6px 0 8px;
  }
  .select .icon {
    color: var(--_text-muted);
  }
  .select .chev {
    color: var(--_text-faint);
    margin-left: -2px;
  }
  .select select {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
    font: inherit;
    appearance: none;
  }
  .select select:focus {
    outline: none;
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--_border);
  }
  button.export {
    padding: 0 10px 0 8px;
    color: var(--_text);
  }
  .value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .segmented {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border-radius: calc(var(--_radius-sm) + 2px);
    background: var(--_surface-2);
  }
  .segmented button {
    height: 26px;
    min-width: 28px;
    border-radius: calc(var(--_radius-sm) - 1px);
  }
  .segmented button[aria-pressed='true'] {
    background: var(--_raised);
    color: var(--_text);
    box-shadow: 0 0 0 1px var(--_border);
  }
  .segmented.text button {
    padding: 0 10px;
    font-weight: 500;
  }
  .seg-label {
    margin: 0 6px 0 2px;
    color: var(--_text-faint);
    font-size: 11.5px;
    font-weight: 600;
  }
  button.text {
    padding: 0 10px;
    font-weight: 500;
    color: var(--_text);
  }
  button.text.muted {
    color: var(--_text-faint);
    text-decoration: line-through;
  }
  button.text[aria-pressed='true'] {
    color: var(--_accent);
  }
  button.with-chip {
    gap: 6px;
    padding: 0 8px 0 10px;
  }
  .chip {
    padding: 1px 5px;
    border-radius: 5px;
    background: var(--_accent);
    color: var(--_accent-text);
    font: 600 10.5px var(--_font-mono);
  }
  /* Popover (hover / focus): sits under its button, never over the grid's content area for long. */
  .pop-wrap {
    position: relative;
    display: inline-flex;
  }
  .pop {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--_raised);
    color: var(--_text);
    box-shadow:
      0 0 0 1px var(--_border),
      0 10px 30px -8px rgb(0 0 0 / 0.25);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -4px);
    transition:
      opacity var(--_motion-fast) var(--_ease) 140ms,
      transform var(--_motion-fast) var(--_ease) 140ms;
  }
  .pop::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: -10px;
    height: 10px;
  }
  .pop-wrap:hover .pop,
  .pop-wrap:focus-within .pop {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
    transition-delay: 0ms;
  }
  .pop-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
  }
  kbd {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--_surface-2);
    color: var(--_text-muted);
    font: 500 10.5px var(--_font-mono);
  }
  .pop-value {
    min-width: 4ch;
    text-align: right;
    color: var(--_text-muted);
    font: 500 11.5px var(--_font-mono);
    font-variant-numeric: tabular-nums;
  }
  .slider {
    width: 120px;
    height: 16px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    --fill: calc(var(--v) * 100%);
  }
  .slider:focus-visible {
    outline: 2px solid var(--_focus);
    outline-offset: 2px;
    border-radius: 4px;
  }
  .slider::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: linear-gradient(to right, var(--_text) var(--fill), var(--_surface-2) var(--fill));
  }
  .slider::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: var(--_surface-2);
  }
  .slider::-moz-range-progress {
    height: 4px;
    border-radius: 4px;
    background: var(--_text);
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 13px;
    height: 13px;
    margin-top: -4.5px;
    border-radius: 50%;
    background: var(--_text);
    box-shadow: 0 0 0 2px var(--_raised);
    transition: transform var(--_motion-fast) var(--_ease);
  }
  .slider::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: 0;
    border-radius: 50%;
    background: var(--_text);
  }
  .slider:active::-webkit-slider-thumb {
    transform: scale(1.15);
  }
  /* Tooltips: label + shortcut, after a short delay. */
  [data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    z-index: 10;
    padding: 5px 8px;
    border-radius: 6px;
    background: var(--_text);
    color: var(--_bg);
    font-size: 11.5px;
    font-weight: 500;
    white-space: pre;
    pointer-events: none;
    opacity: 0;
    transform: translate(-50%, -3px);
    transition:
      opacity var(--_motion-fast) var(--_ease),
      transform var(--_motion-fast) var(--_ease);
  }
  [data-tip]:hover::after {
    opacity: 1;
    transform: translate(-50%, 0);
    transition-delay: 450ms;
  }
  [data-tip]:active::after {
    opacity: 0;
    transition-delay: 0ms;
  }
`;

/** Base for controls: re-render when the editor changes. */
class ControlElement extends MaddieElement {
  static styles = [tokens, controlStyles];
  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('view', update), editor.on('change', update), editor.on('history', update), editor.on('transport', update));
  }
}

const tip = (label: string, shortcut?: string) => (shortcut ? `${label}   ${shortcut}` : label);

// ── Tool ────────────────────────────────────────────────────────────

const TOOLS: Array<{ tool: Tool; label: string; key: string }> = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'draw', label: 'Draw', key: 'B' },
  { tool: 'erase', label: 'Erase', key: 'E' },
  { tool: 'velocity', label: 'Velocity', key: 'G' },
];

@customElement('maddie-tool-select')
export class MaddieToolSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<div class="segmented" role="radiogroup" aria-label="Tool">
      ${TOOLS.map(
        (t) => html`<button
          role="radio"
          aria-checked=${ed.view.tool === t.tool}
          aria-pressed=${ed.view.tool === t.tool}
          aria-label=${t.label}
          data-tip=${tip(t.label, t.key)}
          @click=${() => ed.setView({ tool: t.tool })}
        >
          ${icons[t.tool]}
        </button>`,
      )}
    </div>`;
  }
}

// ── Grid + snap ─────────────────────────────────────────────────────

@customElement('maddie-grid-select')
export class MaddieGridSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const current = GRID_OPTIONS.find((o) => o.value === ed.view.grid)?.label ?? ed.view.grid;
    return html`<label class="select" data-tip="Grid">
      ${icons.grid}<span class="value">${current}</span><span class="chev">${icons.chevron}</span>
      <select aria-label="Grid" @change=${(e: Event) => ed.setView({ grid: (e.target as HTMLSelectElement).value })}>
        ${GRID_OPTIONS.map((o) => html`<option value=${o.value} ?selected=${o.value === ed.view.grid}>${o.label}</option>`)}
      </select>
    </label>`;
  }
}

@customElement('maddie-snap-toggle')
export class MaddieSnapToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button
      aria-pressed=${ed.view.snap}
      aria-label="Snap to grid"
      data-tip=${tip('Snap · hold ⌥ to bypass', 'S')}
      @click=${() => ed.setView({ snap: !ed.view.snap })}
    >
      ${icons.magnet}
    </button>`;
  }
}

// ── Key, scale lock, fold ───────────────────────────────────────────

/** Open the chords panel: chords that fit the key, drag them onto the grid. */
@customElement('maddie-chords-toggle')
export class MaddieChordsToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button
      aria-pressed=${ed.view.chordsPanel}
      aria-label="Chords"
      data-tip=${tip('Chords that fit the key', 'H')}
      @click=${() => ed.setView({ chordsPanel: !ed.view.chordsPanel })}
    >
      ${icons.chords}<span>Chords</span>
    </button>`;
  }
}

@customElement('maddie-key-select')
export class MaddieKeySelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const key = ed.key;
    const setRoot = (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      ed.commands.setKey(v === '' ? null : { root: Number(v), scale: key?.scale ?? 'major' });
    };
    const setScale = (e: Event) => {
      ed.commands.setKey({ root: key?.root ?? 0, scale: (e.target as HTMLSelectElement).value as ScaleId });
    };
    const notes = ed.notes().filter((n) => !n.muted);
    const auto = () => {
      const guess = detectKey(notes);
      if (!guess) return;
      // A key is already set and every note fits it: leave it alone.
      if (key && notes.every((n) => inScale(n.pitch, key))) {
        this.engine?.toast(`Key: ${formatKey(key)} · every note fits`);
        return;
      }
      ed.commands.setKey(guess.key);
      const pct = Math.round(guess.fit * 100);
      this.engine?.toast(guess.outside ? `Key: ${formatKey(guess.key)} · ${pct}% fits, ${guess.outside} notes outside` : `Key: ${formatKey(guess.key)} · every note fits`);
    };
    return html`
      <label class="select" data-tip="Key">
        ${icons.music}<span class="value">${key ? pitchClassName(key.root) : 'No key'}</span>
        <span class="chev">${icons.chevron}</span>
        <select aria-label="Key root" @change=${setRoot}>
          <option value="" ?selected=${!key}>No key</option>
          ${Array.from({ length: 12 }, (_, pc) => html`<option value=${pc} ?selected=${key?.root === pc}>${pitchClassName(pc)}</option>`)}
        </select>
      </label>
      ${key
        ? html`<label class="select" data-tip="Scale">
            <span class="value">${SCALES[key.scale].name}</span><span class="chev">${icons.chevron}</span>
            <select aria-label="Scale" @change=${setScale}>
              ${SCALE_IDS.map((id) => html`<option value=${id} ?selected=${key.scale === id}>${SCALES[id].name}</option>`)}
            </select>
          </label>`
        : nothing}
      <button aria-label="Detect key" data-tip=${notes.length ? 'Detect key and scale from the notes' : 'Add notes to detect the key'} ?disabled=${!notes.length} @click=${auto}>
        ${icons.wand}<span>Auto</span>
      </button>
    `;
  }
}

@customElement('maddie-scale-lock')
export class MaddieScaleLock extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button
      aria-pressed=${ed.view.scaleLock && !!ed.key}
      ?disabled=${!ed.key}
      aria-label="Lock to scale"
      data-tip="Lock to scale"
      @click=${() => ed.setView({ scaleLock: !ed.view.scaleLock })}
    >
      ${icons.lock}
    </button>`;
  }
}

const FOLDS: Array<{ value: FoldMode; label: string; tip: string }> = [
  { value: 'none', label: 'Off', tip: 'Show every row' },
  { value: 'scale', label: 'Scale', tip: 'Only rows in the key (plus rows with notes)' },
  { value: 'used', label: 'Notes', tip: 'Only rows that have notes' },
];

/** Fold rows: one click between Off · Scale · Notes. */
@customElement('maddie-fold-select')
export class MaddieFoldSelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<span class="seg-label" id="fold-label">Fold</span>
      <div class="segmented text" role="radiogroup" aria-labelledby="fold-label">
        ${FOLDS.map(
          (f) => html`<button
            role="radio"
            aria-checked=${ed.view.fold === f.value}
            aria-pressed=${ed.view.fold === f.value}
            ?disabled=${f.value === 'scale' && !ed.key}
            data-tip=${f.value === 'scale' && !ed.key ? 'Set a key first' : f.tip}
            @click=${() => ed.setView({ fold: f.value }, { animate: true })}
          >
            ${f.label}
          </button>`,
        )}
      </div>`;
  }
}

// ── Transport ───────────────────────────────────────────────────────

/** Play/stop (from the marker), back to start, and the position readout. */
@customElement('maddie-transport')
export class MaddieTransport extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      .play {
        width: 34px;
        height: 34px;
        border-radius: 999px;
        background: var(--_accent);
        color: var(--_accent-text);
        margin-right: 2px;
      }
      .play:hover,
      .play[aria-pressed='true'] {
        background: color-mix(in oklab, var(--_accent) 84%, var(--_bg));
        color: var(--_accent-text);
      }
      .position {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 74px;
        height: 30px;
        padding: 0 10px;
        margin-left: 4px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        font-family: var(--_font-mono);
        font-size: 12.5px;
        font-weight: 500;
        font-variant-numeric: tabular-nums;
        color: var(--_text);
      }
      .dot {
        color: var(--_text-faint);
      }
      .record {
        color: var(--_record);
      }
      .record:hover {
        color: var(--_record);
      }
      .record[aria-pressed='true'] {
        color: var(--_record);
        background: color-mix(in oklab, var(--_record) 16%, transparent);
      }
      .record[aria-pressed='true'] .icon {
        animation: pulse 1s var(--_ease) infinite alternate;
      }
      @keyframes pulse {
        to {
          opacity: 0.35;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .record[aria-pressed='true'] .icon {
          animation: none;
        }
      }
    `,
  ];

  @state() private position = '1.1.1';
  private raf = 0;

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    this.track(
      editor.on('transport', () => this.tick()),
      () => cancelAnimationFrame(this.raf),
    );
    this.tick();
  }

  private tick = () => {
    const ed = this.ed;
    if (!ed) return;
    this.position = formatBBT(ed.transport.position, ed.meta.timeSignature, ed.ppq);
    cancelAnimationFrame(this.raf);
    if (ed.transport.playing) this.raf = requestAnimationFrame(this.tick);
  };

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const t = ed.transport;
    const rec = ed.recorder;
    const [bar, beat, six] = this.position.split('.');
    const record = () => {
      if (!rec.recording && !ed.view.computerKeyboard && !ed.view.midiInput) {
        this.engine?.toast('Turn on keyboard or MIDI input to play while recording');
      }
      rec.toggle();
    };
    return html`
      <button class="play" aria-pressed=${t.playing} aria-label=${t.playing ? 'Stop' : 'Play'} data-tip=${tip(t.playing ? 'Stop · back to marker' : 'Play from marker', 'Space')} @click=${() => t.toggle()}>
        ${t.playing ? icons.stop : icons.play}
      </button>
      <button
        class="record"
        aria-pressed=${rec.recording}
        aria-label=${rec.recording ? 'Stop recording' : 'Record'}
        data-tip=${tip(rec.recording ? 'Stop recording' : 'Record from marker', 'R')}
        @click=${record}
      >
        ${icons.record}
      </button>
      <button
        aria-label=${t.playing ? 'Back to marker' : 'Back to start'}
        data-tip=${t.playing ? 'Back to marker · double-click: to start' : tip('Back to start', '↵')}
        @click=${() => {
          // Playing: jump back to where play started and keep going.
          if (t.playing) return t.seek(t.marker);
          t.stop();
          if (t.position !== 0) t.stop();
        }}
        @dblclick=${() => t.playing && t.seek(0)}
      >${icons.rewind}</button>
      <span class="position" aria-label="Position" role="timer">
        ${bar}<span class="dot">.</span>${beat}<span class="dot">.</span>${six}
      </span>
    `;
  }
}

/** Switch rows (label + hint + toggle) for popovers. */
const switchStyles = css`
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .hint {
    color: var(--_text-faint);
    font-size: 11.5px;
    font-weight: 500;
    white-space: normal;
  }
  .switch-label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 12px;
  }
  button.switch {
    width: 30px;
    min-width: 30px;
    height: 18px;
    padding: 0;
    border-radius: 999px;
    background: var(--_surface-2);
    box-shadow: inset 0 0 0 1px var(--_border);
  }
  button.switch::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--_text-muted);
    transition:
      transform var(--_motion-fast) var(--_ease),
      background-color var(--_motion-fast) var(--_ease);
  }
  button.switch[aria-checked='true'] {
    background: var(--_accent);
    box-shadow: none;
  }
  button.switch[aria-checked='true']::before {
    background: var(--_accent-text);
    transform: translateX(12px);
  }
  button.switch:hover {
    background: var(--_hover);
  }
  button.switch[aria-checked='true']:hover {
    background: var(--_accent);
  }
  button.switch:active {
    transform: none;
  }
`;

/** One switch row. `label` names the switch for assistive tech. */
function switchRow(label: string, hint: string, on: boolean, onClick: () => void, disabled = false) {
  return html`<div class="row">
    <span class="switch-label">${label}<span class="hint">${hint}</span></span>
    <button class="switch" role="switch" aria-checked=${on} aria-label=${label} ?disabled=${disabled} @click=${onClick}></button>
  </div>`;
}

/** Shared: an icon toggle with a slider popover underneath (hover or focus to reveal). */
function popToggle(opts: {
  icon: unknown;
  label: string;
  shortcut: string;
  on: boolean;
  value: number;
  onToggle: () => void;
  onValue: (v: number) => void;
}) {
  const pct = Math.round(opts.value * 100);
  return html`<div class="pop-wrap">
    <button aria-pressed=${opts.on} aria-label=${opts.label} @click=${opts.onToggle}>${opts.icon}</button>
    <div class="pop" role="group" aria-label=${`${opts.label} volume`}>
      <span class="pop-title">${opts.label}<kbd>${opts.shortcut}</kbd></span>
      <input
        class="slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        aria-label=${`${opts.label} volume`}
        .value=${String(opts.value)}
        style=${`--v: ${opts.value}`}
        @input=${(e: Event) => opts.onValue(Number((e.target as HTMLInputElement).value))}
      />
      <span class="pop-value">${pct}%</span>
    </div>
  </div>`;
}

/** Mute toggle; hover for master volume. */
@customElement('maddie-volume')
export class MaddieVolume extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const { level, muted } = ed.volume;
    return popToggle({
      icon: muted || level === 0 ? icons.mute : icons.volume,
      label: muted ? 'Unmute' : 'Volume',
      shortcut: '⇧M',
      on: false,
      value: muted ? 0 : level,
      onToggle: () => ed.setVolume({ muted: !muted }),
      onValue: (v) => ed.setVolume({ level: v, muted: v === 0 }),
    });
  }
}

@customElement('maddie-loop-toggle')
export class MaddieLoopToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const t = ed.transport;
    return html`<button
      aria-pressed=${t.loop.enabled}
      aria-label="Loop"
      data-tip=${tip('Loop · drag the ruler to set', `${modKeyLabel} L`)}
      @click=${() => {
        if (t.loop.end <= t.loop.start) t.setLoop({ start: 0, end: ed.ppq * 4 * 4 });
        t.setLoop({ enabled: !t.loop.enabled });
      }}
    >
      ${icons.loop}
    </button>`;
  }
}

@customElement('maddie-follow-toggle')
export class MaddieFollowToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return html`<button aria-pressed=${ed.view.follow} aria-label="Follow playhead" data-tip=${tip('Follow playhead', 'F')} @click=${() => ed.setView({ follow: !ed.view.follow })}>
      ${icons.follow}
    </button>`;
  }
}

/**
 * All note input in one dropdown: computer keyboard, MIDI controller, and scale-only mode.
 * The button is lit while any input is on. Turning MIDI on asks the browser for access.
 */
@customElement('maddie-input')
export class MaddieInput extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    switchStyles,
    css`
      .pop.input {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        min-width: 260px;
      }
      .select.device {
        justify-content: space-between;
        background: var(--_surface-2);
      }
      .device .value {
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }
      .rule {
        height: 1px;
        margin: 0 -12px;
        background: var(--_border);
      }
    `,
  ];

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    this.track(MidiInput.for(editor).onChange(() => this.requestUpdate()));
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const { computerKeyboard, midiInput, keyboardScale } = ed.view;
    const midi = MidiInput.for(ed);
    const devices = midi.devices;
    const current = devices.find((d) => d.id === ed.view.midiDevice);
    const key = ed.key;
    const z = pitchForOffset(ed, 0);
    const midiHint =
      midi.status === 'unsupported'
        ? "This browser can't read MIDI devices"
        : midi.status === 'denied'
          ? 'MIDI access was blocked'
          : midiInput && midi.status === 'ready' && !devices.length
            ? 'No devices found · plug one in'
            : 'Notes play and record like keys';
    const keysHint = computerKeyboard
      ? `${scaleMapped(ed) ? 'Each key steps up the scale' : 'Each key steps up a semitone'}${z !== null ? ` · Z = ${pitchName(z)}` : ''} · + − octave`
      : 'Play with the keys (\`)';
    return html`<div class="pop-wrap">
      <button class=${computerKeyboard && z !== null ? 'text with-chip' : 'text'} aria-pressed=${computerKeyboard || midiInput} aria-label="Input" @click=${() => setComputerKeyboard(ed, !computerKeyboard)}>
        Input${computerKeyboard && z !== null ? html`<span class="chip">${pitchName(z)}</span>` : nothing}
      </button>
      <div class="pop input" role="group" aria-label="Input options">
        <span class="pop-title">Input</span>
        ${switchRow('Computer keyboard', keysHint, computerKeyboard, () => setComputerKeyboard(ed, !computerKeyboard))}
        ${switchRow('MIDI controller', midiHint, midiInput, () => setMidiInput(ed, !midiInput))}
        ${midiInput && midi.status === 'ready' && devices.length
          ? html`<label class="select device">
              <span class="value">${current?.name ?? 'All devices'}</span><span class="chev">${icons.chevron}</span>
              <select aria-label="MIDI device" @change=${(e: Event) => setMidiDevice(ed, (e.target as HTMLSelectElement).value || null)}>
                <option value="" ?selected=${!current}>All devices</option>
                ${devices.map((d) => html`<option value=${d.id} ?selected=${d.id === current?.id}>${d.name}</option>`)}
              </select>
            </label>`
          : nothing}
        <div class="rule"></div>
        ${switchRow(
          'Scale notes only',
          key ? `Out-of-scale notes snap to ${formatKey(key)}` : 'Set a key to use this',
          keyboardScale,
          () => setKeyboardScale(ed, !keyboardScale),
          !key,
        )}
      </div>
    </div>`;
  }
}

/**
 * Where notes sound: one of the host's sounds or a MIDI port, master volume, and the metronome.
 * The sound list comes from `<maddie-editor>.sounds`. With none, this is just volume and metronome.
 * The button pulses on every metronome click, so it shows where to go to change it.
 */
@customElement('maddie-output')
export class MaddieOutput extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    switchStyles,
    css`
      .pop.output {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        min-width: 240px;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .field-label,
      .hint {
        color: var(--_text-faint);
        font-size: 11.5px;
        font-weight: 500;
        white-space: normal;
      }
      .select.full {
        justify-content: space-between;
        background: var(--_surface-2);
      }
      .select.full .value {
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 200px;
      }
      .rule {
        height: 1px;
        margin: 0 -12px;
        background: var(--_border);
      }
      .volume {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .volume .slider {
        flex: 1;
        width: auto;
      }
    `,
  ];

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    const { transport } = editor;
    this.track(
      OutputRouter.for(editor).onChange(() => this.requestUpdate()),
      transport.onClick((e) => {
        // Clicks are scheduled ahead on the audio clock: pulse when the sound lands.
        const ctx = editor.audioContext;
        const delay = ctx ? Math.max(0, (e.time - ctx.currentTime) * 1000) : 0;
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          this.pulse(e.accent);
        }, delay);
        this.timers.add(timer);
      }),
      () => this.timers.forEach(clearTimeout),
    );
  }

  private timers = new Set<ReturnType<typeof setTimeout>>();

  private pulse(accent: boolean) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const button = this.renderRoot.querySelector('button');
    if (!button) return;
    const color = getComputedStyle(this).getPropertyValue('--_accent') || 'currentColor';
    button.animate(
      [
        { transform: `scale(${accent ? 1.3 : 1.15})`, color, backgroundColor: `color-mix(in oklab, ${color} ${accent ? 28 : 16}%, transparent)` },
        { transform: 'scale(1)' },
      ],
      { duration: 160, easing: 'ease-out' },
    );
  }

  private slider(label: string, value: number, onInput: (v: number) => void) {
    return html`<div class="volume">
      <input
        class="slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        aria-label=${label}
        .value=${String(value)}
        style=${`--v: ${value}`}
        @input=${(e: Event) => onInput(Number((e.target as HTMLInputElement).value))}
      />
      <span class="pop-value">${Math.round(value * 100)}%</span>
    </div>`;
  }

  private select(label: string, value: string, options: Array<{ id: string; name: string }>, onPick: (id: string) => void) {
    const current = options.find((o) => o.id === value);
    return html`<label class="field">
      <span class="field-label">${label}</span>
      <span class="select full">
        <span class="value">${current?.name ?? '—'}</span><span class="chev">${icons.chevron}</span>
        <select aria-label=${label} @change=${(e: Event) => onPick((e.target as HTMLSelectElement).value)}>
          ${options.map((o) => html`<option value=${o.id} ?selected=${o.id === value}>${o.name}</option>`)}
        </select>
      </span>
    </label>`;
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const router = OutputRouter.for(ed);
    const { level, muted } = ed.volume;
    const value = muted ? 0 : level;
    const metro = ed.transport.metronome;
    const midiOn = router.source === MIDI_SOURCE;
    const sources = [
      ...router.sounds.map((s) => ({ id: s.id, name: s.label })),
      ...(router.supported ? [{ id: MIDI_SOURCE, name: 'MIDI output' }] : []),
    ];
    const ports = router.ports;
    return html`<div class="pop-wrap">
      <button class=${muted || level === 0 ? 'text muted' : 'text'} aria-label=${muted ? 'Unmute' : 'Mute'} aria-pressed=${false} @click=${() => ed.setVolume({ muted: !muted })}>
        Output
      </button>
      <div class="pop output" role="group" aria-label="Output options">
        <span class="pop-title">Output<kbd>⇧M</kbd></span>
        ${router.sounds.length
          ? this.select('Sound', router.source, sources, (id) => (id === MIDI_SOURCE ? router.selectMidi() : router.selectSound(id)))
          : nothing}
        ${midiOn
          ? ports.length
            ? this.select('MIDI port', router.portId ?? '', ports, (id) => router.selectPort(id))
            : html`<span class="hint">No MIDI outputs found · plug one in</span>`
          : nothing}
        ${router.sounds.length ? html`<div class="rule"></div>` : nothing}
        <div class="field">
          <span class="field-label">Volume</span>
          ${this.slider('Volume', value, (v) => ed.setVolume({ level: v, muted: v === 0 }))}
        </div>
        <div class="rule"></div>
        ${switchRow('Metronome', 'Click on every beat', metro.enabled, () => ed.transport.setMetronome({ enabled: !metro.enabled }))}
        ${this.slider('Metronome volume', metro.volume, (v) => ed.transport.setMetronome({ volume: v, enabled: true }))}
      </div>
    </div>`;
  }
}

// ── Tempo ───────────────────────────────────────────────────────────

/** Drag up/down to scrub. Double-click to type. Arrow keys nudge. */
@customElement('maddie-tempo')
export class MaddieTempo extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      .tempo {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 30px;
        padding: 0 10px;
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        cursor: ns-resize;
        font-variant-numeric: tabular-nums;
        touch-action: none;
        transition: background-color var(--_motion-fast) var(--_ease);
      }
      .tempo:hover,
      .tempo.active {
        background: color-mix(in oklab, var(--_surface-2) 70%, var(--_hover));
      }
      .tempo:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 1px;
      }
      .bpm {
        font-family: var(--_font-mono);
        color: var(--_text);
        min-width: 3ch;
        text-align: right;
      }
      .unit {
        color: var(--_text-faint);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
      input {
        width: 5ch;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--_text);
        font: 500 12.5px var(--_font-mono);
        text-align: right;
        outline: none;
      }
    `,
  ];

  @state() private editing = false;
  @state() private active = false;

  private get bpm() {
    return this.ed?.meta.tempo[0]?.bpm ?? 120;
  }

  private onDown = (e: PointerEvent) => {
    const ed = this.ed;
    if (!ed || this.editing || e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const start = this.bpm;
    const gestureId = `tempo-${Date.now()}`;
    this.active = true;
    const move = (ev: PointerEvent) => {
      const fine = ev.shiftKey ? 0.1 : 1;
      const next = Math.round((start + ((y0 - ev.clientY) / 3) * fine) * (ev.shiftKey ? 10 : 1)) / (ev.shiftKey ? 10 : 1);
      ed.commands.setTempo(next, { gestureId });
    };
    const up = () => {
      this.active = false;
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  private onKey = (e: KeyboardEvent) => {
    const ed = this.ed;
    if (!ed) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      ed.commands.setTempo(this.bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      this.startEditing();
    }
  };

  private async startEditing() {
    this.editing = true;
    await this.updateComplete;
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  private commit = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (Number.isFinite(value)) this.ed?.commands.setTempo(value);
    this.editing = false;
  };

  render() {
    if (!this.ed) return nothing;
    const bpm = this.bpm;
    const label = Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
    return html`<span
      class="tempo ${this.active ? 'active' : ''}"
      tabindex="0"
      role="spinbutton"
      aria-label="Tempo"
      aria-valuenow=${bpm}
      aria-valuemin="20"
      aria-valuemax="400"
      data-tip=${this.active || this.editing ? nothing : 'Drag to change · double-click to type'}
      @pointerdown=${this.onDown}
      @dblclick=${() => this.startEditing()}
      @keydown=${this.onKey}
    >
      ${this.editing
        ? html`<input
            .value=${label}
            inputmode="decimal"
            @keydown=${(e: KeyboardEvent) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') this.editing = false;
            }}
            @blur=${this.commit}
          />`
        : html`<span class="bpm">${label}</span>`}
      <span class="unit">BPM</span>
    </span>`;
  }
}

// ── History + zoom ──────────────────────────────────────────────────

@customElement('maddie-history')
export class MaddieHistory extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const h = ed.history;
    return html`
      <button ?disabled=${!h.canUndo} aria-label="Undo" data-tip=${tip(h.undoLabel ? `Undo ${h.undoLabel.toLowerCase()}` : 'Undo', `${modKeyLabel} Z`)} @click=${() => ed.undo()}>
        ${icons.undo}
      </button>
      <button ?disabled=${!h.canRedo} aria-label="Redo" data-tip=${tip(h.redoLabel ? `Redo ${h.redoLabel.toLowerCase()}` : 'Redo', `${modKeyLabel} ⇧ Z`)} @click=${() => ed.redo()}>
        ${icons.redo}
      </button>
    `;
  }
}

@customElement('maddie-zoom')
export class MaddieZoom extends ControlElement {
  private zoom(factor: number) {
    const ed = this.ed;
    if (!ed || !this.engine) return;
    const v = ed.view;
    const width = this.engine.viewport.width || 800;
    const center = v.scrollTick + width / 2 / v.pxPerTick;
    const px = v.pxPerTick * factor;
    ed.setView({ pxPerTick: px, scrollTick: Math.max(0, center - width / 2 / px) }, { animate: true });
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const [minRh, maxRh] = ZOOM_LIMITS.rowHeight;
    return html`
      <button aria-label="Shorter rows" ?disabled=${ed.view.rowHeight <= minRh} data-tip=${tip('Shorter rows · ⌥ scroll', '⌥ −')} @click=${() => rowZoomBy(ed, 1 / 1.25)}>
        ${icons.rowsShorter}
      </button>
      <button aria-label="Taller rows" ?disabled=${ed.view.rowHeight >= maxRh} data-tip=${tip('Taller rows · ⌥ scroll', '⌥ +')} @click=${() => rowZoomBy(ed, 1.25)}>
        ${icons.rowsTaller}
      </button>
      <span class="sep"></span>
      <button aria-label="Zoom out" data-tip=${tip('Zoom out · ⌘ scroll', '−')} @click=${() => this.zoom(1 / 1.5)}>${icons.zoomOut}</button>
      <button aria-label="Zoom in" data-tip=${tip('Zoom in · ⌘ scroll', '+')} @click=${() => this.zoom(1.5)}>${icons.zoomIn}</button>
    `;
  }
}

// ── Import / export ─────────────────────────────────────────────────

/**
 * Downloads the doc as a Standard MIDI File.
 * @fires maddie-export - Cancelable. `detail: { bytes, filename }`. Call `preventDefault()` to handle the file yourself.
 */
@customElement('maddie-export')
export class MaddieExport extends ControlElement {
  /** Download name. `.mid` is added if missing. Default: `[key]-[scale]-[bpm]-DDMMYYYY-HHMM.mid`. */
  @property() filename = '';

  private export() {
    const ed = this.ed;
    if (!ed) return;
    const bytes = toMidiFile(ed.doc);
    const filename = this.filename || exportFilename(ed.doc);
    const go = this.dispatchEvent(
      new CustomEvent('maddie-export', { detail: { bytes, filename }, bubbles: true, composed: true, cancelable: true }),
    );
    if (go) downloadMidi(ed.doc, filename);
  }

  render() {
    if (!this.ed) return nothing;
    return html`<button ?disabled=${this.ed.notes().length === 0} aria-label="Export MIDI" data-tip=${tip('Export .mid', `${modKeyLabel} ⇧ E`)} @click=${() => this.export()}>
      ${icons.download}
    </button>`;
  }
}

/**
 * Opens a .mid file and replaces the notes (undoable). Drag & drop onto the roll works too.
 * @fires maddie-import - Cancelable. `detail: { file, bytes }`. Call `preventDefault()` to handle it yourself.
 */
@customElement('maddie-import')
export class MaddieImport extends ControlElement {
  render() {
    if (!this.ed) return nothing;
    return html`<button aria-label="Import MIDI" data-tip=${tip('Import .mid · or drop on the grid', `${modKeyLabel} O`)} @click=${() => pickMidiFile(this.ed!, this)}>
      ${icons.upload}
    </button>`;
  }
}

// ── Toolbars ────────────────────────────────────────────────────────

const barStyles = css`
  :host {
    display: flex;
    align-items: center;
    gap: 6px;
    height: var(--_toolbar-height);
    padding: 0 10px;
    background: var(--_surface);
    border-bottom: 1px solid var(--_border);
    box-sizing: border-box;
    min-width: 0;
    color: var(--_text);
    position: relative;
    z-index: 3;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .divider {
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--_border);
    flex: none;
  }
  .spacer {
    flex: 1;
    min-width: 8px;
  }
`;

/** Top row: global things. Transport, tempo, sound, keyboard input, files. */
@customElement('maddie-topbar')
export class MaddieTopbar extends MaddieElement {
  static styles = [
    tokens,
    barStyles,
    css`
      :host {
        z-index: 4;
      }
    `,
  ];
  render() {
    return html`
      <div class="group" part="group transport">
        <slot name="start"></slot>
        <maddie-transport></maddie-transport>
        <maddie-tempo></maddie-tempo>
      </div>
      <div class="divider"></div>
      <div class="group" part="group sound">
        <maddie-output></maddie-output>
      </div>
      <div class="divider"></div>
      <div class="group" part="group playback">
        <maddie-loop-toggle></maddie-loop-toggle>
        <maddie-follow-toggle></maddie-follow-toggle>
        <maddie-input></maddie-input>
      </div>
      <div class="spacer"></div>
      <div class="group" part="group file">
        <maddie-import></maddie-import>
        <maddie-export></maddie-export>
        <slot name="end"></slot>
      </div>
    `;
  }
}

/** Second row: tools that change the grid below. Tools, grid, key, fold, history, zoom. */
@customElement('maddie-editbar')
export class MaddieEditbar extends MaddieElement {
  static styles = [
    tokens,
    barStyles,
    css`
      :host {
        height: var(--maddie-editbar-height, 46px);
        background: var(--_surface);
      }
    `,
  ];
  render() {
    return html`
      <div class="group" part="group tools"><maddie-tool-select></maddie-tool-select></div>
      <div class="divider"></div>
      <div class="group" part="group grid">
        <maddie-grid-select></maddie-grid-select>
        <maddie-snap-toggle></maddie-snap-toggle>
      </div>
      <div class="divider"></div>
      <div class="group" part="group key">
        <maddie-key-select></maddie-key-select>
        <maddie-scale-lock></maddie-scale-lock>
        <maddie-chords-toggle></maddie-chords-toggle>
      </div>
      <div class="divider"></div>
      <div class="group" part="group fold"><maddie-fold-select></maddie-fold-select></div>
      <div class="spacer"></div>
      <div class="group" part="group history"><maddie-history></maddie-history></div>
      <div class="divider"></div>
      <div class="group" part="group zoom"><maddie-zoom></maddie-zoom></div>
    `;
  }
}

/**
 * Both rows. The edit row uses the inverse color scheme, so the two read as
 * distinct layers: global on top, grid tools right above the grid.
 */
@customElement('maddie-toolbar')
export class MaddieToolbar extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        position: relative;
        z-index: 3;
      }
      .sentinel {
        position: absolute;
        width: 0;
        height: 0;
        overflow: hidden;
        visibility: hidden;
        color: light-dark(#000, #fff);
        transition: color 1ms;
      }
    `,
  ];

  /** `inverse` (default): edit row flips light/dark. `same`: both rows match. */
  @property({ attribute: 'edit-row' }) editRow: 'inverse' | 'same' = 'inverse';
  @state() private scheme: 'light' | 'dark' = 'light';

  protected firstUpdated() {
    this.readScheme();
  }

  private readScheme = () => {
    const s = this.renderRoot.querySelector('.sentinel');
    if (!s) return;
    this.scheme = getComputedStyle(s).color.includes('255') ? 'dark' : 'light';
  };

  render() {
    const inverse = this.editRow === 'inverse' ? (this.scheme === 'dark' ? 'light' : 'dark') : this.scheme;
    return html`
      <span class="sentinel" aria-hidden="true" @transitionrun=${this.readScheme}></span>
      <maddie-topbar part="topbar"><slot name="start" slot="start"></slot><slot name="end" slot="end"></slot></maddie-topbar>
      <maddie-editbar part="editbar" style=${`color-scheme: ${inverse}`}></maddie-editbar>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-tool-select': MaddieToolSelect;
    'maddie-grid-select': MaddieGridSelect;
    'maddie-snap-toggle': MaddieSnapToggle;
    'maddie-key-select': MaddieKeySelect;
    'maddie-scale-lock': MaddieScaleLock;
    'maddie-fold-select': MaddieFoldSelect;
    'maddie-transport': MaddieTransport;
    'maddie-volume': MaddieVolume;
    'maddie-loop-toggle': MaddieLoopToggle;
    'maddie-follow-toggle': MaddieFollowToggle;
    'maddie-input': MaddieInput;
    'maddie-output': MaddieOutput;
    'maddie-chords-toggle': MaddieChordsToggle;
    'maddie-tempo': MaddieTempo;
    'maddie-history': MaddieHistory;
    'maddie-zoom': MaddieZoom;
    'maddie-export': MaddieExport;
    'maddie-import': MaddieImport;
    'maddie-topbar': MaddieTopbar;
    'maddie-editbar': MaddieEditbar;
    'maddie-toolbar': MaddieToolbar;
  }
}
