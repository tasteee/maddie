import { unsafeCSS, html } from 'lit';
import { ref } from 'lit/directives/ref.js';
import { customElement } from 'lit/decorators.js';
import { MaddieRoot } from './root';
import { styleEditorToast } from './zest';
import { themeRegion } from './tokens';
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

  protected render() {
    return html`
      <div class="frame" part="frame">
        <slot name="toolbar"
          ><maddie-toolbar part="toolbar"
            ><slot name="toolbar-start" slot="start"></slot><slot name="toolbar-end" slot="end"></slot>
              <slot name="tracks" slot="tracks"><maddie-tracks part="tracks"></maddie-tracks></slot>
            </maddie-toolbar
        ></slot>
        <div class="grid" part="body">
          <div class="corner" part="corner"><slot name="corner"></slot></div>
          <maddie-ruler part="ruler"></maddie-ruler>
          <maddie-keyboard part="keyboard"></maddie-keyboard>
          <maddie-piano-roll part="piano-roll"></maddie-piano-roll>
          <maddie-zoom part="zoom-pad"></maddie-zoom>
          <maddie-chord-bar part="chord-bar"></maddie-chord-bar>
          <maddie-silent-badge part="silent-badge"></maddie-silent-badge>
          <z-toaster ${ref(styleEditorToast)} position="bottom-center" part="toast"></z-toaster>
          <div class="label" part="lane-label"><slot name="lane-label">Velocity</slot></div>
          <maddie-velocity-lane part="velocity-lane"></maddie-velocity-lane>
          <maddie-chords part="chords"></maddie-chords>
        </div>
        <slot name="inspector"><maddie-inspector part="inspector"></maddie-inspector></slot>
        <slot name="footer"></slot>
      </div>
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
