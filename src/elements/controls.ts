import { unsafeCSS, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ref } from 'lit/directives/ref.js';
import { live } from 'lit/directives/live.js';
import {
  ticksToSeconds,
  exportFilename,
  formatBBT,
  GRID_OPTIONS,
  type GridValue,
  GRID_MODIFIERS,
  canHaveModifier,
  getGridModifier,
  getStraightGrid,
  setGridModifier,
  displayPitchClass,
  getEditorScaleId,
  SCALES,
  EDITOR_SCALE_IDS,
  type Editor,
  type FoldMode,
  type ScaleId,
  ZOOM_LIMITS,
} from '../core';
import type { Engine } from '../engine/engine';
import { clamp } from '../engine/ease';
import { setBaseOctave, setComputerKeyboard, setKeyboardScale } from '../engine/computer-keyboard';
import { captureMidi, modKeyLabel } from '../engine/keymap';
import { MidiInput, setMidiDevice, setMidiInput } from '../engine/midi-input';
import { MIDI_SOURCE, OutputRouter } from '../engine/output-router';
import { applyTheme, readAppSettings, writeAppSettings, type ExperimentalThemeKeyT, type ThemePreferenceT } from '../engine/app-settings';
import { getSoundOptions } from './sound-options';
import { MaddieElement } from './base';
import { icons } from './icons';
import { pickMidiFile, requestMidiExport } from './midi-io';
import { tokens } from './tokens';
import type { ZestTone, ZestOptionT } from './zest';
import { allowClicksThroughClosingPopover, sizeEditorMenu } from './zest';
import dividerCss from './toolbar-divider.css?raw';
import panelCss from './controls.css?raw';
import controlCss from './control.css?raw';
import transportCss from './transport.css?raw';
import zoomCss from './zoom-pad.css?raw';
import barCss from './toolbar-bar.css?raw';
import topbarCss from './topbar.css?raw';
import editbarCss from './editor-bar.css?raw';
import toolbarCss from './toolbar.css?raw';

/** The vertical divider between groups. Shared by the top bar, the edit bar and the selection bar so all three space it alike. */
export const dividerStyles = unsafeCSS(dividerCss);

/** Pieces shared by controls and the panels around them: layout and type only. Color, shape and state come from the Zest elements. */
export const partStyles = unsafeCSS(panelCss);

