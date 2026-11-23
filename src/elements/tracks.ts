import { html, nothing, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { keyed } from 'lit/directives/keyed.js';
import { createId, getTrackName } from '../core';
import type { Editor, TrackMetaT } from '../core';
import { modKeyLabel } from '../engine/keymap';
import { OutputRouter } from '../engine/output-router';
import { MaddieElement } from './base';
import { icons } from './icons';
import { requestMidiExport } from './midi-io';
import { tokens } from './tokens';
import { renderTrackOutput } from './track-outputs';
import trackStyles from './tracks.css?raw';
import { sizeEditorMenu } from './zest';

const TRACK_SWATCHES = [
  { name: 'Violet', color: 'var(--accent-spark-1)' },
  { name: 'Pink', color: 'var(--accent-spark-2)' },
  { name: 'Amber', color: 'var(--accent-spark-3)' },
  { name: 'Green', color: 'var(--accent-spark-4)' },
  { name: 'Blue', color: 'var(--accent-spark-5)' },
];

type TrackActionT = 'rename' | 'duplicate' | 'export' | 'chords' | 'delete';

const navigateSwatches = (event: KeyboardEvent) => {
  const isPrevious = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
  const isNext = event.key === 'ArrowRight' || event.key === 'ArrowDown';
  const shouldMove = isPrevious || isNext;
  if (!shouldMove) return;
  const field = event.currentTarget as HTMLDivElement;
  const radios = Array.from(field.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const index = radios.findIndex((button) => button === event.target);
  const offset = isPrevious ? -1 : 1;
  const next = radios[(index + offset + radios.length) % radios.length];
  if (!next) return;
  event.preventDefault();
  event.stopPropagation();
  next.focus();
  next.click();
};

const bindTrackMenu = (element?: Element) => {
  if (!element) return;
  const root = element.shadowRoot;
  const trigger = element.querySelector('.track-menu');
  if (!root || !trigger) {
    requestAnimationFrame(() => {
      if (element.isConnected) bindTrackMenu(element);
    });
    return;
  }

  root.addEventListener('toggle', (event) => {
    const panel = event.target;
    if (!(panel instanceof HTMLElement) || !panel.hasAttribute('popover')) return;
    const isOpen = panel.matches(':popover-open');
    trigger.setAttribute('aria-expanded', String(isOpen));
    element.toggleAttribute('data-expanded', isOpen);
  }, true);
};

const renderSwatches = (ed: Editor, track: TrackMetaT) => {
  const currentColor = ed.getTrackColor(track.id);
  const hasSelected = TRACK_SWATCHES.some((swatch) => swatch.color === currentColor);
  const swatches = TRACK_SWATCHES.map((swatch, index) => {
    const isSelected = currentColor === swatch.color;
    const isTabStop = isSelected || (!hasSelected && index === 0);
    const tabIndex = isTabStop ? 0 : -1;
    const choose = () => ed.commands.setTrackColor(track.id, swatch.color);
    const fill = `--swatch: ${swatch.color}`;

    return html`<button type="button" class="swatch" role="radio"
      aria-label=${swatch.name} aria-checked=${isSelected} tabindex=${tabIndex} style=${fill} @click=${choose}></button>`;
  });

  return html`<div>
    <span class="track-control-label">Color</span>
    <div class="swatches" role="radiogroup" aria-label="Track color" @keydown=${navigateSwatches}>${swatches}</div>
  </div>`;
};

const renderTrackActions = (isLast: boolean, isChord: boolean) => {
  const chords = isChord ? html`<z-menu-item value="chords">Show chords</z-menu-item>` : nothing;

  return html`<z-menu-separator></z-menu-separator>
    <z-menu-item value="rename" shortcut="Double-click">${icons.draw} Rename</z-menu-item>
    <z-menu-item value="duplicate">${icons.duplicate} Duplicate</z-menu-item>
    <z-menu-item value="export">${icons.download} Export MIDI…</z-menu-item>
    ${chords}
    <z-menu-separator></z-menu-separator>
    <z-menu-item value="delete" is-danger ?is-disabled=${isLast}>${icons.trash} Delete track</z-menu-item>`;
};

@customElement('maddie-tracks')
export class MaddieTracks extends MaddieElement {
  static styles = [tokens, unsafeCSS(trackStyles)];

  @state() private renamingId: string | null = null;
  @state() private hasOverflow = false;
  // Bumped after a drag so the list is rebuilt from data, not from the nodes the sortable moved.
  @state() private sortEpoch = 0;
  private lastActiveId?: string;
  private gainGestures = new WeakMap<HTMLInputElement, string>();

  protected attach(editor: Editor) {
    this.track(editor.on('tracks', () => this.requestUpdate()));
    this.track(OutputRouter.for(editor).onChange(() => this.requestUpdate()));
    const resize = new ResizeObserver(this.updateOverflow);
    resize.observe(this);
    this.track(() => resize.disconnect());
  }

  private updateOverflow = () => {
    const tabs = this.renderRoot.querySelector('.tabs');
    if (!tabs) return;
    this.hasOverflow = tabs.scrollLeft + tabs.clientWidth + 1 < tabs.scrollWidth;
  };

  protected updated() {
    this.updateOverflow();
    const activeId = this.ed?.activeTrackId;
    const didChange = activeId !== this.lastActiveId;
    if (!didChange) return;
    this.lastActiveId = activeId;
    this.renderRoot.querySelector('.isActive')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private startRename = (id: string) => {
    this.renamingId = id;
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('.rename-input')?.select());
  };

  private finishRename = (id: string, value?: string) => {
    const isEditing = this.renamingId === id;
    if (!isEditing) return;
    this.renamingId = null;
    const shouldCommit = Boolean(value?.trim());
    if (shouldCommit && value) this.ed?.commands.renameTrack(id, value);
  };

  private renderName = (ed: Editor, track: TrackMetaT, name: string, isActive: boolean) => {
    const isEditing = this.renamingId === track.id;
    const activate = () => ed.setActiveTrack(track.id);
    const rename = () => this.startRename(track.id);
    const onKey = (event: KeyboardEvent) => {
      const isRename = event.key === 'F2';
      if (isRename) rename();
    };
    const tabIndex = isActive ? 0 : -1;
    // Select on pointerdown: the sortable captures the pointer, which can swallow the click.
    if (!isEditing) return html`<button type="button" class="track-name" role="tab" title=${name} data-track-id=${track.id}
      tabindex=${tabIndex} aria-selected=${isActive} @pointerdown=${activate} @click=${activate} @keydown=${onKey}>${name}</button>`;

    const commit = (event: Event) => this.finishRename(track.id, (event.currentTarget as HTMLInputElement).value);
    const onEditKey = (event: KeyboardEvent) => {
      const shouldCancel = event.key === 'Escape';
      const shouldCommit = event.key === 'Enter';
      const shouldFinish = shouldCancel || shouldCommit;
      if (!shouldFinish) return;
      event.preventDefault();
      event.stopPropagation();
      const element = (event.currentTarget as HTMLElement).closest('.track');
      if (shouldCancel) this.finishRename(track.id);
      if (shouldCommit) commit(event);
      void this.updateComplete.then(() => element?.querySelector<HTMLElement>('.track-name')?.focus());
    };

    return html`<input class="rename-input" aria-label="Track name"
      .value=${name} @blur=${commit} @keydown=${onEditKey}>`;
  };

  // A menu closes on any pointerdown outside it. The tab strip stops those for its own buttons,
  // so replay one from this element, which sits outside every menu.
  private closeOpenMenus = () => {
    this.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0 }));
  };

  private openMenu = (event: MouseEvent) => {
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLButtonElement;
    const tab = trigger.closest('.track');
    if (!tab) return;
    const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
    this.closeOpenMenus();
    if (wasOpen) return;
    const bounds = tab.getBoundingClientRect();

    // Anchor the context menu to the tab for the explicit trigger.
    tab.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      composed: true,
      cancelable: true,
      clientX: bounds.left,
      clientY: bounds.bottom + 6,
      detail: -1,
    }));
  };

  private renderGain(ed: Editor, trackId: string, name: string) {
    const percent = Math.round(ed.getTrackGain(trackId) * 100);
    const start = (event: PointerEvent) => {
      const slider = event.currentTarget as HTMLInputElement;
      this.gainGestures.set(slider, createId());
    };
    const end = (event: Event) => this.gainGestures.delete(event.currentTarget as HTMLInputElement);
    const change = (event: Event) => {
      const slider = event.currentTarget as HTMLInputElement;
      ed.commands.setTrackGain(trackId, slider.valueAsNumber / 100, { gestureId: this.gainGestures.get(slider) });
      this.requestUpdate();
    };
    const onKey = (event: KeyboardEvent) => {
      end(event);
      if (event.key !== 'Escape' && event.key !== 'Tab' && !event.ctrlKey && !event.metaKey) event.stopPropagation();
    };
    return html`<label class="track-gain">
      <span class="track-control-label">Gain</span>
      <span class="gain-value" aria-hidden="true">${percent}%</span>
      <input type="range" min="0" max="100" step="1" .value=${live(String(percent))}
        aria-label=${name + ' gain'} aria-valuetext=${percent + '%'}
        @pointerdown=${start} @pointercancel=${end} @change=${end} @input=${change} @keydown=${onKey}>
    </label>`;
  }

  private renderTrack = (ed: Editor, track: TrackMetaT, index: number) => {
    const isActive = ed.activeTrackId === track.id;
    const isSilent = !ed.isTrackAudible(track.id);
    const isChord = Boolean(track.chordRegions);
    const isLast = ed.trackIds.length === 1;
    const name = getTrackName(track, index);
    const colors = renderSwatches(ed, track);
    const actions = renderTrackActions(isLast, isChord);
    const nameControl = this.renderName(ed, track, name, isActive);
    const fill = `--track-color: ${ed.getTrackColor(track.id)}`;
    const classes = classMap({ track: true, isActive, isSilent, isChord });
    const menuLabel = name + ' options';
    const muteLabel = 'Mute ' + name;
    const soloLabel = 'Solo ' + name;
    const mute = () => ed.commands.setTrackMuted(track.id, !track.muted);
    const isImplied = isSilent && !track.muted;
    const muteTip = isImplied ? 'Silenced by solo' : muteLabel;
    const soloTip = soloLabel + '  ·  ' + modKeyLabel + '-click to add';
    const muteClasses = classMap({ 'track-toggle': true, mute: true, isImplied });
    const solo = (event: MouseEvent) => {
      const isAdditive = event.ctrlKey || event.metaKey;
      ed.commands.soloTrack(track.id, isAdditive);
    };
    const activateOnContext = (event: MouseEvent) => {
      const isContextClick = event.detail !== -1;
      if (!isContextClick) return;
      ed.setActiveTrack(track.id);
      // Close other menus from outside the sortable strip. A synthetic pointerdown on the
      // tab itself starts a sort drag that never ends, so the tab follows the mouse.
      this.closeOpenMenus();
    };
    const selectAction = (event: CustomEvent<{ value: TrackActionT }>) => {
      const action = event.detail.value;
      if (action === 'rename') this.startRename(track.id);
      if (action === 'duplicate') ed.commands.duplicateTrack(track.id);
      if (action === 'delete') {
        const wasActive = ed.activeTrackId === track.id;
        const didRemove = ed.commands.removeTrack(track.id);
        if (wasActive && didRemove) ed.setActiveTrack(ed.trackIds[0]);
      }
      if (action === 'chords') {
        ed.setActiveTrack(track.id);
        ed.setView({ chordsPanel: true });
      }
      if (action === 'export') {
        const stem = name.replace(/\.midi?$/i, '').replace(/[<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '') || 'Track';
        requestMidiExport(ed.doc, stem + '.mid', this, { tracks: [track.id] });
      }
    };

    // The sortable measures its direct children; z-context-menu has no box, so each tab gets a real one.
    return html`<div class="tab-slot" style=${fill}><z-context-menu ${ref(bindTrackMenu)} style=${fill} @select=${selectAction}>
      <div class=${classes} @contextmenu=${activateOnContext}>
        <div class="lead">
          <span class="track-dot" aria-hidden="true"></span>
          <button class="track-menu" type="button" aria-label=${menuLabel} aria-haspopup="menu" aria-expanded="false"
            @click=${this.openMenu}>${icons.more}</button>
        </div>
        ${nameControl}
        <div class="track-toggles">
          <z-tooltip content=${muteTip} placement="bottom">
            <button type="button" class=${muteClasses} aria-label=${muteLabel} aria-pressed=${Boolean(track.muted)} @click=${mute}>M</button>
          </z-tooltip>
          <z-tooltip content=${soloTip} placement="bottom">
            <button type="button" class="track-toggle solo" aria-label=${soloLabel} aria-pressed=${Boolean(track.solo)} @click=${solo}>S</button>
          </z-tooltip>
        </div>
      </div>
      <div slot="controls" class="track-options">
        ${colors}
        ${this.renderGain(ed, track.id, name)}
        ${renderTrackOutput(ed, OutputRouter.for(ed), track, index)}
      </div>
      ${actions}
    </z-context-menu></div>`;
  };

  // Buttons and fields keep their own clicks; only the tab body starts a drag.
  private guardSortPointer = (event: PointerEvent) => {
    const isPrimary = event.button === 0;
    const path = event.composedPath();
    const isControl = path.some((item) => item instanceof HTMLElement && item.matches('.track-toggle, .track-menu, .rename-input'));
    const shouldIgnore = !isPrimary || isControl;
    const isMenuTrigger = path.some((item) => item instanceof HTMLElement && item.matches('.track-menu'));
    const isOtherControl = isControl && !isMenuTrigger;
    if (isOtherControl) this.closeOpenMenus();
    if (shouldIgnore) event.stopPropagation();
  };

  // The sortable captures the pointer, so a double-click lands on it; find the tab under the cursor.
  private renameTabAtPointer = (event: MouseEvent) => {
    const hits = this.shadowRoot?.elementsFromPoint(event.clientX, event.clientY) ?? [];
    const nameButton = hits.find((item) => item.matches('.track-name[data-track-id]'));
    const trackId = nameButton?.getAttribute('data-track-id');
    if (trackId) this.startRename(trackId);
  };

  private sortTracks = (event: CustomEvent<{ oldIndex: number; newIndex: number }>) => {
    event.stopPropagation();
    const ed = this.ed;
    if (!ed) return;
    const movedId = ed.trackIds[event.detail.oldIndex];
    if (movedId) ed.commands.moveTrack(movedId, event.detail.newIndex);
    this.sortEpoch += 1;
  };

  private moveTab = (event: KeyboardEvent) => {
    const target = event.composedPath()[0];
    const isTab = target instanceof HTMLElement && target.getAttribute('role') === 'tab';
    if (!isTab) return;
    const isNext = event.key === 'ArrowRight';
    const isPrevious = event.key === 'ArrowLeft';
    const shouldMove = isNext || isPrevious;
    if (!shouldMove) return;
    const tabs = Array.from(this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index = tabs.findIndex((tab) => tab === target);
    const offset = isNext ? 1 : -1;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    if (!next) return;
    event.preventDefault();
    next.click();
    next.focus();
  };

  render = () => {
    const ed = this.ed;
    if (!ed) return nothing;
    const addTrack = (event: CustomEvent<{ value: string }>) => {
      const isChord = event.detail.value === 'chords';
      ed.commands.addTrack({ chords: isChord });
      if (isChord) ed.setView({ chordsPanel: true, chordsTab: 'all' });
    };
    const tracks = repeat(ed.trackList, (track) => track.id, (track, index) => this.renderTrack(ed, track, index));

    // TODO(design): Consider a side list for larger sessions.
    const guardOptions = { handleEvent: this.guardSortPointer, capture: true };
    const sortable = html`<z-sortable is-horizontal handle=".track"
      @pointerdown=${guardOptions} @sort=${this.sortTracks}>${tracks}</z-sortable>`;
    return html`<div class="tabs" role="tablist" aria-label="Tracks"
      @keydown=${this.moveTab} @scroll=${this.updateOverflow} @dblclick=${this.renameTabAtPointer}>
      ${keyed(this.sortEpoch, sortable)}
    </div>
    <div class="add-track" ?data-overflow=${this.hasOverflow}>
      <z-menu ${ref(sizeEditorMenu)} align="start" @select=${addTrack}>
        <z-tooltip slot="trigger" content="Add track" placement="bottom">
          <z-button kind="ghost" size="sm" is-icon aria-label="Add track">${icons.plus}</z-button>
        </z-tooltip>
        <z-menu-item value="midi">${icons.piano} MIDI track</z-menu-item>
        <z-menu-item value="chords">${icons.chordTrack} Chord track</z-menu-item>
      </z-menu>
    </div>`;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-tracks': MaddieTracks;
  }
}
