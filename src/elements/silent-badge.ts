import { css, html, nothing } from 'lit';
import { customElement } from 'lit/decorators.js';
import { getTrackName, getTrackSilence, type Editor, type TrackSilenceT } from '../core';
import type { Engine } from '../engine/engine';
import { MaddieElement } from './base';
import { icons } from './icons';
import { tokens } from './tokens';
import './zest';

const describeSilence = (silence: TrackSilenceT, trackName: string): string => {
  if (silence.kind === 'muted') return `${trackName} is muted`;
  const isOneSoloed = silence.soloedNames.length === 1;
  if (isOneSoloed) return `Silent · ${silence.soloedNames[0]} is soloed`;
  return `Silent · ${silence.soloedNames.length} other tracks are soloed`;
};

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
    const trackIndex = ed.trackList.findIndex((item) => item.id === ed.activeTrackId);
    const trackName = getTrackName(ed.trackList[trackIndex], trackIndex);
    const message = describeSilence(silence, trackName);
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
