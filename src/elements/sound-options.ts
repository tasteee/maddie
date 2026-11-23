import { MIDI_SOURCE, type OutputRouter } from '../engine/output-router';
import type { ZestOptionT } from './zest';

export const SOUND_GROUPS = [
  { label: 'Keys', ids: ['piano', 'ep-pianet', 'ep-wurlitzer', 'gm-organ', 'gm-harpsichord'] },
  { label: 'Bass', ids: ['gm-bass'] },
  { label: 'Leads', ids: ['gm-violin', 'gm-flute', 'gm-trumpet', 'gm-sax'] },
  { label: 'Pads', ids: ['gm-cello', 'gm-strings'] },
  { label: 'Mallets & plucks', ids: ['gm-marimba', 'gm-harp', 'gm-nylon-guitar', 'gm-steel-guitar', 'gm-clean-guitar'] },
];

export const getSoundOptions = (router: OutputRouter): ZestOptionT[] => {
  const known = new Set(SOUND_GROUPS.flatMap((group) => group.ids));
  const sounds = router.sounds.map((sound) => ({ value: sound.id, label: sound.label }));
  const groups = SOUND_GROUPS.map((group) => ({
    label: group.label,
    value: group.label,
    isGroup: true,
    children: sounds.filter((sound) => group.ids.includes(sound.value)),
  })).filter((group) => group.children.length);
  const additional = sounds.filter((sound) => !known.has(sound.value));

  return [{ value: MIDI_SOURCE, label: 'MIDI output', isDisabled: !router.supported }, ...groups, ...additional];
};
