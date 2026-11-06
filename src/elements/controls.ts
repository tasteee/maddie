import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { live } from 'lit/directives/live.js';
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
  canHaveModifier,
  getGridModifier,
  getStraightGrid,
  setGridModifier,
  pitchClassName,
  SCALE_IDS,
  SCALES,
  type Editor,
  type FoldMode,
  type GridModifier,
  type ScaleId,
  ZOOM_LIMITS,
} from '../core';
import type { Engine } from '../engine/engine';
import { pitchForOffset, scaleMapped, setComputerKeyboard, setKeyboardScale } from '../engine/computer-keyboard';
import { captureMidi, modKeyLabel, rowZoomBy } from '../engine/keymap';
import { MidiInput, setMidiDevice, setMidiInput } from '../engine/midi-input';
import { MIDI_SOURCE, OutputRouter } from '../engine/output-router';
import { MaddieElement } from './base';
import { icons } from './icons';
import { pickMidiFile } from './midi-io';
import { tokens } from './tokens';
import type { ZestTone, ZestOption } from './zest';
import './zest';

/** The vertical divider between groups. Shared by the top bar, the edit bar and the selection bar so all three space it alike. */
export const dividerStyles = css`
  /* One divider for every bar: full height inside the bar, the same space on both sides. */
  z-separator[is-vertical] {
    flex: none;
    align-self: stretch;
    margin-block: var(--space-sm);
    margin-inline: var(--space-sm);
  }
`;

/** Pieces shared by controls and the panels around them: layout and type only. Color, shape and state come from the Zest elements. */
export const partStyles = css`
  /* An icon-only <z-button>: Zest sizes the icon and the height; this makes the cap square. */
  z-button.icon {
    width: var(--control-height-sm);
  }
  .label {
    margin-inline: var(--space-xs) 0;
    color: var(--_text-muted);
    font-size: var(--font-size-caption);
    font-weight: 500;
    white-space: nowrap;
  }
  /* In a narrow bar the field names go first; each control still has its tooltip and accessible name. */
  @container (max-width: 1280px) {
    .label.optional {
      display: none;
    }
  }
  .value {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .unit {
    color: var(--_text-muted);
    font-size: var(--font-size-caption);
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  z-select {
    min-width: 6.5rem;
  }
  z-popover {
    --z-overlay-padding: var(--space-md);
    --z-overlay-max-width: 20rem;
  }
  /* Panels inside a popover. */
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 15.5rem;
    color: var(--_text);
  }
  .panel-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-sm);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .setting {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .setting .hint {
    padding-inline-start: 2.5rem;
    margin-top: -0.25rem;
  }
  .panel z-select {
    min-width: 0;
  }
  .panel z-separator {
    margin-block: 0;
  }
`;

