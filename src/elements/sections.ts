import { html, nothing, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { SECTION_COLORS, type Editor, type Section } from '../core';
import type { Engine } from '../engine/engine';
import { handleWheel, maxScrollTick } from '../engine/interact';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';
import styles from './sections.css?raw';

type SectionGesture = {
  pointer: number;
  clientX: number;
  id: string;
  source: readonly Section[];
  edge: boolean;
  shift: boolean;
  toggle: boolean;
  dragging: boolean;
  lastX: number;
  delta: number;
  originTick: number;
  insertion: number;
  ids: ReadonlySet<string>;
};

@customElement('maddie-sections')
export class MaddieSections extends MaddieElement {
  static styles = [tokens, unsafeCSS(styles)];

  @state() private menuId?: string;
  @state() private splitBar?: number;
  @state() private preview?: readonly Section[];
  @state() private dropTick?: number;
  private menuX = 0;
  private menuY = 0;
  private scrollTick = 0;
  private pxPerTick = 0;
  private anchor?: string;
  private gesture?: SectionGesture;
  private menuTrigger?: HTMLElement;

  protected attach(editor: Editor, engine: Engine) {
    this.track(
      editor.on('change', ({ origin, patches }) => {
        if (this.gesture && (origin === 'load' || patches.some((patch) =>
          patch.op === 'meta' && (patch.key === 'timeSignature' || patch.key === 'sections')))) this.cancelGesture();
        if (origin === 'load' || !editor.sections.items.some(({ id }) => id === this.menuId)) this.closeMenu();
        this.requestUpdate();
      }),
      editor.on('sectionselection', () => this.requestUpdate()),
      engine.addRenderer((now) => {
        const view = engine.displayView(now);
        const moved = view.scrollTick !== this.scrollTick || view.pxPerTick !== this.pxPerTick;
        if (moved) {
          this.scrollTick = view.scrollTick;
          this.pxPerTick = view.pxPerTick;
          this.requestUpdate();
        }
        if (this.gesture?.dragging) {
          if (moved) this.previewGesture(this.gesture);
          this.scrollDuringDrag(this.gesture);
        }
      }),
    );
    const wheel = (event: WheelEvent) => {
      if (event.composedPath().includes(this.panel!)) return;
      handleWheel(editor, event, event.clientX - this.getBoundingClientRect().left, 0, { vertical: false });
    };
    this.addEventListener('wheel', wheel, { passive: false });
    this.track(() => this.removeEventListener('wheel', wheel));
  }

  protected detached() {
    this.cancelGesture();
    this.closeMenu();
    this.anchor = undefined;
  }

  private get panel() { return this.renderRoot.querySelector<HTMLElement>('.section-menu'); }
  private get sections() { return this.ed!.sections; }

  private x(tick: number) {
    return (tick - this.scrollTick) * (this.pxPerTick || this.ed!.view.pxPerTick);
  }

  private tick(clientX: number) {
    return this.scrollTick + (clientX - this.getBoundingClientRect().left) / (this.pxPerTick || this.ed!.view.pxPerTick);
  }

  private run<T>(action: () => T): T | undefined {
    try {
      return action();
    } catch (error) {
      this.engine?.toast((error as Error).message, 'error');
    }
  }

  private choose(id: string, shift: boolean, toggle: boolean) {
    const items = this.sections.items;
    const anchor = items.findIndex((item) => item.id === this.anchor);
    const end = items.findIndex((item) => item.id === id);
    if (shift && anchor >= 0) {
      this.sections.select(items.slice(Math.min(anchor, end), Math.max(anchor, end) + 1).map((item) => item.id));
      return;
    }
    this.anchor = id;
    if (toggle) {
      const ids = new Set(this.sections.selected);
      if (!ids.delete(id)) ids.add(id);
      this.sections.select(ids);
    } else this.sections.select([id]);
  }

  private movingBlock(id: string) {
    const { items, selected } = this.sections;
    const index = items.findIndex((item) => item.id === id);
    if (!selected.has(id)) return new Set([id]);
    let first = index;
    let end = index + 1;
    while (first > 0 && selected.has(items[first - 1].id)) first--;
    while (end < items.length && selected.has(items[end].id)) end++;
    return new Set(items.slice(first, end).map((item) => item.id));
  }

  private begin(event: PointerEvent, id: string, edge: boolean) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const header = (event.currentTarget as HTMLElement).closest('article');
    header?.querySelector<HTMLElement>('.section-name')?.focus({ preventScroll: true });
    const ids = edge ? new Set([id]) : this.movingBlock(id);
    this.gesture = {
      pointer: event.pointerId,
      clientX: event.clientX,
      id,
      source: this.sections.items,
      edge,
      shift: event.shiftKey,
      toggle: event.metaKey || event.ctrlKey,
      dragging: false,
      lastX: event.clientX,
      delta: 0,
      originTick: this.tick(event.clientX),
      insertion: this.sections.items.findIndex((item) => ids.has(item.id)),
      ids,
    };
    this.renderRoot.querySelector('.section-row')!.setPointerCapture(event.pointerId);
  }

  private onMove = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (gesture.source !== this.sections.items) return this.cancelGesture();
    gesture.lastX = event.clientX;
    if (!gesture.dragging && Math.abs(event.clientX - gesture.clientX) < 6) return;
    gesture.dragging = true;
    if (!gesture.edge && this.sections.timingUnavailable) return;
    this.previewGesture(gesture);
    this.scrollDuringDrag(gesture);
  };

  private scrollDuringDrag(gesture: SectionGesture) {
    const ed = this.ed!;
    if (!gesture.edge && this.sections.timingUnavailable) return;
    const bounds = this.getBoundingClientRect();
    const left = Math.max(0, bounds.left + 24 - gesture.lastX);
    const right = Math.max(0, gesture.lastX - bounds.right + 24);
    const pixels = Math.max(-20, Math.min(20, (right - left) * 0.3));
    if (pixels) ed.setView({ scrollTick: Math.min(ed.view.scrollTick + pixels / ed.view.pxPerTick, maxScrollTick(ed)) });
  }

  private previewGesture(gesture: SectionGesture) {
    const tick = this.tick(gesture.lastX);
    const ranges = this.sections.ranges();
    if (gesture.edge) {
      const range = ranges.find(({ section }) => section.id === gesture.id)!;
      gesture.delta = this.sections.barAt(range.end + tick - gesture.originTick, true) - range.endBar;
      this.preview = this.sections.resizePlan(gesture.id, gesture.delta);
      return;
    }
    const remaining = ranges.filter(({ section }) => !gesture.ids.has(section.id));
    gesture.insertion = remaining.filter(({ start, end }) => tick >= (start + end) / 2).length;
    const items = remaining.map(({ section }) => section);
    const block = ranges.filter(({ section }) => gesture.ids.has(section.id));
    items.splice(gesture.insertion, 0, ...block.map(({ section }) => section));
    this.preview = items;
    this.dropTick = this.sections.ranges(items)[gesture.insertion]?.start;
  }

  private onUp = (event: PointerEvent) => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    this.onMove(event);
    if (this.gesture !== gesture) return;
    this.cancelGesture();
    if (!gesture.dragging) {
      if (!gesture.edge) this.choose(gesture.id, gesture.shift, gesture.toggle);
      return;
    }
    this.run(() => gesture.edge
      ? this.sections.resize(gesture.id, gesture.delta)
      : this.sections.move(gesture.ids, gesture.insertion));
    if (!gesture.edge && !this.sections.selected.has(gesture.id)) this.choose(gesture.id, false, false);
  };

  private cancelGesture = () => {
    const pointer = this.gesture?.pointer;
    this.gesture = undefined;
    this.preview = undefined;
    this.dropTick = undefined;
    const row = this.renderRoot.querySelector('.section-row');
    if (pointer !== undefined && row?.hasPointerCapture(pointer)) row.releasePointerCapture(pointer);
  };

  private show(id: string, trigger: HTMLElement, event?: MouseEvent) {
    if (this.menuId === id && this.panel?.matches(':popover-open') && !event) {
      this.closeMenu();
      return;
    }
    const box = trigger.getBoundingClientRect();
    this.menuTrigger = trigger;
    this.menuX = event?.clientX ?? box.left;
    this.menuY = event?.clientY ?? box.bottom + 4;
    this.splitBar = event ? this.sections.barAt(this.tick(event.clientX), true) : undefined;
    this.menuId = id;
    void this.updateComplete.then(() => {
      const panel = this.panel;
      if (!panel || !this.isConnected || this.menuId !== id) return;
      if (!panel.matches(':popover-open')) panel.showPopover();
      const { width, height } = panel.getBoundingClientRect();
      panel.style.left = Math.max(4, Math.min(window.innerWidth - width - 4, this.menuX)) + 'px';
      panel.style.top = Math.max(4, Math.min(window.innerHeight - height - 4, this.menuY)) + 'px';
      const input = panel.querySelector('input')!;
      input.value = this.sections.items.find((section) => section.id === id)!.name;
      input.focus({ preventScroll: true });
      input.select();
    });
  }

  private closeMenu(restoreFocus = false) {
    if (this.panel?.matches(':popover-open')) this.panel.hidePopover();
    if (restoreFocus) this.menuTrigger?.focus({ preventScroll: true });
    this.menuId = undefined;
    this.menuTrigger = undefined;
  }

  private navigate(event: KeyboardEvent, id: string) {
    const items = this.sections.items;
    const index = items.findIndex((item) => item.id === id);
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') {
      if (this.gesture) this.cancelGesture();
      else this.sections.select([]);
    } else if (event.key === 'F2') {
      const trigger = (event.currentTarget as HTMLElement).closest('article')!.querySelector<HTMLElement>('.section-dot')!;
      this.show(id, trigger);
    } else if (event.code === 'Space' && this.sections.selected.size && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (!event.repeat) void this.ed!.transport.toggle();
    } else if (direction && !event.ctrlKey && !event.metaKey) {
      if (event.altKey && !event.shiftKey) {
        const ids = this.movingBlock(id);
        const start = items.findIndex((item) => ids.has(item.id));
        const to = Math.min(items.length - ids.size, Math.max(0, start + direction));
        if (to !== start) {
          this.run(() => this.sections.move(ids, to));
          this.revealHeader(id, true);
        }
      } else if (event.shiftKey && !event.altKey) {
        this.run(() => this.sections.resize(id, direction));
      } else if (!event.shiftKey && !event.altKey) {
        const next = items[index + direction];
        if (next) {
          this.choose(next.id, false, false);
          this.revealHeader(next.id, true);
        }
      } else return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  private revealHeader(id: string, moveFocus: boolean) {
    const range = this.sections.ranges().find(({ section }) => section.id === id);
    if (!range || !this.ed) return;
    if (this.x(range.start) < 0 || this.x(range.start) >= this.clientWidth - 24) {
      this.ed.setView({ scrollTick: range.start });
    }
    if (!moveFocus) return;
    void this.updateComplete.then(() => {
      const header = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('.section-name')]
        .find((button) => button.dataset.id === id);
      header?.focus({ preventScroll: true });
    });
  }

  private activate(event: MouseEvent, action: () => string | void | undefined) {
    const id = this.run(action);
    this.closeMenu(!id);
    if (id) {
      this.choose(id, false, false);
      this.revealHeader(id, event.detail === 0);
    }
  }

  private renderMenu() {
    const range = this.sections.ranges().find(({ section }) => section.id === this.menuId);
    const section = range?.section;
    const id = section?.id ?? '';
    const ids = this.sections.selected.has(id) ? this.sections.selected : new Set([id]);
    const unavailable = this.sections.timingUnavailable;
    const split = this.splitBar ?? (range && range.startBar + Math.floor(section!.durationBars / 2));
    const canSplit = !!range && split !== undefined && split > range.startBar && split < range.endBar;
    return html`<div class="section-menu" popover role="dialog" aria-label="Section options"
      @beforetoggle=${(event: ToggleEvent) => {
        if (event.newState !== 'closed' || !section) return;
        const input = this.panel?.querySelector('input');
        if (input && input.value.trim() !== section.name) this.run(() => this.sections.rename(id, input.value));
      }}
      @toggle=${(event: Event) => {
        if (!(event.currentTarget as HTMLElement).matches(':popover-open')) {
          this.menuId = undefined;
          this.menuTrigger = undefined;
        }
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        const input = this.panel?.querySelector('input');
        if (input && section) input.value = section.name;
        this.closeMenu(true);
      }}>
      ${section ? html`
        <input aria-label="Section name" .value=${section.name}
          @blur=${(event: FocusEvent) => {
            const input = event.currentTarget as HTMLInputElement;
            if (!input.value.trim()) input.value = section.name;
            this.run(() => this.sections.rename(id, input.value));
          }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              const input = event.currentTarget as HTMLInputElement;
              this.run(() => this.sections.rename(id, input.value));
              this.closeMenu(true);
            }
          }}>
        <div class="swatches" role="group" aria-label="Section color">
          ${SECTION_COLORS.map(({ name, color }) => html`<button type="button" class="swatch"
            aria-label=${name} title=${name} aria-pressed=${section.color === color} style=${styleMap({ '--swatch': color })}
            @click=${() => this.run(() => this.sections.color(ids, color))}></button>`)}
        </div>
        <button type="button" @click=${(event: MouseEvent) => this.activate(event, () => this.sections.selectContent(ids, false))}>Select in current track</button>
        <button type="button" @click=${(event: MouseEvent) => this.activate(event, () => this.sections.selectContent(ids, true))}>Select in all tracks</button>
        <button type="button" ?disabled=${!canSplit}
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.split(id, split!))}>${this.splitBar && canSplit ? `Split at bar ${split}` : 'Split section in half'}</button>
        ${unavailable ? html`<p>${unavailable}</p>` : nothing}
        <button type="button" ?disabled=${!!unavailable}
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.insert(id, true, true))}>Duplicate section with music</button>
        <button type="button" ?disabled=${!!unavailable}
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.insert(id, false))}>Insert empty section before</button>
        <button type="button" ?disabled=${!!unavailable}
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.insert(id, true))}>Insert empty section after</button>
        <hr>
        <button type="button" @click=${(event: MouseEvent) => this.activate(event, () => this.sections.remove(ids, false))}>Remove section label</button>
        <button type="button" class="danger" ?disabled=${!!unavailable}
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.remove(ids, true))}>Delete section and music</button>
      ` : nothing}
    </div>`;
  }

  protected render() {
    if (!this.ed) return nothing;
    const ranges = this.sections.ranges(this.preview);
    const drag = this.gesture?.dragging && !this.gesture.edge && !this.sections.timingUnavailable ? this.gesture : undefined;
    const source = drag ? this.sections.ranges(drag.source) : [];
    const dragOffset = drag ? this.tick(drag.lastX) - drag.originTick : 0;
    return html`
      <div class="section-row" role="group" aria-label="Song sections"
        @pointermove=${this.onMove} @pointerup=${this.onUp}
        @pointercancel=${this.cancelGesture} @lostpointercapture=${this.cancelGesture}>
        ${repeat(ranges, ({ section }) => section.id, ({ section, start, end, startBar, endBar }) => {
          const { id, name, color } = section;
          const label = startBar + (endBar - startBar > 1 ? '–' + (endBar - 1) : '');
          const selected = this.sections.selected.has(id);
          const moving = drag?.ids.has(id) && source.find((range) => range.section.id === id);
          const left = this.x(moving ? moving.start + dragOffset : start);
          const right = this.x(moving ? moving.end + dragOffset : end);
          const x = !moving && left < 0 && right > 0 ? 0 : left;
          return html`<article style=${styleMap({ '--color': color, left: x + 'px', width: right - x + 'px' })}
            ?data-selected=${selected} ?data-dragging=${!!moving}
            @contextmenu=${(event: MouseEvent) => {
              event.preventDefault();
              this.show(id, (event.currentTarget as HTMLElement).querySelector('.section-dot')!, event);
            }}>
            <button type="button" class="section-dot" aria-label=${`Options for ${name}`} aria-haspopup="dialog"
              aria-expanded=${this.menuId === id} @click=${(event: MouseEvent) => this.show(id, event.currentTarget as HTMLElement)}>
              <span class="dot"></span><span class="ellipsis" aria-hidden="true">•••</span>
            </button>
            <button type="button" class="section-name" data-id=${id}
              title=${this.sections.timingUnavailable || 'Drag to move section and music'} aria-label=${`${name}, bars ${label}`}
              aria-pressed=${selected} @pointerdown=${(event: PointerEvent) => this.begin(event, id, false)}
              @keydown=${(event: KeyboardEvent) => this.navigate(event, id)}
              @click=${(event: MouseEvent) => { if (!event.detail) this.choose(id, event.shiftKey, event.metaKey || event.ctrlKey); }}>
              <span class="name">${name}</span><span class="range">${label}</span>
            </button>
            <span class="edge" title="Move boundary" @pointerdown=${(event: PointerEvent) => this.begin(event, id, true)}></span>
          </article>`;
        })}
        <button type="button" class="append" style=${styleMap({ left: this.x(ranges.at(-1)?.end ?? 0) + 'px' })}
          title="Add section label" aria-label="Add section label"
          @click=${(event: MouseEvent) => this.activate(event, () => this.sections.append())}>${icons.plus}</button>
        ${this.dropTick === undefined ? nothing
          : html`<span class="drop" style=${styleMap({ left: this.x(this.dropTick) + 'px' })}></span>`}
      </div>
      ${this.renderMenu()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-sections': MaddieSections;
  }
}
