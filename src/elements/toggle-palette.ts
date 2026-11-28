import { css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import type { Editor } from '../core';
import { actions } from '../engine/keymap';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';

type ToggleCommand = {
  label: string;
  key: string;
  isOn: (editor: Editor) => boolean;
  toggle: (editor: Editor) => void;
  onMessage?: string;
  offMessage?: string;
};

const TOGGLES: readonly ToggleCommand[] = [
  { label: 'Loop', key: 'l', isOn: (ed) => ed.transport.loop.enabled, toggle: actions.toggleLoop },
  { label: 'Follow playhead', key: 'f', isOn: (ed) => ed.view.follow, toggle: actions.toggleFollow,
    onMessage: 'Follow on', offMessage: 'Follow off' },
  { label: 'Metronome', key: 'm', isOn: (ed) => ed.transport.metronome.enabled, toggle: actions.toggleMetronome },
];

const PANELS: readonly ToggleCommand[] = [
  { label: 'Suggestions', key: 's', isOn: (ed) => ed.view.suggestionsOpen, toggle: actions.toggleSuggestions,
    onMessage: 'Suggestions open', offMessage: 'Suggestions folded' },
  { label: 'Chords', key: 'c', isOn: (ed) => ed.view.chordsPanel, toggle: actions.toggleChords,
    onMessage: 'Chords open', offMessage: 'Chords folded' },
  { label: 'Velocity lane', key: 'v', isOn: (ed) => ed.view.velocityLaneOpen, toggle: actions.toggleVelocityLane,
    onMessage: 'Velocity lane open', offMessage: 'Velocity lane folded' },
];

type PaletteKind = 'toggle' | 'panels';

@customElement('maddie-toggle-palette')
export class MaddieTogglePalette extends MaddieElement {
  static styles = [tokens, css`
    :host { display: contents; }
    dialog {
      box-sizing: border-box;
      width: min(27rem, calc(100vw - 2rem));
      max-height: calc(100dvh - 2rem);
      margin: min(14dvh, 7rem) auto auto;
      padding: var(--space-2);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-lg);
      background: var(--surface-overlay);
      color: var(--text-primary);
      box-shadow: var(--shadow-overlay);
      font: 500 var(--font-size-sm) var(--font-sans);
    }
    dialog::backdrop { background: rgb(0 0 0 / 22%); }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-1) var(--space-2) var(--space-2);
      border-bottom: 1px solid var(--border-default);
    }
    h2 { margin: 0; font-size: var(--font-size-md); font-weight: 600; }
    button { font: inherit; color: inherit; border: 0; background: transparent; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; }
    .dismiss { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--radius-sm); color: var(--text-secondary); }
    .dismiss svg { width: 14px; height: 14px; }
    .commands { display: grid; gap: var(--space-1); padding-block-start: var(--space-2); }
    .command {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 1.5rem;
      align-items: center;
      gap: var(--space-3);
      min-height: 38px;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-md);
      text-align: start;
    }
    button:hover:not(:disabled), .command:focus-visible { background: var(--surface-subtle); }
    .state { color: var(--text-secondary); font-size: var(--font-size-xs); }
    .command[aria-pressed='true'] .state { color: var(--accent-secondary); }
    kbd {
      display: inline-grid;
      place-items: center;
      box-sizing: border-box;
      min-width: 1.5rem;
      height: 1.5rem;
      padding-inline: var(--space-1);
      border: 1px solid var(--border-default);
      border-radius: var(--radius-sm);
      background: var(--surface-default);
      font: 500 var(--font-size-xs) var(--font-mono);
    }
  `];

  private pendingKey?: string;
  @state() private kind: PaletteKind = 'toggle';

  private get dialog() { return this.renderRoot.querySelector('dialog'); }
  private get opener() { return this.kind === 'panels' ? '/' : 't'; }
  private get commands() { return this.kind === 'panels' ? PANELS : TOGGLES; }

  protected attach(ed: Editor) {
    this.track(ed.on('view', ({ view }) => {
      if (!this.dialog?.open) return;
      if (view.computerKeyboard && this.kind === 'toggle') this.close();
      else this.requestUpdate();
    }), ed.on('transport', () => {
      if (this.dialog?.open) this.requestUpdate();
    }), ed.on('change', () => {
      if (this.dialog?.open) this.requestUpdate();
    }));
    window.addEventListener('blur', this.resetKeys);
    this.track(() => window.removeEventListener('blur', this.resetKeys));
  }

  async open(kind: PaletteKind) {
    const dialog = this.dialog;
    if (!dialog || dialog.open || !this.ed || (kind === 'toggle' && this.ed.view.computerKeyboard)) return;
    this.kind = kind;
    this.resetKeys();
    this.requestUpdate();
    await this.updateComplete;
    if (dialog.isConnected && !dialog.open && this.kind === kind) dialog.showModal();
  }

  private resetKeys = () => {
    this.pendingKey = undefined;
  };

  private close = () => {
    this.resetKeys();
    this.dialog?.close();
  };

  private apply(command: ToggleCommand) {
    const ed = this.ed;
    if (!ed) return;
    command.toggle(ed);
    this.close();
    const message = command.isOn(ed) ? command.onMessage ?? `${command.label} on` : command.offMessage ?? `${command.label} off`;
    this.engine?.toast(message);
  }

  private onKeyDown = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(this.renderRoot.querySelectorAll<HTMLButtonElement>('.command'));
      const index = rows.indexOf(event.target as HTMLButtonElement);
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next]?.focus();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || (event.key !== '/' && !/^[a-z]$/i.test(event.key))) return;
    event.preventDefault();
    if (!event.repeat) this.pendingKey ??= event.key.toLowerCase();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    event.stopPropagation();
    const key = event.key.toLowerCase();
    if (key !== this.pendingKey) return;
    this.pendingKey = undefined;
    if (key === this.opener) this.close();
    const command = this.commands.find((item) => item.key === key);
    if (command) this.apply(command);
  };

  protected render() {
    const ed = this.ed;
    const title = this.kind === 'panels' ? 'Panels' : 'Toggle';
    return html`<dialog aria-labelledby="toggle-title" @keydown=${this.onKeyDown} @keyup=${this.onKeyUp}
      @mousedown=${(event: Event) => event.stopPropagation()}
      @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.close(); }}>
      <header><h2 id="toggle-title">${title}</h2>
        <button class="dismiss" type="button" aria-label=${`Close ${title} palette`} @click=${this.close}>${icons.close}</button>
      </header>
      <div class="commands">
        ${this.commands.map((command, index) => {
          const on = ed ? command.isOn(ed) : false;
          return html`<button class="command" type="button" ?autofocus=${index === 0}
            aria-pressed=${on} @click=${() => this.apply(command)}>
            <span>${command.label}</span><span class="state">${on ? 'On' : 'Off'}</span>
            <kbd aria-hidden="true">${command.key.toUpperCase()}</kbd>
          </button>`;
        })}
      </div>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-toggle-palette': MaddieTogglePalette;
  }
}