/** Shared look for a single control: an inline row of Zest elements. */
export const controlStyles = [
  css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      color: var(--_text);
      font-size: var(--control-font-size-sm);
      font-weight: 500;
    }
  `,
  partStyles,
];

/** Base for controls: re-render when the editor changes. */
class ControlElement extends MaddieElement {
  static styles = [tokens, controlStyles];
  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('view', update), editor.on('change', update), editor.on('history', update), editor.on('transport', update));
  }
}

const tip = (label: string, shortcut?: string) => (shortcut ? `${label}   ${shortcut}` : label);

/** A Zest tooltip around any control. */
const tooltip = (content: string, control: unknown, placement: 'top' | 'bottom' = 'bottom') =>
  html`<z-tooltip content=${content} placement=${placement}>${control}</z-tooltip>`;

interface IconAction {
  label: string;
  tip: string;
  icon: unknown;
  onClick: () => void;
  disabled?: boolean;
  tone?: ZestTone;
  placement?: 'top' | 'bottom';
}

/** Icon-only action: a ghost `<z-button>` with a tooltip. */
const iconButton = (a: IconAction) =>
  tooltip(
    a.tip,
    html`<z-button
      class="icon"
      kind="ghost"
      size="sm"
      tone=${a.tone ?? 'neutral'}
      aria-label=${a.label}
      ?is-disabled=${a.disabled}
      @click=${a.onClick}
      >${a.icon}</z-button
    >`,
    a.placement,
  );

interface IconToggle {
  label: string;
  tip: string;
  icon: unknown;
  on: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  tone?: ZestTone;
  /** A visible label next to the icon. */
  text?: string;
}

/** On/off control: a ghost `<z-toggle-button>`; on is the filled accent. The editor owns the state, so `live` keeps the two in step. */
const iconToggle = (t: IconToggle) =>
  tooltip(
    t.tip,
    html`<z-toggle-button
      kind="ghost"
      size="sm"
      tone=${t.tone ?? 'primary'}
      ?is-icon=${!t.text}
      aria-label=${t.label}
      .isPressed=${live(t.on)}
      ?is-disabled=${t.disabled}
      @press=${(e: CustomEvent<{ pressed: boolean }>) => t.onToggle(e.detail.pressed)}
      >${t.icon}${t.text ?? nothing}</z-toggle-button
    >`,
  );

/** A Zest select that shows the editor's value. */
const select = (label: string, value: string, options: ZestOption[], onPick: (value: string) => void, placeholder?: string) =>
  html`<z-select
    size="sm"
    label=${label}
    placeholder=${placeholder ?? nothing}
    .options=${options}
    .value=${live(value)}
    @change=${(e: CustomEvent<{ value: string }>) => onPick(e.detail.value)}
  ></z-select>`;

// ── Swap button ─────────────────────────────────────────────────────

/** Styles for `swapButton`. The value slides in each time it changes. */
const swapStyles = css`
  .swap-value {
    display: inline-block;
    min-width: var(--_swap-value-width, 2.75rem);
    text-align: left;
    animation: swap-in var(--_motion-medium) var(--_ease);
  }
  @keyframes swap-in {
    from {
      opacity: 0;
      transform: translateY(0.4em);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .swap-value {
      animation: none;
    }
  }
`;

type SwapButtonT = {
  /** Names the control for tooltips and screen readers. Not drawn. */
  label: string;
  icon: unknown;
  value: string;
  tip: string;
  isActive: boolean;
  onSwap: (isBackwards: boolean) => void;
};

/** One button that shows an icon and a value. Click swaps to the next value; ⇧-click goes back. */
const swapButton = (swap: SwapButtonT) => {
  const tone = swap.isActive ? 'primary' : 'neutral';
  return tooltip(
    swap.tip,
    html`<z-button
      kind="outline"
      size="sm"
      tone=${tone}
      aria-label=${`${swap.label}: ${swap.value}`}
      @click=${(event: MouseEvent) => swap.onSwap(event.shiftKey)}
    >
      ${swap.icon}
      ${keyed(swap.value, html`<span class="swap-value">${swap.value}</span>`)}
    </z-button>`,
  );
};

/** The item after (or before) `current` in a list, wrapping around. */
const getSwappedItem = <T,>(items: readonly T[], current: T, isBackwards: boolean): T => {
  const currentIndex = items.indexOf(current);
  const step = isBackwards ? -1 : 1;
  const nextIndex = (currentIndex + step + items.length) % items.length;
  return items[nextIndex];
};

// ── Grid + snap ─────────────────────────────────────────────────────

// Straight, triplet and dotted are a modifier on a size, not sizes of their own, so they are not in this cycle.
const GRID_SIZES = GRID_OPTIONS.filter((option) => getGridModifier(option.value) === 'straight');
const GRID_SIZE_VALUES = GRID_SIZES.map((option) => option.value);

const MODIFIER_OPTIONS: { value: GridModifier; label: string; suffix: string }[] = [
  { value: 'straight', label: 'Straight', suffix: '' },
  { value: 'triplet', label: 'Triplet', suffix: ' T' },
  { value: 'dotted', label: 'Dotted', suffix: ' ·' },
];

const MODIFIER_TIP = 'Straight: plain size · Triplet: two thirds as long · Dotted: half again as long';

const getGridLabel = (grid: string): string => {
  const straight = getStraightGrid(grid);
  const option = GRID_SIZES.find((size) => size.value === straight);
  const label = option?.label ?? straight;
  const modifier = getGridModifier(grid);
  const modifierOption = MODIFIER_OPTIONS.find((candidate) => candidate.value === modifier);
  return `${label}${modifierOption?.suffix ?? ''}`;
};

/**
 * Grid size: a swap button (click for the next size, ⇧-click for the previous)
 * and a Straight / Triplet / Dotted choice that bends the chosen size.
 */
@customElement('maddie-grid-select')
export class MaddieGridSelect extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    swapStyles,
    css`
      :host {
        --_swap-value-width: 3.25rem;
      }
      z-toggle-button-group {
        margin-inline-end: var(--space-sm);
      }
    `,
  ];

  private swapSize(isBackwards: boolean) {
    const ed = this.ed!;
    const grid = ed.view.grid;
    const modifier = getGridModifier(grid);
    const straight = getStraightGrid(grid);
    const nextSize = getSwappedItem(GRID_SIZE_VALUES, straight, isBackwards);
    ed.setView({ grid: setGridModifier(nextSize, modifier) });
  }

  private pickModifier(event: CustomEvent<{ value?: string }>) {
    const ed = this.ed!;
    const pickedValue = event.detail.value;
    // Clicking the pressed choice again deselects it; one of the three is always on.
    if (pickedValue === undefined) return this.requestUpdate();
    ed.setView({ grid: setGridModifier(ed.view.grid, pickedValue as GridModifier) });
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const grid = ed.view.grid;
    const modifier = getGridModifier(grid);
    const straight = getStraightGrid(grid);
    const nextSize = getSwappedItem(GRID_SIZE_VALUES, straight, false);
    const nextLabel = getGridLabel(setGridModifier(nextSize, modifier));
    const canBend = canHaveModifier(grid);
    const modifierTip = canBend ? MODIFIER_TIP : 'Auto and 1 Bar cannot be bent. Pick 1/2, 1/4, 1/8 …';
    const modifierItems = MODIFIER_OPTIONS.map(
      (option) =>
        html`<z-toggle-button-group-item value=${option.value} .isPressed=${live(modifier === option.value)}>${option.label}</z-toggle-button-group-item>`,
    );
    return html`${swapButton({
      label: 'Grid size',
      icon: icons.grid,
      value: getGridLabel(grid),
      tip: `Grid size · click for ${nextLabel} · ⇧-click to go back`,
      isActive: false,
      onSwap: (isBackwards) => this.swapSize(isBackwards),
    })}${tooltip(
      modifierTip,
      html`<z-toggle-button-group
        size="sm"
        kind="soft"
        tone="primary"
        aria-label="Grid feel"
        ?is-disabled=${!canBend}
        @change=${(event: CustomEvent<{ value?: string }>) => this.pickModifier(event)}
      >
        ${modifierItems}
      </z-toggle-button-group>`,
    )}`;
  }
}

@customElement('maddie-snap-toggle')
export class MaddieSnapToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return iconToggle({
      label: 'Snap to grid',
      tip: tip('Snap · hold ⌥ to bypass', 'S'),
      icon: icons.magnet,
      on: ed.view.snap,
      onToggle: (snap) => ed.setView({ snap }),
    });
  }
}

// ── Key, scale lock, fold ───────────────────────────────────────────

/** Open the chords panel: chords that fit the key, drag them onto the grid. */
@customElement('maddie-chords-toggle')
export class MaddieChordsToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return iconToggle({
      label: 'Chords',
      tip: tip('Chords that fit the key', 'H'),
      icon: icons.chords,
      text: 'Chords',
      on: ed.view.chordsPanel,
      onToggle: (chordsPanel) => ed.setView({ chordsPanel }),
    });
  }
}

const NO_KEY = '';

@customElement('maddie-key-select')
export class MaddieKeySelect extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const key = ed.key;
    const setRoot = (v: string) => {
      ed.commands.setKey(v === NO_KEY ? null : { root: Number(v), scale: key?.scale ?? 'major' });
    };
    const setScale = (id: string) => {
      ed.commands.setKey({ root: key?.root ?? 0, scale: id as ScaleId });
    };
    // The key of the song: notes from every track, not only the one being edited.
    const notes = ed.doc.tracks.flatMap((track) => track.notes).filter((n) => !n.muted);
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
      ${select(
        'Key',
        key ? String(key.root) : NO_KEY,
        [{ value: NO_KEY, label: 'No key' }, ...Array.from({ length: 12 }, (_, pc) => ({ value: String(pc), label: pitchClassName(pc) }))],
        setRoot,
      )}
      ${key
        ? select(
            'Scale',
            key.scale,
            SCALE_IDS.map((id) => ({ value: id, label: SCALES[id].name })),
            setScale,
          )
        : nothing}
      ${tooltip(
        notes.length ? 'Detect key and scale from the notes' : 'Add notes to detect the key',
        html`<z-button kind="ghost" size="sm" aria-label="Detect key" ?is-disabled=${!notes.length} @click=${auto}>${icons.wand}Auto</z-button>`,
      )}
    `;
  }
}

