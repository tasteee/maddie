import { unsafeCSS, html } from 'lit';
import { icons } from './icons';
import { ref } from 'lit/directives/ref.js';
import { customElement } from 'lit/decorators.js';
import { MaddieRoot } from './root';
import { styleEditorToast } from './zest';
import { themeRegion } from './tokens';
import './toggle-palette';
import './sections';
import editorCss from './editor.css?raw';

/**
 * The full editor: two toolbar rows, track list, ruler, keyboard, piano roll, velocity lane, chords panel, selection bar.
 * Every region is a slot, so you can replace any piece.
 */
@customElement('maddie-editor')
export class MaddieEditor extends MaddieRoot {
  static styles = [
    ...MaddieRoot.styles,
    ...themeRegion,
    unsafeCSS(editorCss),
  ];

  private stopViewUpdates?: () => void;

  connectedCallback() {
    super.connectedCallback();
    this.stopViewUpdates = this.editor.on('view', () => this.requestUpdate());
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopViewUpdates?.();
  }

  /** Fold the velocity lane to its label strip, or open it again. */
  private toggleLane = () => {
    const isOpen = this.editor.view.velocityLaneOpen;
    this.editor.setView({ velocityLaneOpen: !isOpen });
  };

  protected shortcutKeymap() {
    return {
      t: () => this.openPalette('toggle'),
      '/': () => this.openPalette('panels'),
      g: () => this.openEditMenu('grid'),
      f: () => this.openEditMenu('fold'),
      ...this.keymap,
    };
  }

  private openPalette(kind: 'toggle' | 'panels') {
    this.renderRoot.querySelector('maddie-toggle-palette')?.open(kind);
  }

  private openEditMenu(kind: 'grid' | 'fold') {
    let focus = document.activeElement;
    while (focus?.shadowRoot?.activeElement) focus = focus.shadowRoot.activeElement;
    const returnFocus = focus instanceof HTMLElement && focus !== document.body ? focus : this;
    if (kind === 'fold') {
      this.renderRoot.querySelector('maddie-fold-select')?.openMenu(returnFocus);
      return;
    }
    const toolbar = this.renderRoot.querySelector('maddie-toolbar');
    toolbar?.shadowRoot?.querySelector('maddie-editbar')?.openMenu(kind, returnFocus);
  }

  protected render() {
    const isLaneOpen = this.editor.view.velocityLaneOpen;
    const laneToggleLabel = isLaneOpen ? 'Hide velocity lane' : 'Show velocity lane';
    this.toggleAttribute('lane-collapsed', !isLaneOpen);
    return html`
      <div class="frame" part="frame">
        <slot name="toolbar"
          ><maddie-toolbar part="toolbar" hide-fold
            ><slot name="toolbar-start" slot="start"></slot><slot name="toolbar-end" slot="end"></slot>
              <slot name="tracks" slot="tracks"><maddie-tracks part="tracks"></maddie-tracks></slot>
            </maddie-toolbar
        ></slot>
        <div class="grid" part="body">
          <div class="corner" part="corner">
            <maddie-fold-select compact part="fold-select"></maddie-fold-select>
            <slot name="corner"></slot>
          </div>
          <maddie-sections part="sections"></maddie-sections>
          <maddie-ruler part="ruler"></maddie-ruler>
          <maddie-keyboard part="keyboard"></maddie-keyboard>
          <maddie-piano-roll part="piano-roll"></maddie-piano-roll>
          <maddie-zoom part="zoom-pad"></maddie-zoom>
          <maddie-chord-bar part="chord-bar"></maddie-chord-bar>
          <maddie-silent-badge part="silent-badge"></maddie-silent-badge>
          <z-toaster ${ref(styleEditorToast)} position="bottom-center" part="toast"></z-toaster>
          <div class="lane-head" part="lane-head">
            <button type="button" class="lane-fold" aria-expanded=${isLaneOpen} aria-label=${laneToggleLabel} title=${laneToggleLabel + '   / + V'}
              @click=${this.toggleLane}>${icons.chevron}</button>
            <slot name="lane-label">Velocity</slot>
            <maddie-velocity-controls part="velocity-controls"></maddie-velocity-controls>
          </div>
          <div class="label" part="lane-corner"></div>
          <maddie-velocity-lane part="velocity-lane"></maddie-velocity-lane>
          <maddie-chords part="chords"></maddie-chords>
        </div>
        <slot name="inspector"><maddie-inspector part="inspector"></maddie-inspector></slot>
        <slot name="footer"></slot>
      </div>
      <maddie-toggle-palette></maddie-toggle-palette>
      <slot></slot>
    `;
  }

  /** The piano roll inside the preset. */
  get pianoRoll() {
    return this.renderRoot.querySelector('maddie-piano-roll');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-editor': MaddieEditor;
  }
}