/** Shared look for a single control: an inline row of Zest elements. */
export const controlStyles = [
  unsafeCSS(controlCss),
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

type IconActionT = {
  label: string;
  tip: string;
  icon: unknown;
  onClick: () => void;
  disabled?: boolean;
  tone?: ZestTone;
  placement?: 'top' | 'bottom';
};

/** Icon-only action: a ghost `<z-button>` with a tooltip. */
const iconButton = (a: IconActionT) =>
  tooltip(
    a.tip,
    html`<z-button
      is-icon
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

type IconToggleT = {
  label: string;
  tip: string;
  icon: unknown;
  on: boolean;
  onToggle: (on: boolean) => void;
  disabled?: boolean;
  tone?: ZestTone;
  /** A visible label next to the icon. */
  text?: string;
};

/** On/off control: a ghost `<z-toggle-button>`; on is the filled accent. The editor owns the state, so `live` keeps the two in step. */
const iconToggle = (t: IconToggleT) =>
  tooltip(
    t.tip,
    html`<z-toggle-button
      kind="ghost"
      size="sm"
      tone=${t.tone ?? 'secondary'}
      ?is-icon=${!t.text}
      aria-label=${t.label}
      .isPressed=${live(t.on)}
      ?is-disabled=${t.disabled}
      @press=${(e: CustomEvent<{ pressed: boolean }>) => t.onToggle(e.detail.pressed)}
      >${t.icon}${t.text ?? nothing}</z-toggle-button
    >`,
  );

/** A Zest select that shows the editor's value. */
const select = (label: string, value: string, options: ZestOptionT[], onPick: (value: string) => void, placeholder?: string) =>
  html`<z-select
    size="sm"
    aria-label=${label}
    placeholder=${placeholder ?? nothing}
    .options=${options}
    .value=${live(value)}
    @change=${(e: CustomEvent<{ value: string }>) => onPick(e.detail.value)}
  ></z-select>`;

type ChoiceT = { value: string; label: string; isDisabled?: boolean };

// A toggle item centers its label inside its own shadow root, and exposes no part to change that.
const startAlignSheet = new CSSStyleSheet();
startAlignSheet.replaceSync('button { justify-content: flex-start; }');

const alignItemStart = (element?: Element) => {
  if (!element) return;
  const addSheet = () => {
    const root = element.shadowRoot;
    if (!root) return false;
    const hasSheet = root.adoptedStyleSheets.includes(startAlignSheet);
    if (!hasSheet) root.adoptedStyleSheets = [...root.adoptedStyleSheets, startAlignSheet];
    return true;
  };
  const isAdded = addSheet();
  if (!isAdded) requestAnimationFrame(addSheet);
};

const renderChoices = (
  label: string,
  choices: readonly ChoiceT[],
  selected: string,
  pick: (value: string) => void,
  columns?: number,
  align: 'center' | 'start' = 'center',
) => {
  const alignStart = align === 'start' ? ref(alignItemStart) : nothing;
  const buttons = choices.map((choice) => {
    const isPressed = choice.value === selected;
    const choose = (event: CustomEvent<{ pressed: boolean }>) => {
      const didUnpress = !event.detail.pressed;
      if (didUnpress) {
        const item = event.currentTarget as HTMLElement & { isPressed: boolean };
        queueMicrotask(() => { item.isPressed = true; });
        return;
      }
      pick(choice.value);
    };

    return html`<z-toggle-button-group-item ${alignStart} value=${choice.value} .isPressed=${live(isPressed)}
      ?is-disabled=${choice.isDisabled} @press=${choose}>${choice.label}</z-toggle-button-group-item>`;
  });

  return html`<z-toggle-button-group class="choices" kind="ghost" size="sm" aria-label=${label} columns=${columns ?? nothing}>
    ${buttons}
  </z-toggle-button-group>`;
};

const GRID_DIVISIONS = GRID_OPTIONS.filter((option) =>
  ['1/4', '1/8', '1/16', '1/32', '1/64'].includes(option.value),
);
const GRID_FEELS = [
  { label: 'Straight', value: 'straight' },
  { label: 'Triplet', value: 'triplet' },
  { label: 'Dotted', value: 'dotted' },
] as const;

@customElement('maddie-grid-select')
export class MaddieGridSelect extends ControlElement {
  /** The division to return to when Follow zoom is turned off. */
  private lastFixedGrid: GridValue = '1/16';

  render = () => {
    const ed = this.ed;
    const hasEditor = Boolean(ed);
    if (!hasEditor || !ed) return nothing;
    const size = getStraightGrid(ed.view.grid);
    const feel = getGridModifier(ed.view.grid);
    const isTriplet = feel === 'triplet';
    const isDotted = feel === 'dotted';
    let suffix = '';
    if (isTriplet) suffix = 'T';
    if (isDotted) suffix = '.';
    // Straight renders nothing, so it adds no gap before the chevron.
    const hasSuffix = suffix !== '';
    const suffixBadge = hasSuffix ? html`<span class="accent-icon">${suffix}</span>` : nothing;
    const triggerText = ed.view.grid === 'auto' ? 'Auto' : size;
    const pickSize = (value: string) => {
      const division = GRID_DIVISIONS.find((option) => option.value === value)?.value;
      if (!division) return;
      ed.setView({ grid: setGridModifier(division, feel) });
    };
    const pickFeel = (value: string) => {
      const modifier = GRID_MODIFIERS.find((option) => option === value);
      if (!modifier) return;
      ed.setView({ grid: setGridModifier(size, modifier) });
    };
    const feels = GRID_FEELS.map((option) => ({
      ...option,
      isDisabled: option.value !== 'straight' && !canHaveModifier(size),
    }));
    const divisions = renderChoices('Division', GRID_DIVISIONS, size, pickSize, GRID_DIVISIONS.length);
    const modifiers = renderChoices('Feel', feels, feel, pickFeel, feels.length);
    const snap = switchRow('Snap to grid', 'Hold Alt while dragging to bypass', ed.view.snap,
      (isChecked) => ed.setView({ snap: isChecked }));
    // Follow zoom: the grid gets finer as you zoom in, and snapping uses the lines you see.
    // Picking a division turns it off; turning it off brings back the last division.
    const isAuto = ed.view.grid === 'auto';
    const toggleAuto = (isOn: boolean) => {
      if (isOn) {
        this.lastFixedGrid = ed.view.grid;
        ed.setView({ grid: 'auto' });
        return;
      }
      ed.setView({ grid: this.lastFixedGrid });
    };
    const followZoom = switchRow('Follow zoom', 'Finer lines as you zoom in; snaps to the lines you see', isAuto, toggleAuto);
    const toggle = iconToggle({
      label: 'Snap to grid',
      tip: 'Snap to grid',
      icon: icons.magnet,
      on: ed.view.snap,
      onToggle: (isChecked) => ed.setView({ snap: isChecked }),
    });

    return html`<z-button-group class="grid-chip" aria-label="Grid">
      ${toggle}
      <z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-end" offset="6" aria-label="Grid">
        <z-button class="grid-value" slot="trigger" kind="ghost" size="sm" aria-label="Grid settings">
          ${triggerText}${suffixBadge}${icons.chevron}
        </z-button>
        <div class="panel standard-panel">
          <strong>Grid</strong>
          <div class="field"><span class="hint">Division</span>${divisions}</div>
          <div class="field"><span class="hint">Feel</span>${modifiers}</div>
          <z-separator></z-separator>${followZoom}${snap}
        </div>
      </z-popover>
    </z-button-group>`;
  };
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
      tone: 'secondary',
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

@customElement('maddie-key-select')
export class MaddieKeySelect extends ControlElement {
  @state() private query = '';
  private lastScale: ScaleId = 'minor';

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const key = ed.key;
    const hasKey = Boolean(key);
    const isLocked = hasKey && ed.view.scaleLock;
    const label = key ? formatEditorKey(key) : 'No key';
    const lock = isLocked ? html`<span class="accent-icon">${icons.lock}</span>` : nothing;
    const pickRoot = (value: string) => ed.commands.setKey({
      root: Number(value),
      scale: key?.scale ?? this.lastScale,
    });
    const pickScale = (value: string) => {
      const scale = EDITOR_SCALE_IDS.find((id) => id === value);
      if (!scale) return;
      this.lastScale = scale;
      ed.commands.setKey({ root: key?.root ?? 0, scale });
    };
    const clear = () => {
      if (key) this.lastScale = key.scale;
      ed.commands.setKey(null);
      const isFoldedInKey = ed.view.fold === 'scale';
      if (isFoldedInKey) ed.setView({ fold: 'none' }, { animate: true });
    };
    const roots = Array.from({ length: 12 }, (_, index) => ({
      value: String(index),
      label: displayPitchClass(index),
    }));
    const query = this.query.trim().toLowerCase();
    const scales = EDITOR_SCALE_IDS.map((id) => ({
      value: id,
      label: SCALES[id].name,
    })).filter((item) => item.label.toLowerCase().includes(query));
    const rootPicker = renderChoices('Root', roots, String(key?.root ?? ''), pickRoot, 6);
    const hasMatches = scales.length > 0;
    const currentScale = key ? getEditorScaleId(key.scale) : '';
    const scalePicker = hasMatches ? renderChoices('Scale', scales, currentScale, pickScale, 2, 'start') : html`<p>No scales match.</p>`;
    const clearButton = hasKey ? html`<z-button kind="ghost" tone="secondary" size="xs" @click=${clear}>Clear</z-button>` : nothing;
    const updateSearch = (event: CustomEvent<{ value: string }>) => { this.query = event.detail.value; };
    const resetSearch = (event: Event) => {
      const isOwnEvent = event.target === event.currentTarget;
      if (isOwnEvent) this.query = '';
    };
    // TODO(design): Connect detection once its behavior is decided.
    const detect = () => this.engine?.toast("Couldn't detect a key.");
    const highlight = switchRow('Highlight key', 'Shade rows outside the key', ed.view.scaleHighlight,
      (isChecked) => ed.setView({ scaleHighlight: isChecked }));
    const lockSetting = switchRow('Lock to key', 'New and moved notes stay in key', ed.view.scaleLock,
      (isChecked) => ed.setView({ scaleLock: isChecked }));

    return html`<z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-end" offset="6" aria-label="Key" @toggle=${resetSearch}>
      <z-button class="chip" slot="trigger" kind="outline" size="md">
        ${icons.music}<span class="key-value" ?data-unset=${!hasKey}>${label}</span>${lock}${icons.chevron}
      </z-button>
      <div class="panel wide-panel">
        <div class="panel-title"><strong>Key</strong>${clearButton}</div>
        <div class="field"><span class="hint">Root</span>${rootPicker}</div>
        <div class="field">
          <div class="level-label"><span>Scale</span><span>${EDITOR_SCALE_IDS.length} scales</span></div>
          <z-input type="search" size="sm" aria-label="Search scales" placeholder="Search scales"
            .value=${live(this.query)} @input=${updateSearch}></z-input>
          <z-scroll-area class="scale-list">${scalePicker}</z-scroll-area>
        </div>
        <z-button kind="outline" size="sm" is-full-width @click=${detect}>${icons.wand}Detect from notes</z-button>
        <z-separator></z-separator>
        ${highlight}${lockSetting}
      </div>
    </z-popover>`;
  };
}

const formatEditorKey = (key: NonNullable<Editor['key']>) =>
  `${displayPitchClass(key.root)} ${SCALES[key.scale].name.toLowerCase()}`;

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

const FOLD_CHOICES: readonly { value: FoldMode; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'used', label: 'Notes' },
  { value: 'scale', label: 'In key' },
];

@customElement('maddie-fold-select')
export class MaddieFoldSelect extends ControlElement {
  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const hasKey = Boolean(ed.key);
    const fold = ed.view.fold;
    const isFolded = fold !== 'none' && (fold !== 'scale' || hasKey);
    const isNotesMode = fold === 'used';
    const isKeyMode = isFolded && fold === 'scale';
    const mode = FOLD_CHOICES.find((choice) => choice.value === fold);
    const label = isFolded ? mode?.label : nothing;
    const keyDescription = ed.key ? `Only rows in ${formatEditorKey(ed.key)}` : 'Pick a key first';
    const pick = (event: CustomEvent<{ value: FoldMode }>) => {
      ed.setView({ fold: event.detail.value }, { animate: true });
    };
    const button = html`<z-toggle-button class="fold" kind="ghost" size="sm" tone="secondary" ?is-icon=${!isFolded}
      aria-label="Fold rows" .isPressed=${live(isFolded)}>${icons.fold}${label}</z-toggle-button>`;

    return html`<z-menu ${ref(sizeEditorMenu)} align="end" aria-label="Fold rows" @select=${pick}>
      <z-tooltip slot="trigger" content="Fold rows" placement="bottom">${button}</z-tooltip>
      <z-menu-item type="radio" value="none" ?is-checked=${!isFolded} description="Show every pitch">Off</z-menu-item>
      <z-menu-item type="radio" value="used" ?is-checked=${isNotesMode} description="Only rows with notes">Notes</z-menu-item>
      <z-menu-item type="radio" value="scale" ?is-checked=${isKeyMode}
        ?is-disabled=${!hasKey} description=${keyDescription}>In key</z-menu-item>
    </z-menu>`;
  };
}

// ── Transport ───────────────────────────────────────────────────────

/** Play/stop (from the marker), back to start, and the position readout. */
@customElement('maddie-transport')
export class MaddieTransport extends ControlElement {
  static styles = [
    tokens,
    controlStyles,
    unsafeCSS(transportCss),
  ];

  @state() private tickPosition = 0;
  private raf = 0;

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);

    this.track(
      editor.on('transport', this.updatePosition),
      editor.capture.onChange(() => this.requestUpdate()),
      () => cancelAnimationFrame(this.raf),
    );
    this.updatePosition();
  }

  private updatePosition = () => {
    const ed = this.ed;
    if (!ed) return;
    this.tickPosition = ed.transport.position;
    cancelAnimationFrame(this.raf);
    const isPlaying = ed.transport.playing;
    if (isPlaying) this.raf = requestAnimationFrame(this.updatePosition);
  };

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const transport = ed.transport;
    const recorder = ed.recorder;
    const isPlaying = transport.playing;
    const playLabel = isPlaying ? 'Stop' : 'Play';
    const playIcon = isPlaying ? icons.pause : icons.play;
    const togglePlay = () => {
      transport.toggle();
    };
    const start = iconButton({
      label: 'Go to start',
      tip: 'Go to start',
      icon: icons.rewind,
      onClick: () => {
        transport.seek(0);
        ed.setView({ cursor: 0 });
      },
    });
    const recordLabel = recorder.recording ? 'Stop recording' : 'Record';
    const record = iconToggle({
      label: recordLabel,
      tip: recordLabel,
      on: recorder.recording,
      icon: icons.record,
      tone: 'danger',
      onToggle: () => {
        const shouldHint = !recorder.recording && !ed.view.computerKeyboard && !ed.view.midiInput;
        if (shouldHint) this.engine?.toast('Turn on keyboard or MIDI input to play while recording');
        recorder.toggle();
      },
    });
    const canCapture = ed.capture.count > 0 && !recorder.recording && !ed.chordRegions;
    const captureLabel = canCapture ? 'Capture what you just played.' : 'Play something to capture it.';
    const capture = iconButton({
      label: captureLabel,
      tip: captureLabel,
      icon: icons.capture,
      disabled: !canCapture,
      onClick: () => captureMidi(ed),
    });
    const position = formatBBT(this.tickPosition, ed.meta.timeSignature, ed.ppq).split('.');
    const seconds = ticksToSeconds(this.tickPosition, ed.meta.tempo, ed.ppq);
    const tenths = Math.floor(seconds * 10);
    const time = `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
    const loop = iconToggle({
      label: 'Loop',
      tip: 'Loop',
      icon: icons.loop,
      on: transport.loop.enabled,
      onToggle: (enabled) => {
        const hasRange = transport.loop.end > transport.loop.start;
        if (!hasRange) {
          const signature = ed.meta.timeSignature[0];
          const end = ed.ppq * 8 * (signature.numerator / signature.denominator);
          transport.setLoop({ start: 0, end });
        }
        transport.setLoop({ enabled });
      },
    });
    const follow = iconToggle({
      label: 'Follow playhead',
      tip: 'Follow playhead',
      icon: icons.follow,
      on: ed.view.follow,
      onToggle: (isFollowing) => ed.setView({ follow: isFollowing }),
    });
    const metronome = iconToggle({
      label: 'Metronome',
      tip: 'Metronome',
      icon: icons.metronome,
      on: transport.metronome.enabled,
      onToggle: (enabled) => transport.setMetronome({ enabled }),
    });

    return html`<z-toolbar aria-label="Transport">
      <z-toolbar-group>
        ${start}
        <z-tooltip content=${playLabel} placement="bottom">
          <z-button class="play" kind="solid" tone="secondary" size="sm"
            aria-label=${playLabel} @click=${togglePlay}>${playIcon}</z-button>
        </z-tooltip>
        ${record}<span class="capture" ?data-ready=${canCapture}>${capture}</span>
      </z-toolbar-group>
      <z-separator is-vertical></z-separator>
      <z-toolbar-group>
        <div class="position" aria-label="Playback position" role="timer">
          <span>${position[0]}<span class="dot">.</span>${position[1]}<span class="dot">.</span>${position[2]}</span>
          <span class="elapsed">${time}</span>
        </div>
      </z-toolbar-group>
      <z-separator is-vertical></z-separator>
      <z-toolbar-group>${renderTempo(ed)}</z-toolbar-group>
      <z-separator is-vertical></z-separator>
      <z-toolbar-group>${loop}${follow}${metronome}</z-toolbar-group>
    </z-toolbar>`;
  };
}