@customElement('maddie-scale-lock')
export class MaddieScaleLock extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return iconToggle({
      label: 'Lock to scale',
      tip: 'Lock to scale',
      icon: icons.lock,
      on: ed.view.scaleLock && !!ed.key,
      disabled: !ed.key,
      onToggle: (scaleLock) => ed.setView({ scaleLock }),
    });
  }
}

const FOLD_CYCLE: FoldMode[] = ['none', 'scale', 'used'];

const FOLD_LABELS: Record<FoldMode, string> = {
  none: 'Off',
  scale: 'Scale',
  used: 'Notes',
};

const FOLD_TIPS: Record<FoldMode, string> = {
  none: 'Show every row',
  scale: 'Only rows in the key (plus rows with notes)',
  used: 'Only rows that have notes',
};

/** The next fold in Off → Scale → Notes. Scale is skipped when there is no key. */
const getNextFold = (current: FoldMode, hasKey: boolean): FoldMode => {
  const currentIndex = FOLD_CYCLE.indexOf(current);
  const nextIndex = (currentIndex + 1) % FOLD_CYCLE.length;
  const next = FOLD_CYCLE[nextIndex];
  const isBlocked = next === 'scale' && !hasKey;
  if (isBlocked) return FOLD_CYCLE[(nextIndex + 1) % FOLD_CYCLE.length];
  return next;
};

