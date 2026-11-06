import { css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getTrackName, type Editor, type TrackMetaT } from '../core';
import type { Engine } from '../engine/engine';
import { normalizeColor } from '../engine/theme';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

type RenameKeyEventT = KeyboardEvent & { currentTarget: HTMLInputElement };

/** `<input type="color">` only takes #rrggbb. Track colors can be any CSS color. */
const toHexColor = (color: string): string => {
  const resolved = normalizeColor(color);
  const channels = /rgba?\((\d+),(\d+),(\d+)/.exec(resolved);
  if (!channels) return '#888888';
  const hexParts = [channels[1], channels[2], channels[3]].map((channel) => Number(channel).toString(16).padStart(2, '0'));
  return `#${hexParts.join('')}`;
};

type TrackColorGroupT = {
  name: string;
  shades: string[];
};

const LIGHTNESS_STEPS = [-0.12, 0, 0.12, 0.24];

/** Same hue and chroma, lighter or darker. For tokens that are a single color, not a scale. */
const buildShades = (token: string): string[] =>
  LIGHTNESS_STEPS.map((step) => {
    const isBase = step === 0;
    if (isBase) return `var(${token})`;
    const sign = step < 0 ? '-' : '+';
    return `oklch(from var(${token}) calc(l ${sign} ${Math.abs(step)}) c h)`;
  });

/** Zest's own 0–9 scales: four steps from the middle. */
const buildScaleShades = (scale: string): string[] => [3, 4, 5, 6].map((step) => `var(--color-${scale}-${step})`);

/** Preset track colors, taken from the design system so they follow the theme. */
const TRACK_COLOR_GROUPS: TrackColorGroupT[] = [
  { name: 'Primary', shades: buildScaleShades('primary') },
  { name: 'Secondary', shades: buildScaleShades('secondary') },
  { name: 'Success', shades: buildShades('--success') },
  { name: 'Warning', shades: buildShades('--warning') },
  { name: 'Error', shades: buildShades('--destructive') },
];

type PopoverElementT = HTMLElement & { isOpen: boolean };

/**
 * The track list: one chip per track, with its color, name, mute, solo and remove.
 * Click a chip to edit that track. Double-click its name to rename it.
 */
@customElement('maddie-tracks')
export class MaddieTracks extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: var(--space-md);
        padding: var(--space-sm) var(--space-md);
        background: var(--_surface);
        border-bottom: 1px solid var(--_border);
        color: var(--_text);
        font-size: var(--font-size-small);
        overflow-x: auto;
        scrollbar-width: thin;
      }
      .tabs {
        display: contents;
      }
      .track {
        display: flex;
        flex: none;
        align-items: center;
        gap: var(--space-xs);
        padding: 2px var(--space-xs) 2px var(--space-sm);
        border: 1px solid var(--_border);
        border-radius: var(--_radius-sm);
        background: var(--_surface-2);
        color: var(--_text-muted);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        transition:
          background-color var(--_motion-fast) var(--_ease),
          border-color var(--_motion-fast) var(--_ease),
          color var(--_motion-fast) var(--_ease);
      }
      .track:hover {
        border-color: var(--_text-faint);
      }
      .track.isActive {
        background: var(--_raised);
        border-color: var(--_text-faint);
        color: var(--_text);
      }
      .track.isMuted .track-name,
      .track.isMuted .track-color {
        opacity: 0.45;
      }
      .track-name {
        max-width: 10rem;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .track-name:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 2px;
        border-radius: var(--_radius-sm);
      }
      .rename-input {
        width: 8rem;
        padding: 0 var(--space-xs);
        border: 1px solid var(--_accent);
        border-radius: var(--_radius-sm);
        background: var(--_bg);
        color: var(--_text);
        font: inherit;
        font-weight: 500;
        outline: none;
      }
      .track-color {
        flex: none;
        width: 0.75rem;
        height: 0.75rem;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--_track-color);
        cursor: pointer;
      }
      .track-color:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 2px;
      }
      .color-panel {
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        color: var(--_text);
      }
      .color-swatches {
        display: grid;
        grid-template-columns: repeat(4, 1.5rem);
        gap: var(--space-xs);
      }
      .swatch {
        width: 1.5rem;
        height: 1.5rem;
        padding: 0;
        border: 1px solid var(--_border);
        border-radius: var(--_radius-sm);
        background: var(--_swatch);
        cursor: pointer;
        transition: border-color var(--_motion-fast) var(--_ease);
      }
      .swatch:hover {
        border-color: var(--_text);
      }
      .swatch:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 2px;
      }
    `,
  ];

  /** The track whose name is being edited. */
  @state() private renamingId: string | null = null;

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('tracks', update));
  }

  private activate(trackId: string) {
    this.ed?.setActiveTrack(trackId);
  }

  private startRename(trackId: string) {
    this.renamingId = trackId;
    this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('.rename-input')?.select());
  }

  private finishRename(trackId: string, name: string) {
    const isStillRenaming = this.renamingId === trackId;
    if (!isStillRenaming) return;
    this.renamingId = null;
    this.ed?.commands.renameTrack(trackId, name);
  }

  private cancelRename() {
    this.renamingId = null;
  }

  private handleRenameKey(event: RenameKeyEventT, trackId: string) {
    event.stopPropagation();
    if (event.key === 'Enter') this.finishRename(trackId, event.currentTarget.value);
    if (event.key === 'Escape') this.cancelRename();
  }

  private renderName(track: TrackMetaT, index: number) {
    const name = getTrackName(track, index);
    const isRenaming = this.renamingId === track.id;
    if (!isRenaming) {
      return html`<button
        type="button"
        class="track-name"
        role="tab"
        aria-selected=${track.id === this.ed?.activeTrackId}
        title="Double-click to rename"
        @click=${() => this.activate(track.id)}
        @dblclick=${() => this.startRename(track.id)}
        @keydown=${(event: KeyboardEvent) => event.key === 'F2' && this.startRename(track.id)}
      >
        ${name}
      </button>`;
    }
    return html`<input
      class="rename-input"
      aria-label="Track name"
      .value=${name}
      @click=${(event: Event) => event.stopPropagation()}
      @keydown=${(event: RenameKeyEventT) => this.handleRenameKey(event, track.id)}
      @blur=${(event: FocusEvent) => this.finishRename(track.id, (event.currentTarget as HTMLInputElement).value)}
    />`;
  }

  private pickColor(trackId: string, event: Event) {
    const swatch = event.currentTarget as HTMLElement;
    const resolvedColor = getComputedStyle(swatch).backgroundColor;
    const hexColor = toHexColor(resolvedColor);
    this.ed?.commands.setTrackColor(trackId, hexColor);
    const popover = swatch.closest('z-popover') as PopoverElementT | null;
    if (popover) popover.isOpen = false;
  }

  private renderSwatch(trackId: string, groupName: string, shade: string, shadeIndex: number) {
    const label = `${groupName} ${shadeIndex + 1}`;
    return html`<button
      type="button"
      class="swatch"
      style="--_swatch: ${shade}"
      title=${label}
      aria-label=${label}
      @click=${(event: Event) => this.pickColor(trackId, event)}
    ></button>`;
  }

  private renderColorGroup(trackId: string, group: TrackColorGroupT) {
    return group.shades.map((shade, shadeIndex) => this.renderSwatch(trackId, group.name, shade, shadeIndex));
  }

  private renderColor(track: TrackMetaT) {
    const color = this.ed!.getTrackColor(track.id);
    const swatches = TRACK_COLOR_GROUPS.map((group) => this.renderColorGroup(track.id, group));
    return html`<z-popover placement="bottom-start" label="Track color" @click=${(event: Event) => event.stopPropagation()}>
      <button slot="trigger" type="button" class="track-color" style="--_track-color: ${color}" title="Track color" aria-label="Track color"></button>
      <div class="color-panel">
        <div class="color-swatches">${swatches}</div>
      </div>
    </z-popover>`;
  }

  private renderToggle(label: string, text: string, isOn: boolean, tone: string, onToggle: (isOn: boolean) => void) {
    // Off looks neutral; the accent colour means "on".
    const shownTone = isOn ? tone : 'neutral';
    return html`<z-tooltip content=${label} placement="bottom">
      <z-toggle-button
        kind="ghost"
        size="sm"
        tone=${shownTone}
        aria-label=${label}
        .isPressed=${isOn}
        @click=${(event: Event) => event.stopPropagation()}
        @press=${(event: CustomEvent<{ pressed: boolean }>) => onToggle(event.detail.pressed)}
        >${text}</z-toggle-button
      >
    </z-tooltip>`;
  }

  private renderRemove(track: TrackMetaT) {
    const canRemove = this.ed!.trackIds.length > 1;
    if (!canRemove) return nothing;
    return html`<z-tooltip content="Remove track" placement="bottom">
      <z-button
        class="icon"
        kind="ghost"
        size="sm"
        aria-label="Remove track"
        @click=${(event: Event) => {
          event.stopPropagation();
          this.ed?.commands.removeTrack(track.id);
        }}
        >${icons.close}</z-button
      >
    </z-tooltip>`;
  }

  private renderTrack(track: TrackMetaT, index: number) {
    const ed = this.ed!;
    const isActive = track.id === ed.activeTrackId;
    const classes = ['track', isActive ? 'isActive' : '', track.muted ? 'isMuted' : ''].filter(Boolean).join(' ');
    return html`<div class=${classes} @click=${() => this.activate(track.id)}>
      ${this.renderColor(track)} ${this.renderName(track, index)}
      ${this.renderToggle('Mute', 'M', !!track.muted, 'secondary', (isOn) => ed.commands.setTrackMuted(track.id, isOn))}
      ${this.renderToggle('Solo', 'S', !!track.solo, 'primary', (isOn) => ed.commands.setTrackSolo(track.id, isOn))}
      ${this.renderRemove(track)}
    </div>`;
  }

  protected render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const tracks = ed.trackList;
    return html`<div class="tabs" role="tablist">
        ${tracks.map((track, index) => this.renderTrack(track, index))}
      </div>
      <z-tooltip content="Add track" placement="bottom">
        <z-button class="icon add" kind="ghost" size="sm" aria-label="Add track" @click=${() => ed.commands.addTrack()}>${icons.plus}</z-button>
      </z-tooltip>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-tracks': MaddieTracks;
  }
}