const switchRow = (label: string, hint: string, on: boolean, onToggle: (on: boolean) => void, isDisabled = false) => {
  const change = (event: CustomEvent<{ checked: boolean }>) => onToggle(event.detail.checked);

  return html`<div class="switch-row">
    <span class="switch-copy" aria-hidden="true"><span>${label}</span><span class="hint">${hint}</span></span>
    <z-switch size="sm" tone="secondary" aria-label=${label} description=${hint}
      .isChecked=${live(on)} ?is-disabled=${isDisabled} @change=${change}></z-switch>
  </div>`;
};

const levelSlider = (label: string, value: number, onInput: (v: number) => void) => {
  const percent = Math.round(value * 100);
  const update = (event: CustomEvent<{ value: number }>) => onInput(event.detail.value / 100);
  const nudge = (event: KeyboardEvent) => {
    const isRight = event.key === 'ArrowRight';
    const isLeft = event.key === 'ArrowLeft';
    const shouldNudge = event.shiftKey && (isRight || isLeft);
    if (!shouldNudge) return;
    event.preventDefault();
    event.stopPropagation();
    const amount = isRight ? 10 : -10;
    onInput(Math.min(100, Math.max(0, percent + amount)) / 100);
  };

  return html`<z-slider aria-label=${label} tone="primary" min="0" max="100" step="1"
    .value=${live(percent)} @input=${update} @keydown=${nudge}>

  </z-slider>`;
};

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

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const view = ed.view;
    const midi = MidiInput.for(ed);
    const key = ed.key;
    const hint = key ? `Only play notes in ${formatEditorKey(key)}` : 'Pick a key first';
    // TODO(design): Decide whether disconnect changes the status dot.
    const status = view.midiInput && midi.status === 'ready' ? 'online' : 'offline';
    const keyboard = view.computerKeyboard ? html`<span class="accent-icon">${icons.keyboard}</span>` : nothing;
    const octave = Math.floor(view.keyboardBase / 12) - 1;
    const changeOctave = (event: CustomEvent<{ value: number }>) => setBaseOctave(ed, event.detail.value);
    const playInKey = switchRow('Play in key', hint, view.keyboardScale, (on) => setKeyboardScale(ed, on), !key);
    const keyboardSettings = view.computerKeyboard ? html`<div class="sub-panel">${playInKey}
      <div class="octave">
        <div class="field"><span>Base octave</span><span class="hint">Shift with − and =</span></div>
        <z-number-input size="sm" has-stepper-buttons min="0" max="7" aria-label="Base octave"
          .value=${live(octave)} @change=${changeOctave}></z-number-input>
      </div>
    </div>` : nothing;
    const devices = [{ value: '', label: 'All devices' }, ...midi.devices.map((device) => ({
      value: device.id, label: device.name,
    }))];
    const current = midi.devices.find((device) => device.id === view.midiDevice);
    // TODO(design): Decide whether to display disconnected devices.
    const deviceSelect = view.midiInput
      ? select('MIDI device', current?.id ?? '', devices, (id) => setMidiDevice(ed, id || null))
      : nothing;
    const isUnsupported = midi.status === 'unsupported';
    const isDenied = midi.status === 'denied';
    let midiHint = 'Notes play and record like keys';
    if (isUnsupported) midiHint = "This browser can't read MIDI devices";
    if (isDenied) midiHint = 'MIDI access was blocked';
    const keyboardSwitch = switchRow('Computer keyboard', 'Play notes with your QWERTY keys', view.computerKeyboard,
      (on) => setComputerKeyboard(ed, on));
    const midiSwitch = switchRow('MIDI controller', midiHint, view.midiInput, (on) => setMidiInput(ed, on));

    return html`<z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-end" offset="6" aria-label="Input">
      <z-button class="chip" slot="trigger" kind="outline" size="md" aria-label="Input"><z-status-dot aria-hidden="true" status=${status}></z-status-dot>Input${keyboard}${icons.chevron}</z-button>
      <div class="panel wide-panel"><strong>Input</strong>${keyboardSwitch}${keyboardSettings}
        <z-separator></z-separator>${midiSwitch}${deviceSelect}
      </div>
    </z-popover>`;
  };
}