/** Fold rows: one button. Click to swap the value: Off → Scale → Notes → Off. */
@customElement('maddie-fold-select')
export class MaddieFoldSelect extends ControlElement {
  static styles = [tokens, controlStyles, swapStyles];
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const fold = ed.view.fold;
    const nextFold = getNextFold(fold, !!ed.key);
    const tipText = `${FOLD_TIPS[fold]} · click for ${FOLD_LABELS[nextFold]}`;
    return swapButton({
      label: 'Fold rows',
      icon: icons.fold,
      value: FOLD_LABELS[fold],
      tip: tipText,
      isActive: fold !== 'none',
      onSwap: () => ed.setView({ fold: nextFold }, { animate: true }),
    });
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
      z-badge.position {
        margin-inline-start: var(--space-xs);
        font-family: var(--_font-mono);
        font-variant-numeric: tabular-nums;
      }
      .dot {
        color: var(--_text-faint);
      }
      /* The record light breathes while recording. */
      z-toggle-button[aria-label='Stop recording'] svg {
        animation: pulse 1s var(--_ease) infinite alternate;
      }
      @keyframes pulse {
        to {
          opacity: 0.35;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        z-toggle-button[aria-label='Stop recording'] svg {
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
      editor.capture.onChange(() => this.requestUpdate()),
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
    const capturedCount = ed.capture.count;
    const canCapture = capturedCount > 0 && !rec.recording;
    const record = () => {
      if (!rec.recording && !ed.view.computerKeyboard && !ed.view.midiInput) {
        this.engine?.toast('Turn on keyboard or MIDI input to play while recording');
      }
      rec.toggle();
    };
    return html`
      ${tooltip(
        tip(t.playing ? 'Stop · back to marker' : 'Play from marker', 'Space'),
        html`<z-button class="icon" kind="solid" tone="primary" size="sm" aria-label=${t.playing ? 'Stop' : 'Play'} @click=${() => t.toggle()}
          >${t.playing ? icons.stop : icons.play}</z-button
        >`,
      )}
      ${tooltip(
        tip(rec.recording ? 'Stop recording' : 'Record from marker', 'R'),
        html`<z-toggle-button
          is-icon
          kind="ghost"
          size="sm"
          tone="secondary"
          aria-label=${rec.recording ? 'Stop recording' : 'Record'}
          .isPressed=${live(rec.recording)}
          @press=${record}
          >${icons.record}</z-toggle-button
        >`,
      )}
      ${tooltip(
        tip(canCapture ? `Keep what you just played (${capturedCount})` : 'Play something to capture it', 'Shift+R'),
        html`<z-button
          class="icon"
          kind="ghost"
          size="sm"
          aria-label="Capture MIDI"
          ?is-disabled=${!canCapture}
          @click=${() => captureMidi(ed)}
          >${icons.capture}</z-button
        >`,
      )}
      ${tooltip(
        t.playing ? 'Back to marker · double-click: to start' : tip('Back to start', '↵'),
        html`<z-button
          class="icon"
          kind="ghost"
          size="sm"
          aria-label=${t.playing ? 'Back to marker' : 'Back to start'}
          @click=${() => {
            // Playing: jump back to where play started and keep going.
            if (t.playing) return t.seek(t.marker);
            t.stop();
            if (t.position !== 0) t.stop();
          }}
          @dblclick=${() => t.playing && t.seek(0)}
          >${icons.rewind}</z-button
        >`,
      )}
      <z-badge class="position" aria-label="Position" role="timer">
        ${bar}<span class="dot">.</span>${beat}<span class="dot">.</span>${six}
      </z-badge>
    `;
  }
}

/** A labelled Zest switch with a hint underneath. */
function switchRow(label: string, hint: string, on: boolean, onToggle: (on: boolean) => void, disabled = false) {
  return html`<div class="setting">
    <z-switch size="sm" tone="primary" label=${label} .isChecked=${live(on)} ?is-disabled=${disabled} @change=${(e: CustomEvent<{ checked: boolean }>) => onToggle(e.detail.checked)}
      >${label}</z-switch
    >
    <z-text class="hint" size="xs" color="muted">${hint}</z-text>
  </div>`;
}

/** A 0–1 level on a Zest slider (which counts in whole percent). */
function levelSlider(label: string, value: number, onInput: (v: number) => void) {
  return html`<z-slider
    label=${label}
    tone="primary"
    min="0"
    max="100"
    step="1"
    does-show-value
    value-suffix="%"
    .value=${live(Math.round(value * 100))}
    @input=${(e: CustomEvent<{ value: number }>) => onInput(e.detail.value / 100)}
  ></z-slider>`;
}

/** Mute toggle; open for master volume. */
@customElement('maddie-volume')
export class MaddieVolume extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const { level, muted } = ed.volume;
    const silent = muted || level === 0;
    return html`<z-popover placement="bottom-start" label="Volume">
      <z-button slot="trigger" class="icon" kind="ghost" size="sm" aria-label="Volume">${silent ? icons.mute : icons.volume}</z-button>
      <div class="panel">
        <div class="panel-title"><z-text size="sm" weight="600">Volume</z-text><z-kbd size="xs">⇧M</z-kbd></div>
        ${levelSlider('Volume', muted ? 0 : level, (v) => ed.setVolume({ level: v, muted: v === 0 }))}
        ${switchRow('Muted', 'Silence every sound', muted, (on) => ed.setVolume({ muted: on }))}
      </div>
    </z-popover>`;
  }
}

