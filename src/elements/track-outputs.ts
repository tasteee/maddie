import { html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import { getTrackName, type Editor, type TrackMetaT, type TrackRouteT } from '../core';
import { MIDI_SOURCE, type OutputRouter, type RouteStatusT } from '../engine/output-router';
import { getSoundOptions } from './sound-options';
import type { ZestOptionT } from './zest';

const FOLLOW_DEFAULT = 'default';

type MidiRouteT = Extract<TrackRouteT, { kind: 'midi' }>;

const MIDI_CHANNEL_OPTIONS: ZestOptionT[] = Array.from({ length: 16 }, (_, channel) => ({
  value: String(channel),
  label: `Channel ${channel + 1}`,
}));

const ROUTE_STATUS_HINTS: Record<RouteStatusT, string> = {
  ready: '',
  missing: 'Not available. This track is silent.',
  'needs-access': 'Connect MIDI to hear this track.',
  unsupported: "This browser can't send MIDI.",
  denied: 'MIDI access was blocked.',
};

const getRouteValue = (route: TrackRouteT | undefined): string => {
  if (!route) return FOLLOW_DEFAULT;
  if (route.kind === 'midi') return MIDI_SOURCE;
  return route.soundId;
};

const getTrackRouteOptions = (router: OutputRouter): ZestOptionT[] => {
  const globalOption = { value: FOLLOW_DEFAULT, label: 'Global' };
  return [globalOption, ...getSoundOptions(router)];
};

const renderSelect = (label: string, value: string, options: ZestOptionT[], onPick: (value: string) => void, placeholder?: string) =>
  html`<z-select
    size="sm"
    aria-label=${label}
    placeholder=${placeholder ?? nothing}
    .options=${options}
    .value=${live(value)}
    @change=${(event: CustomEvent<{ value: string }>) => onPick(event.detail.value)}
  ></z-select>`;

const renderMidiControls = (ed: Editor, router: OutputRouter, track: TrackMetaT, route: MidiRouteT, name: string) => {
  const portOptions = router.ports.map((port) => ({ value: port.id, label: port.name }));
  const selectedPortId = route.portId ?? router.ports[0]?.id ?? '';
  const selectedChannel = String(route.channel ?? 0);
  const isConnected = router.status === 'ready';

  const pickPort = (portId: string) => ed.commands.setTrackRoute(track.id, { ...route, portId });
  const pickChannel = (channel: string) => ed.commands.setTrackRoute(track.id, { ...route, channel: Number(channel) });
  const connect = () => void router.request();

  if (!isConnected) {
    const isBusy = router.status === 'pending';
    const isUnavailable = !router.supported || isBusy;
    return html`<z-button size="sm" ?is-disabled=${isUnavailable} @click=${connect}>Connect MIDI output</z-button>`;
  }

  const portSelect = renderSelect(`${name} MIDI port`, selectedPortId, portOptions, pickPort, 'No MIDI outputs found');
  const channelSelect = renderSelect(`${name} MIDI channel`, selectedChannel, MIDI_CHANNEL_OPTIONS, pickChannel);
  return html`<div class="track-output-midi">${portSelect}${channelSelect}</div>`;
};

// Keys belong to the select and the menu inside it, not to the context menu's own arrow navigation.
const keepKeysInside = (event: KeyboardEvent) => {
  const isMenuKey = event.key === 'Escape' || event.key === 'Tab' || event.ctrlKey || event.metaKey;
  if (!isMenuKey) event.stopPropagation();
};

/**
 * Where one track sounds, for its options menu. "Global" follows the project's sound.
 * Otherwise the track uses another sound, or sends its notes to a MIDI port and channel.
 * Renders nothing until the host has provided sounds.
 */
export const renderTrackOutput = (ed: Editor, router: OutputRouter, track: TrackMetaT, index: number) => {
  const hasSounds = router.sounds.length > 0;
  if (!hasSounds) return nothing;

  const name = getTrackName(track, index);
  const route = track.route;
  const options = getTrackRouteOptions(router);

  const choose = (value: string) => {
    if (value === FOLLOW_DEFAULT) return ed.commands.setTrackRoute(track.id, undefined);
    if (value === MIDI_SOURCE) return void router.routeTrackToMidi(track.id);
    return ed.commands.setTrackRoute(track.id, { kind: 'sound', soundId: value });
  };

  const select = renderSelect(`${name} output`, getRouteValue(route), options, choose);
  const midiControls = route?.kind === 'midi' ? renderMidiControls(ed, router, track, route, name) : nothing;
  const status = route ? router.getRouteStatus(route) : 'ready';
  const hintText = ROUTE_STATUS_HINTS[status];
  const hint = hintText ? html`<span class="track-control-hint">${hintText}</span>` : nothing;

  return html`<div class="track-output" @keydown=${keepKeysInside}>
    <span class="track-control-label">Output</span>
    ${select}${midiControls}${hint}
  </div>`;
};
