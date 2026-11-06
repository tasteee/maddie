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
        gap: var(--space-xs);
        padding: var(--space-xs) var(--space-sm);
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
        border: 1px solid transparent;
        border-radius: var(--_radius-sm);
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
        background: var(--_hover);
      }
      .track.isActive {
        background: var(--_surface-2);
        border-color: var(--_border);
        color: var(--_text);
      }
      .track.isMuted .track-name,
      .track.isMuted .track-color {
        opacity: 0.45;
      }
      .track-color {
        position: relative;
        flex: none;
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 50%;
        background: var(--_track-color);
        cursor: pointer;
      }
      .track-color input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        padding: 0;
        border: 0;
        opacity: 0;
        cursor: pointer;
      }
      .track-name {
        min-width: 3rem;
        max-width: 10rem;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: 500;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        cursor: pointer;
      }
      .track-name:focus-visible,
      .rename-input:focus-visible {
        outline: 2px solid var(--_focus);
        outline-offset: 2px;
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
      }
      z-button.icon {
        width: var(--control-height-sm);
      }
      .add {
        flex: none;
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

  private renderColor(track: TrackMetaT) {
    const color = this.ed!.getTrackColor(track.id);
    const hexColor = toHexColor(color);
    return html`<label class="track-color" style="--_track-color: ${color}" title="Track color" @click=${(event: Event) => event.stopPropagation()}>
      <input
        type="color"
        aria-label="Track color"
        .value=${hexColor}
        @change=${(event: Event) => this.ed?.commands.setTrackColor(track.id, (event.currentTarget as HTMLInputElement).value)}
      />
    </label>`;
  }

  private renderToggle(label: string, text: string, isOn: boolean, accent: string, onToggle: (isOn: boolean) => void) {
    // Off looks neutral; the accent colour means "on".
    const shownAccent = isOn ? accent : 'neutral';
    return html`<z-tooltip content=${label} placement="bottom">
      <z-toggle-button
        kind="ghost"
        size="sm"
        accent=${shownAccent}
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
      ${this.renderToggle('Mute', 'M', !!track.muted, 'sub', (isOn) => ed.commands.setTrackMuted(track.id, isOn))}
      ${this.renderToggle('Solo', 'S', !!track.solo, 'dom', (isOn) => ed.commands.setTrackSolo(track.id, isOn))}
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