@customElement('maddie-loop-toggle')
export class MaddieLoopToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const t = ed.transport;
    return iconToggle({
      label: 'Loop',
      tip: tip('Loop · drag the ruler to set', `${modKeyLabel} L`),
      icon: icons.loop,
      on: t.loop.enabled,
      onToggle: (enabled) => {
        if (t.loop.end <= t.loop.start) t.setLoop({ start: 0, end: ed.ppq * 4 * 4 });
        t.setLoop({ enabled });
      },
    });
  }
}

@customElement('maddie-follow-toggle')
export class MaddieFollowToggle extends ControlElement {
  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    return iconToggle({
      label: 'Follow playhead',
      tip: tip('Follow playhead', 'F'),
      icon: icons.follow,
      on: ed.view.follow,
      onToggle: (follow) => ed.setView({ follow }),
    });
  }
}

/**
 * All note input in one popover: computer keyboard, MIDI controller, and scale-only mode.
 * The button is lit while any input is on. Turning MIDI on asks the browser for access.
 */
@customElement('maddie-input')
export class MaddieInput extends ControlElement {
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
      : 'Play with the keys (`)';
    const active = computerKeyboard || midiInput;
    const showZ = computerKeyboard && z !== null;
    return html`<z-popover placement="bottom-start" label="Input options">
      <z-button slot="trigger" kind=${active ? 'soft' : 'ghost'} tone=${active ? 'primary' : 'neutral'} size="sm" aria-label="Input"
        >${icons.keyboard}Input<z-badge kind="solid" tone="primary" size="sm" ?hidden=${!showZ} style=${showZ ? '' : 'display:none'}>${showZ ? pitchName(z) : ''}</z-badge></z-button
      >
      <div class="panel">
        <z-text class="panel-title" size="sm" weight="600">Input</z-text>
        ${switchRow('Computer keyboard', keysHint, computerKeyboard, (on) => setComputerKeyboard(ed, on))}
        ${switchRow('MIDI controller', midiHint, midiInput, (on) => setMidiInput(ed, on))}
        ${midiInput && midi.status === 'ready' && devices.length
          ? select(
              'MIDI device',
              current?.id ?? '',
              [{ value: '', label: 'All devices' }, ...devices.map((d) => ({ value: d.id, label: d.name }))],
              (id) => setMidiDevice(ed, id || null),
            )
          : nothing}
        <z-separator></z-separator>
        ${switchRow(
          'Scale notes only',
          key ? `Out-of-scale notes snap to ${formatKey(key)}` : 'Set a key to use this',
          keyboardScale,
          (on) => setKeyboardScale(ed, on),
          !key,
        )}
      </div>
    </z-popover>`;
  }
}