type VolumeRowT = {
  name: string;
  icon: unknown;
  action: string;
  offLabel: string;
  isDim: boolean;
  isPressed: boolean;
  level: number;
  change: (level: number) => void;
  toggle: (isPressed: boolean) => void;
};

const renderVolumeRow = (row: VolumeRowT) => {
  const value = row.isDim ? row.offLabel : `${Math.round(row.level * 100)}%`;
  const classes = row.isDim ? 'level-controls isDim' : 'level-controls';
  const toggle = (event: CustomEvent<{ pressed: boolean }>) => row.toggle(event.detail.pressed);
  const slider = levelSlider(row.name, row.level, row.change);

  return html`<div class="level-row">
    <div class="level-label"><span>${row.name}</span><span>${value}</span></div>
    <div class=${classes}>
      <z-tooltip content=${row.action} placement="bottom">
        <z-toggle-button size="xs" is-icon kind="ghost" tone="secondary" aria-label=${row.action}
          .isPressed=${live(row.isPressed)} @press=${toggle}>${row.icon}</z-toggle-button>
      </z-tooltip>
      ${slider}
    </div>
  </div>`;
};

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

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const router = OutputRouter.for(ed);
    const volume = ed.volume;
    const metronome = ed.transport.metronome;
    const isMidi = router.source === MIDI_SOURCE;
    const chooseSound = (id: string) => {
      const isMidiOutput = id === MIDI_SOURCE;
      if (isMidiOutput) {
        void router.selectMidi();
        return;
      }
      router.selectSound(id);
    };
    const sound = select('Sound', router.source, getSoundOptions(router), chooseSound);
    const ports = router.ports.map((port) => ({ value: port.id, label: port.name }));
    const port = select('MIDI port', router.portId ?? '', ports, (id) => router.selectPort(id), 'No MIDI outputs found');
    const portField = isMidi && router.status === 'ready'
      ? html`<div class="field"><span class="hint">MIDI port</span>${port}</div>`
      : isMidi ? html`<z-button size="sm" ?is-disabled=${!router.supported || router.status === 'pending'}
          @click=${() => void router.selectMidi()}>Connect MIDI output</z-button>` : nothing;
    const speaker = volume.muted ? icons.mute : icons.volume;
    // TODO(design): Decide whether the master level sends MIDI CC7.
    const master = renderVolumeRow({
      name: 'Volume', icon: speaker, action: volume.muted ? 'Unmute output' : 'Mute output',
      offLabel: 'Muted', isDim: volume.muted, isPressed: volume.muted, level: volume.level,
      change: (level) => ed.setVolume({ level, muted: false }),
      toggle: (muted) => ed.setVolume({ muted }),
    });
    const click = renderVolumeRow({
      name: 'Metronome volume', icon: icons.metronome, action: 'Metronome',
      offLabel: 'Off', isDim: !metronome.enabled, isPressed: metronome.enabled, level: metronome.volume,
      change: (level) => ed.transport.setMetronome({ volume: level, enabled: true }),
      toggle: (enabled) => ed.transport.setMetronome({ enabled }),
    });

    return html`<z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-end" offset="6" aria-label="Output">
      <z-button class="chip" slot="trigger" kind="outline" size="md" aria-label="Output">${speaker}Output${icons.chevron}</z-button>
      <div class="panel wide-panel">
        <strong>Output</strong><div class="field"><span class="hint">Global sound</span>${sound}</div>
        ${portField}<z-separator></z-separator>${master}${click}
      </div>
    </z-popover>`;
  };
}

