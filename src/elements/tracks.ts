import { html, nothing, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';
import { ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
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

type TrackActionT = 'duplicate' | 'export' | 'chords' | 'delete';

type TrackNameField = HTMLElement & { value: string };

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

const isTrackMenuOpen = (panel?: HTMLElement | null) =>
  Boolean(panel?.matches(':popover-open') && panel.dataset.state !== 'closing');

const bindTrackMenu = (element?: Element) => {
  if (!element) return;
  const root = element.shadowRoot;
  const panel = root?.querySelector<HTMLElement>('[popover]');
  const trigger = element.querySelector('.track-menu');
  if (!panel || !trigger) {
    requestAnimationFrame(() => {
      if (element.isConnected) bindTrackMenu(element);
    });
    return;
  }

  const update = () => {
    const isOpen = isTrackMenuOpen(panel);
    const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
    // Zest leaves the popover in the top layer while it fades out.
    panel.style.pointerEvents = panel.dataset.state === 'closing' ? 'none' : '';
    trigger.setAttribute('aria-expanded', String(isOpen));
    element.toggleAttribute('data-expanded', isOpen);
    if (!isOpen || wasOpen) return;
    const input = element.querySelector('.track-name-field')?.shadowRoot?.querySelector('input');
    input?.focus({ preventScroll: true });
    input?.select();
  };
  panel.addEventListener('toggle', update);
  new MutationObserver(update).observe(panel, { attributeFilter: ['data-state'] });
  update();
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
    <z-menu-item value="duplicate">${icons.duplicate} Duplicate</z-menu-item>
    <z-menu-item value="export">${icons.download} Export MIDI…</z-menu-item>
    ${chords}
    <z-menu-separator></z-menu-separator>
    <z-menu-item value="delete" is-danger ?is-disabled=${isLast}>${icons.trash} Delete track</z-menu-item>`;
};

@customElement('maddie-tracks')
export class MaddieTracks extends MaddieElement {
  static styles = [tokens, unsafeCSS(trackStyles)];

  @state() private hasOverflow = false;
  private lastActiveId?: string;
  private sortPosition?: { tab: Element; next: ChildNode | null; newIndex?: number };
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
    this.hasOverflow = tabs.clientWidth < tabs.scrollWidth;
  };

  protected updated() {
    this.updateOverflow();
    const activeId = this.ed?.activeTrackId;
    const didChange = activeId !== this.lastActiveId;
    if (!didChange) return;
    this.lastActiveId = activeId;
    this.renderRoot.querySelector('.isActive')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private renderName = (ed: Editor, track: TrackMetaT, name: string, isActive: boolean, isChord: boolean) => {
    const activate = () => ed.setActiveTrack(track.id);
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F2') return;
      event.preventDefault();
      const tab = (event.currentTarget as HTMLElement).closest('.track');
      tab?.querySelector<HTMLButtonElement>('.track-menu')?.click();
    };
    const tabIndex = isActive ? 0 : -1;
    // Select on pointerdown: the sortable captures the pointer, which can swallow the click.
    return html`<button type="button" class="track-name" role="tab" title=${isChord ? `${name} · Chord track` : name}
      aria-description=${isChord ? 'Chord track' : nothing} tabindex=${tabIndex} aria-selected=${isActive}
      @pointerdown=${activate} @click=${activate} @keydown=${onKey}>
      ${isChord ? html`<span class="track-type" aria-hidden="true">${icons.chordTrack}</span>` : nothing}
      <span class="track-name-text">${name}</span>
    </button>`;
  };

  private renderMenuName(ed: Editor, trackId: string, name: string) {
    const resetField = (field: TrackNameField, value: string) => {
      field.value = value;
      const input = field.shadowRoot?.querySelector('input');
      if (input) input.value = value;
    };
    const commit = (event: CustomEvent<{ value: string }>) => {
      const index = ed.trackList.findIndex(({ id }) => id === trackId);
      const track = ed.trackList[index];
      if (!track) return;
      const currentName = getTrackName(track, index);
      const value = event.detail.value.trim();
      if (value && value !== currentName) ed.commands.renameTrack(trackId, value);
      resetField(event.currentTarget as TrackNameField, value || currentName);
    };
    const onKey = (event: KeyboardEvent) => {
      const field = event.currentTarget as TrackNameField;
      if (event.key === 'Escape' && !event.isComposing) {
        resetField(field, name);
        return;
      }
      if (event.key === 'Tab') return;
      // Arrow keys and Space belong to the field while editing, not to menu items.
      event.stopPropagation();
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        field.shadowRoot?.querySelector('input')?.blur();
      }
    };
    return html`<z-input class="track-name-field" size="sm" aria-label="Track name" .value=${name}
      @change=${commit} @keydown=${onKey}></z-input>`;
  }

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
    const panel = tab.closest('z-context-menu')?.shadowRoot?.querySelector<HTMLElement>('[popover]');
    const wasOpen = isTrackMenuOpen(panel);
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
    const nameControl = this.renderName(ed, track, name, isActive, isChord);
    const fill = `--track-color: ${ed.getTrackColor(track.id)}`;
    const classes = classMap({ track: true, isActive, isSilent });
    const menuLabel = name + ' options';
    const muteLabel = 'Mute ' + name;
    const soloLabel = 'Solo ' + name;
    const mute = () => ed.commands.setTrackMuted(track.id, !track.muted);
    const isImplied = isSilent && !track.muted;
    const muteTip = isImplied ? 'Another track is soloed' : muteLabel;
    const additiveClick = `${modKeyLabel}+click`;
    const hasOtherSolo = track.solo && ed.trackList.some((other) => other.id !== track.id && other.solo);
    const soloTip = track.solo
      ? hasOtherSolo ? `Solo this track alone. ${additiveClick} to unsolo just this track.` : 'Unsolo this track.'
      : `Solo this track. ${additiveClick} to keep other tracks soloed.`;
    const muteClasses = classMap({ 'track-toggle': true, mute: true, isImplied });
    const solo = (event: MouseEvent) => {
      const isAdditive = event.ctrlKey || event.metaKey;
      ed.commands.soloTrack(track.id, isAdditive);
    };
    const activateOnContext = (event: MouseEvent) => {
      const tab = event.currentTarget as HTMLElement;
      const panel = tab.closest('z-context-menu')?.shadowRoot?.querySelector<HTMLElement>('[popover]');
      // Zest cancels the exit timer on reopen, but a still-visible popover keeps its closing state.
      if (panel?.dataset.state === 'closing') delete panel.dataset.state;
      const isContextClick = event.detail !== -1;
      if (!isContextClick) return;
      ed.setActiveTrack(track.id);
      // Close other menus from outside the sortable strip. A synthetic pointerdown on the
      // tab itself starts a sort drag that never ends, so the tab follows the mouse.
      this.closeOpenMenus();
    };
    const selectAction = (event: CustomEvent<{ value: TrackActionT }>) => {
      if (!ed.trackIds.includes(track.id)) return;
      const action = event.detail.value;
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
        ${this.renderMenuName(ed, track.id, name)}
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
    const isControl = path.some((item) => item instanceof HTMLElement && item.matches('.track-toggle, .track-menu'));
    const shouldIgnore = !isPrimary || isControl;
    const isMenuTrigger = path.some((item) => item instanceof HTMLElement && item.matches('.track-menu'));
    const isOtherControl = isControl && !isMenuTrigger;
    if (isOtherControl) this.closeOpenMenus();
    if (shouldIgnore) event.stopPropagation();
  };

  private startSort = (event: CustomEvent<{ index: number }>) => {
    const sortable = event.currentTarget as HTMLElement;
    const tab = Array.from(sortable.children).filter((child) => child.matches('.tab-slot'))[event.detail.index];
    this.sortPosition = tab ? { tab, next: tab.nextSibling } : undefined;
  };

  private sortTracks = (event: CustomEvent<{ newIndex: number }>) => {
    event.stopPropagation();
    if (this.sortPosition) this.sortPosition.newIndex = event.detail.newIndex;
  };

  private endSort = (event: Event) => {
    const position = this.sortPosition;
    this.sortPosition = undefined;
    const sortable = event.currentTarget as HTMLElement;
    if (!position || position.tab.parentNode !== sortable) return;
    const { tab, next, newIndex } = position;
    if (next && next.parentNode !== sortable) return;
    // Sortable can move a tab past Lit's markers even when its element index is unchanged.
    // Restore its original place so repeat can reconcile the new track order.
    if (tab.nextSibling !== next) sortable.insertBefore(tab, next);
    const ed = this.ed;
    if (!ed || newIndex === undefined) return;
    const oldIndex = Array.from(sortable.children).indexOf(tab);
    const movedId = ed.trackIds[oldIndex];
    if (movedId) ed.commands.moveTrack(movedId, newIndex);
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
      @pointerdown=${guardOptions} @start=${this.startSort} @sort=${this.sortTracks} @end=${this.endSort}>${tracks}</z-sortable>`;
    return html`<div class="tabs" role="tablist" aria-label="Tracks" @keydown=${this.moveTab}>
      ${sortable}
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
