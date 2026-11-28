import { css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { getTrackSilence, type Editor } from '../core';
import type { Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

/**
 * While playing, a bold badge at the top of the grid when the track you're on is silent:
 * muted itself, or left out because another track is soloed.
 */
@customElement('maddie-silent-badge')
export class MaddieSilentBadge extends MaddieElement {
  static styles = [
    tokens,
    css`
      :host {
        display: flex;
        justify-content: center;
        pointer-events: none;
      }
      .icon {
        display: inline-flex;
      }
      .icon svg {
        width: 12px;
        height: 12px;
      }
    `,
  ];

  protected attach(editor: Editor, _engine: Engine) {
    const update = () => this.requestUpdate();
    this.track(editor.on('transport', update), editor.on('tracks', update));
  }

  render() {
    const ed = this.ed;
    if (!ed) return nothing;
    const isPlaying = ed.transport.playing;
    const silence = getTrackSilence(ed.trackList, ed.activeTrackId);
    const shouldShow = isPlaying && silence !== null;
    this.toggleAttribute('is-showing', shouldShow);
    if (!shouldShow) return html`<span role="status"></span>`;
    const message = silence.kind === 'muted' ? 'This track is muted' : 'Another track is soloed';
    // Muted is the track's own state: danger. Left out by a solo: warning.
    const tone = silence.kind === 'muted' ? 'danger' : 'warning';
    return html`<span role="status"><z-badge kind="solid" tone=${tone}><span slot="prefix" class="icon">${icons.mute}</span>${message}</z-badge></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'maddie-silent-badge': MaddieSilentBadge;
  }
}