/**
 * App settings: how the app looks and which features show. They belong to the person, not to a
 * project, and are remembered in this browser.
 */
@customElement('maddie-settings')
export class MaddieSettings extends ControlElement {
  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    const settings = readAppSettings();
    applyTheme(settings.theme);
    editor.setView({
      ghostNotes: settings.ghostNotes,
      chordsPanelDark: settings.chordsPanelDark,
      chordCraftDark: settings.chordCraftDark,
      suggestionsDark: settings.suggestionsDark,
    });
    const watchSystem = matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => {
      const isSystem = readAppSettings().theme === 'system';
      if (isSystem) applyTheme('system');
    };
    watchSystem.addEventListener('change', followSystem);
    this.track(() => watchSystem.removeEventListener('change', followSystem));
  }

  private chooseTheme = (value: string) => {
    const theme = value as ThemePreferenceT;
    writeAppSettings({ theme });
    applyTheme(theme);
    this.requestUpdate();
  };

  private toggleGhostNotes = (ed: Editor, isOn: boolean) => {
    writeAppSettings({ ghostNotes: isOn });
    ed.setView({ ghostNotes: isOn });
  };

  private toggleExperimental = (ed: Editor, key: ExperimentalThemeKeyT, isOn: boolean) => {
    writeAppSettings({ [key]: isOn });
    ed.setView({ [key]: isOn });
  };

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const settings = readAppSettings();
    const themeOptions = [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ];
    const theme = select('Theme', settings.theme, themeOptions, this.chooseTheme);
    const ghostNotes = switchRow('Show other tracks', "Faint notes from other tracks behind the active one", ed.view.ghostNotes,
      (isOn) => this.toggleGhostNotes(ed, isOn));
    const darkPanel = switchRow('Dark chords panel', 'The whole chords panel in the dark theme', ed.view.chordsPanelDark,
      (isOn) => this.toggleExperimental(ed, 'chordsPanelDark', isOn));
    const darkCraft = switchRow('Dark chord card', 'The crafting card stays dark, whatever the panel is', ed.view.chordCraftDark,
      (isOn) => this.toggleExperimental(ed, 'chordCraftDark', isOn));
    const darkSuggestions = switchRow('Dark suggestions', 'The Suggestions rail in the dark theme', ed.view.suggestionsDark,
      (isOn) => this.toggleExperimental(ed, 'suggestionsDark', isOn));

    return html`<z-popover ${ref(allowClicksThroughClosingPopover)} placement="bottom-end" offset="6" aria-label="Settings">
      <z-button slot="trigger" kind="ghost" size="md" is-icon aria-label="Settings">${icons.settings}</z-button>
      <div class="panel wide-panel">
        <strong>Settings</strong>
        <div class="field"><span class="hint">Theme</span>${theme}</div>
        <z-separator></z-separator>
        ${ghostNotes}
        <z-separator></z-separator>
        <span class="hint">Experimental</span>
        ${darkPanel}
        ${darkCraft}
        ${darkSuggestions}
      </div>
    </z-popover>`;
  };
}