/**
 * Where notes sound: one of the host's sounds or a MIDI port, master volume, and the metronome.
 * The sound list comes from `<maddie-editor>.sounds`. With none, this is just volume and metronome.
 * The icon pulses on every metronome click, so it shows where to go to change it.
 */
@customElement('maddie-output')
export class MaddieOutput extends ControlElement {
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
    const icon = this.renderRoot.querySelector<SVGElement>('z-button[slot="trigger"] svg');
    if (!icon) return;
    const color = getComputedStyle(this).getPropertyValue('--_accent') || 'currentColor';
    icon.animate([{ transform: `scale(${accent ? 1.5 : 1.3})`, color }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
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
      ...router.sounds.map((s) => ({ value: s.id, label: s.label })),
      ...(router.supported ? [{ value: MIDI_SOURCE, label: 'MIDI output' }] : []),
    ];
    const ports = router.ports;
    return html`<z-popover placement="bottom-start" label="Output options">
      <z-button slot="trigger" kind="ghost" size="sm" aria-label="Output">${muted || level === 0 ? icons.mute : icons.volume}Output</z-button>
      <div class="panel">
        <div class="panel-title"><z-text size="sm" weight="600">Output</z-text><z-kbd size="xs">⇧M</z-kbd></div>
        ${router.sounds.length
          ? html`<div class="field">
              <z-text class="field-label" size="xs" color="muted">Sound</z-text>
              ${select('Sound', router.source, sources, (id) => (id === MIDI_SOURCE ? router.selectMidi() : router.selectSound(id)))}
            </div>`
          : nothing}
        ${midiOn
          ? ports.length
            ? html`<div class="field">
                <z-text class="field-label" size="xs" color="muted">MIDI port</z-text>
                ${select('MIDI port', router.portId ?? '', ports.map((p) => ({ value: p.id, label: p.name })), (id) => router.selectPort(id))}
              </div>`
            : html`<z-text class="hint" size="xs" color="muted">No MIDI outputs found · plug one in</z-text>`
          : nothing}
        ${router.sounds.length ? html`<z-separator></z-separator>` : nothing}
        ${levelSlider('Volume', value, (v) => ed.setVolume({ level: v, muted: v === 0 }))}
        ${switchRow('Muted', 'Silence every sound', muted, (on) => ed.setVolume({ muted: on }))}
        <z-separator></z-separator>
        ${switchRow('Metronome', 'Click on every beat', metro.enabled, (on) => ed.transport.setMetronome({ enabled: on }))}
        ${levelSlider('Metronome volume', metro.volume, (v) => ed.transport.setMetronome({ volume: v, enabled: true }))}
      </div>
    </z-popover>`;
  }
}

// ── Tempo ───────────────────────────────────────────────────────────

