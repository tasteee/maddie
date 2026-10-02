import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { MaddieRoot } from './root';

/**
 * The full editor: two toolbar rows, ruler, keyboard, piano roll, velocity lane, chords panel, selection bar.
 * Every region is a slot, so you can replace any piece.
 */
@customElement('maddie-editor')
export class MaddieEditor extends MaddieRoot {
  static styles = [
    ...MaddieRoot.styles,
    css`
      :host {
        display: block;
        height: 520px;
        min-height: 320px;
        container-type: inline-size;
      }
      .frame {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
        background: var(--_bg);
        border: 1px solid var(--_border);
        border-radius: var(--_radius);
        box-sizing: border-box;
      }
      .grid {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: var(--_keyboard-width) minmax(0, 1fr) auto;
        grid-template-rows: var(--_ruler-height) minmax(0, 1fr) var(--_lane-height);
        grid-template-areas:
          'corner ruler chords'
          'keys roll chords'
          'label lane chords';
      }
      .corner {
        grid-area: corner;
        background: var(--_surface);
        border-right: 1px solid var(--_border);
        border-bottom: 1px solid var(--_border);
      }
      maddie-ruler {
        grid-area: ruler;
      }
      maddie-keyboard {
        grid-area: keys;
        width: auto;
      }
      maddie-piano-roll {
        grid-area: roll;
        min-height: 0;
      }
      .label {
        grid-area: label;
        display: flex;
        align-items: flex-start;
        padding: 10px 10px 0;
        background: var(--_surface);
        border-top: 1px solid var(--_border);
        border-right: 1px solid var(--_border);
        color: var(--_text-faint);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: -0.005em;
      }
      maddie-velocity-lane {
        grid-area: lane;
      }
      maddie-chords {
        grid-area: chords;
      }
    `,
  ];

  protected render() {
    return html`
      <div class="frame" part="frame">
        <slot name="toolbar"
          ><maddie-toolbar part="toolbar"
            ><slot name="toolbar-start" slot="start"></slot><slot name="toolbar-end" slot="end"></slot></maddie-toolbar
        ></slot>
        <div class="grid" part="body">
          <div class="corner" part="corner"><slot name="corner"></slot></div>
          <maddie-ruler part="ruler"></maddie-ruler>
          <maddie-keyboard part="keyboard"></maddie-keyboard>
          <maddie-piano-roll part="piano-roll"></maddie-piano-roll>
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