// ── Tempo ───────────────────────────────────────────────────────────

const cancelledTempoEdits = new WeakSet<EventTarget>();

// TODO(design): Decide how tempo drag-to-scrub behaves.
const renderTempo = (ed: Editor) => {
  const bpm = ed.meta.tempo[0]?.bpm ?? 120;
  const commit = (event: CustomEvent<{ value: number }>) => {
    const source = event.currentTarget as HTMLElement & { value: number };
    const wasCancelled = cancelledTempoEdits.delete(source);
    if (wasCancelled) {
      const previous = ed.meta.tempo[0]?.bpm ?? 120;
      queueMicrotask(() => { source.value = previous; });
      return;
    }
    const next = Math.round(Math.max(20, Math.min(300, event.detail.value)));
    const didChange = next !== (ed.meta.tempo[0]?.bpm ?? 120);
    if (didChange) ed.commands.setTempo(next);
  };
  const sanitize = (event: Event) => {
    const field = event.composedPath()[0];
    if (!(field instanceof HTMLInputElement)) return;
    const digits = field.value.replace(/\D/g, '').slice(0, 3);
    if (digits !== field.value) field.value = digits;
  };
  const handleKey = (event: KeyboardEvent) => {
    const field = event.composedPath()[0];
    if (!(field instanceof HTMLInputElement)) return;
    const isCancel = event.key === 'Escape';
    const isCommit = event.key === 'Enter';
    if (isCancel) {
      const source = event.currentTarget;
      if (source) cancelledTempoEdits.add(source);
      field.value = String(ed.meta.tempo[0]?.bpm ?? 120);
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }
    const shouldBlur = isCancel || isCommit;
    if (!shouldBlur) return;
    event.preventDefault();
    field.blur();
  };

  return html`<z-number-input size="sm" aria-label="Tempo" min="20" max="300" step="1"
    is-borderless is-inline value-suffix=" BPM" .value=${live(bpm)} @change=${commit}
    @keydown=${handleKey} @input=${captureNumberInput(sanitize)}></z-number-input>`;
};