/** A Zest number field with stepper buttons. Arrow keys nudge; Enter or leaving the field commits. */
@customElement('maddie-tempo')
export class MaddieTempo extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    css`
      z-number-input {
        width: 7.75rem;
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const bpm = ed.meta.tempo[0]?.bpm ?? 120;
    return html`${tooltip(
        'Tempo · type, or use the arrow keys',
        html`<z-number-input
          size="sm"
          label="Tempo"
          min="20"
          max="400"
          step="1"
          has-stepper-buttons
          .value=${live(bpm)}
          @change=${(e: CustomEvent<{ value: number }>) => ed.commands.setTempo(e.detail.value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') (e.composedPath()[0] as HTMLElement).blur();
          }}
        ></z-number-input>`,
      )}<span class="unit">BPM</span>`;
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
      ${iconButton({
        label: 'Undo',
        tip: tip(h.undoLabel ? `Undo ${h.undoLabel.toLowerCase()}` : 'Undo', `${modKeyLabel} Z`),
        icon: icons.undo,
        disabled: !h.canUndo,
        onClick: () => ed.undo(),
      })}
      ${iconButton({
        label: 'Redo',
        tip: tip(h.redoLabel ? `Redo ${h.redoLabel.toLowerCase()}` : 'Redo', `${modKeyLabel} ⇧ Z`),
        icon: icons.redo,
        disabled: !h.canRedo,
        onClick: () => ed.redo(),
      })}
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
      ${iconButton({
        label: 'Shorter rows',
        tip: tip('Shorter rows · ⌥ scroll', '⌥ −'),
        icon: icons.rowsShorter,
        disabled: ed.view.rowHeight <= minRh,
        onClick: () => rowZoomBy(ed, 1 / 1.25),
      })}
      ${iconButton({
        label: 'Taller rows',
        tip: tip('Taller rows · ⌥ scroll', '⌥ +'),
        icon: icons.rowsTaller,
        disabled: ed.view.rowHeight >= maxRh,
        onClick: () => rowZoomBy(ed, 1.25),
      })}
      <z-separator is-vertical></z-separator>
      ${iconButton({ label: 'Zoom out', tip: tip('Zoom out · ⌘ scroll', '−'), icon: icons.zoomOut, onClick: () => this.zoom(1 / 1.5) })}
      ${iconButton({ label: 'Zoom in', tip: tip('Zoom in · ⌘ scroll', '+'), icon: icons.zoomIn, onClick: () => this.zoom(1.5) })}
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
    return iconButton({
      label: 'Export MIDI',
      tip: tip('Export .mid', `${modKeyLabel} ⇧ E`),
      icon: icons.download,
      disabled: !this.ed.hasAnyNotes,
      onClick: () => this.export(),
    });
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
    return iconButton({
      label: 'Import MIDI',
      tip: tip('Import .mid · or drop on the grid', `${modKeyLabel} O`),
      icon: icons.upload,
      onClick: () => pickMidiFile(this.ed!, this),
    });
  }
}

// ── Toolbars ────────────────────────────────────────────────────────

/** A row is a bordered card surface: tone from `--card`, edge from `--border`, and the theme's own material and elevation (inert in the flat themes). */
const barStyles = css`
  :host {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    height: var(--_toolbar-height);
    padding: 0 var(--space-md);
    background-color: var(--_surface);
    background-image: var(--material-surface);
    box-shadow: var(--elevation-flush);
    border-bottom: 1px solid var(--_border);
    box-sizing: border-box;
    min-width: 0;
    color: var(--_text);
    position: relative;
    z-index: 3;
    container-type: inline-size;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .group {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-xs);
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
    dividerStyles,
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
      <z-separator is-vertical></z-separator>
      <div class="group" part="group playback">
        <maddie-loop-toggle></maddie-loop-toggle>
        <maddie-follow-toggle></maddie-follow-toggle>
      </div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group sound">
        <maddie-input></maddie-input>
        <maddie-output></maddie-output>
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

/** Second row: tools that change the grid below. Grid, key, fold, history, zoom. */
@customElement('maddie-editbar')
export class MaddieEditbar extends MaddieElement {
  static styles = [
    tokens,
    barStyles,
    dividerStyles,
    css`
      :host {
        height: var(--maddie-editbar-height, 56px);
        background-color: var(--maddie-editbar-bg, var(--color-neutral-1));
        background-image: none;
      }
    `,
  ];
  render() {
    return html`
      <div class="group" part="group grid">
        <maddie-grid-select></maddie-grid-select>
        <maddie-snap-toggle></maddie-snap-toggle>
      </div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group key">
        <maddie-key-select></maddie-key-select>
        <maddie-scale-lock></maddie-scale-lock>
      </div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group fold"><maddie-fold-select></maddie-fold-select></div>
      <div class="spacer"></div>
      <div class="group" part="group history"><maddie-history></maddie-history></div>
      <z-separator is-vertical></z-separator>
      <div class="group" part="group zoom"><maddie-zoom></maddie-zoom></div>
    `;
  }
}

/** Both rows, stacked: global on top, grid tools right above the grid. */
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
    `,
  ];

  render() {
    return html`<maddie-topbar part="topbar"><slot name="start" slot="start"></slot><slot name="end" slot="end"></slot></maddie-topbar>
      <maddie-editbar part="editbar"></maddie-editbar>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
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