const captureNumberInput = (handler: (event: Event) => void) => Object.assign(handler, { capture: true });

@customElement('maddie-tempo')
export class MaddieTempo extends ControlElement {
  render = () => this.ed ? renderTempo(this.ed) : nothing;
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
  static styles = [
    tokens,
    unsafeCSS(zoomCss),
  ];

  protected attach(editor: Editor, engine: Engine) {
    super.attach(editor, engine);
    this.track(editor.on('tracks', () => this.requestUpdate()));
  }

  render = () => {
    const ed = this.ed;
    const engine = this.engine;
    if (!ed || !engine) return nothing;
    const view = ed.view;
    const minTime = ZOOM_LIMITS.pxPerTick[0];
    const maxTime = ZOOM_LIMITS.pxPerTick[1];
    const minRow = ZOOM_LIMITS.rowHeight[0];
    const maxRow = ZOOM_LIMITS.rowHeight[1];
    const setRows = (amount: number) => ed.setView({ rowHeight: view.rowHeight + amount }, { animate: true });
    const setTime = (factor: number) => {
      const half = engine.viewport.width / 2;
      const anchor = view.scrollTick + half / view.pxPerTick;
      const pxPerTick = clamp(view.pxPerTick * factor, minTime, maxTime);
      ed.setView({ pxPerTick, scrollTick: Math.max(0, anchor - half / pxPerTick) }, { animate: true });
    };
    const fit = () => {
      const notes = ed.notes();
      const { width, height } = engine.viewport;
      if (!notes.length || !width || !height) return;
      const { virtual } = ed.rowMap;
      let start = Infinity, end = -Infinity, top = Infinity, bottom = -Infinity;
      for (const note of notes) {
        start = Math.min(start, note.start);
        end = Math.max(end, note.start + note.duration);
        top = Math.min(top, virtual[note.pitch]);
        bottom = Math.max(bottom, virtual[note.pitch] + 1);
      }
      const padding = Math.min(16, width * 0.05);
      const pxPerTick = clamp((width - 2 * padding) / Math.max(1, end - start), minTime, maxTime);
      const rowHeight = clamp(height / (bottom - top + 2), minRow, maxRow);
      engine.pauseFollow();
      ed.setView({
        pxPerTick,
        scrollTick: Math.max(0, (start + end - width / pxPerTick) / 2),
        rowHeight,
        scrollRow: clamp((top + bottom - height / rowHeight) / 2, 0, engine.maxScrollRow(rowHeight)),
      }, { animate: true });
    };
    const button = (label: string, icon: unknown, click: () => void, isDisabled = false) => html`
      <z-tooltip content=${label} placement="top">
        <button type="button" class="cell" aria-label=${label} ?disabled=${isDisabled} @click=${click}>${icon}</button>
      </z-tooltip>`;
    const out = button('Zoom out in time · Ctrl + scroll, or drag the ruler down', icons.minus, () => setTime(0.8), view.pxPerTick <= minTime);
    const inward = button('Zoom in on time · Ctrl + scroll, or drag the ruler up', icons.plus, () => setTime(1.25), view.pxPerTick >= maxTime);
    const shorter = button('Shorter rows · Alt + scroll, or drag the keyboard down', icons.minus, () => setRows(-2), view.rowHeight <= minRow);
    const taller = button('Taller rows · Alt + scroll, or drag the keyboard up', icons.plus, () => setRows(2), view.rowHeight >= maxRow);
    const all = button('Zoom to fit', icons.fit, fit, !ed.notes().length);

    // A flush L in the grid's corner: time zoom along the bottom edge, row height up
    // the right edge, Fit where they meet. Each control sits on the edge it changes.
    return html`<div class="rows" role="group" aria-label="Row height">${shorter}${taller}</div>
      <div class="time" role="group" aria-label="Time zoom">${out}${inward}</div>
      <div class="corner">${all}</div>`;
  };
}

@customElement('maddie-export')
export class MaddieExport extends ControlElement {
  /** Download name. `.mid` is added if missing. Default: `[key]-[scale]-[bpm]-DDMMYYYY-HHMM.mid`. */
  @property() filename = '';
  @property({ type: Boolean }) labeled = false;

  private export() {
    const ed = this.ed;
    if (!ed) return;
    requestMidiExport(ed.doc, this.filename || exportFilename(ed.doc), this);
  }

  render() {
    if (!this.ed) return nothing;
    if (this.labeled) return html`<z-button size="sm" kind="ghost" is-full-width
      ?is-disabled=${!this.ed.hasAnyNotes} @click=${() => this.export()}>${icons.download}Export MIDI</z-button>`;
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
 * Opens a .mid file and adds its tracks (undoable). Drag & drop onto the roll works too.
 * @fires maddie-import - Cancelable. `detail: { file, bytes }`. Call `preventDefault()` to handle it yourself.
 */
@customElement('maddie-import')
export class MaddieImport extends ControlElement {
  @property({ type: Boolean }) labeled = false;

  render() {
    if (!this.ed) return nothing;
    if (this.labeled) return html`<z-button size="sm" kind="ghost" is-full-width
      @click=${() => pickMidiFile(this.ed!, this)}>${icons.upload}Import MIDI</z-button>`;
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
const barStyles = unsafeCSS(barCss);

@customElement('maddie-topbar')
export class MaddieTopbar extends MaddieElement {
  static styles = [
    tokens,
    barStyles,
    dividerStyles,
    unsafeCSS(topbarCss),
  ];

  render = () => html`
    <div class="group project" part="group project">
      <slot name="start"></slot><z-separator is-vertical></z-separator><maddie-history></maddie-history>
    </div>
    <maddie-transport part="transport"></maddie-transport>
    <div class="group sound" part="group sound">
      <maddie-input></maddie-input><maddie-output></maddie-output><maddie-settings></maddie-settings><slot name="end"></slot>
    </div>
  `;
}

@customElement('maddie-editbar')
export class MaddieEditbar extends MaddieElement {
  static styles = [
    tokens,
    barStyles,
    dividerStyles,
    unsafeCSS(editbarCss),
  ];

  render = () => html`
    <div class="tracks"><slot name="tracks"></slot></div>
    <div class="group" part="group grid-tools">
      <maddie-grid-select></maddie-grid-select>
      <maddie-key-select></maddie-key-select>
      <z-separator is-vertical></z-separator>
      <maddie-fold-select></maddie-fold-select>
    </div>
  `;
}

@customElement('maddie-toolbar')
export class MaddieToolbar extends MaddieElement {
  static styles = [
    tokens,
    unsafeCSS(toolbarCss),
  ];

  render = () => html`
    <maddie-topbar part="topbar"><slot name="start" slot="start"></slot><slot name="end" slot="end"></slot></maddie-topbar>
    <maddie-editbar part="editbar"><slot name="tracks" slot="tracks"></slot></maddie-editbar>
  `;
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
    'maddie-settings': MaddieSettings;
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
