# Maddie

A browser-based MIDI editor, built on [Zest](https://github.com/tasteee/zest). This repo is an app, not a library.

Live demo: https://tasteee.github.io/maddie/ · Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Run it

```sh
pnpm install   # installs Zest from GitHub and builds it
pnpm dev       # app at localhost:5173
pnpm build     # static site in dist/
pnpm typecheck
pnpm test
```

## Look and feel

Every control is a Zest `<z-*>` element. Colors, type, radii and motion are Zest tokens, so the editor follows Zest's themes (`data-theme`).

The editor is dense, so Zest's size dials are turned down once, in `src/app/style.css`: `--base-font-size`, `--base-radius`, `--control-height-sm|md|lg`. Change them there to scale the whole UI.

`src/core` is the headless editor, `src/elements` the Maddie custom elements, `src/app` the page that wires in sound (smplr).

## Controls

Two toolbar rows. The **top row** is global: play/stop, record, back to start, position, tempo, metronome, volume, loop, follow, keyboard input, MIDI input, import/export. The **edit row** changes the grid: grid/snap, key/scale lock, fold (one button: click to cycle Off · Scale · Notes), undo/redo, row height, zoom.

- **Space** plays from the **marker** and stops back to it. Set the marker by clicking the ruler or empty grid. While playing, click empty grid to jump there. **Enter** goes back to the start. While playing, the rewind button jumps back to the marker; double-click it for the start.
- **← / →** move to the previous / next grid line: the play marker when nothing is selected, else the selected notes (the first one lands on the line, the rest keep their spacing). **⇧← / ⇧→** move note ends to grid lines. Everything snaps to lines of the current grid, never a grid step away from an off-grid spot.
- **Loop:** drag anywhere on the ruler to draw a loop; drag its ends to resize; click the loop bar to toggle it.
- **Metronome** (**C**) and **volume** (**⇧M** mutes): open **Output** for the sound, volume, mute and metronome. The metronome uses `output.click(e)` if present, else a short built-in click. Volume uses `output.setVolume(v)` if present, else scales velocity.
- **Follow playhead:** **F** (off by default).
- **Fold:** `Off · Scale · Notes`, one click each.
- **Reading the keys:** key shape = black or white (a short stub when folded). Row shade = scale: in-scale rows are light, out-of-scale rows are darker, the root row is tinted. A dot marks every in-scale key; a ringed dot and colored label mark the root. Out-of-scale labels are faint. With no key set, rows shade black keys instead.
- **Keyboard input:** **`** toggles. The Z row plays from C2; each key to the right is a semitone up and each row above continues from the one below. **+ / −** shift octaves (Z wraps C6 → C0). Letter shortcuts are paused while it's on.
- **MIDI input:** the MIDI button asks the browser for access (Web MIDI) and plays notes from a controller. Open **Input** to pick a device, or listen to all. Keyboard and MIDI input are separate modes: turning one on turns the other off.
- **Record** (the red button, or **R** while keyboard input is off): plays from the marker and records what you play (computer keyboard or MIDI) onto the grid until you stop. Notes grow under a red playhead while held. Each take is one undo step and ends selected. Loops overdub. Space or the stop button also ends the take. From code: `editor.recorder.start()` / `.stop()`; anything sent to `editor.liveNoteOn/Off` is recorded.
- **Capture** (the viewfinder button next to record, or **⇧R** while keyboard input is off): MIDI input is always listening. Play something while not recording, then press capture to keep it: the last ~10 minutes of what you played land as notes at the marker, keeping your timing, as one undo step. Starting a take or capturing clears the memory. From code: `editor.capture.commit()` / `.clear()` / `.count`.
- **Auto key:** the **Auto** button next to the key picks the key and scale that fit the notes best: every note in scale if possible, else the most. Among equal fits, the tonic comes from the note weights and the opening bass note. Undoable.
- **Marquee select** plays each note as it enters the box, so a fast sweep over a chord sounds the chord.
- **Chords** (**H**): a panel of every chord built only from notes in the key, grouped by scale degree. Triads, power, sus, 6ths, 7ths, 9ths, 11ths, 13ths, add, ♭5, no 3 / no 5, and combos (`7sus4♭9`, `maj9♯11`, `m(add9)(11)`…). Filter by type, search, pick an inversion. Click to hear. Drag onto the grid: the chord follows the cursor, release to place it (one beat long, selected, ready to resize). Its lowest note lands on the row nearest the cursor, keeping the root, so it stays in key.
- **Velocity (selection bar):** drag either end of `55 – 65` on its own; the notes in between rescale. Double-click to type `100` (all) or `20-40` (rescale; equal velocities become a ramp).
- `global-shortcuts` attribute: handle shortcuts even when focus is on `<body>` (for full-page editors).

## Import / export MIDI

**Import:** the toolbar's **Import** button (`⌘O`), or drop a `.mid` file on the grid. Notes, tempo, time signature and key are replaced in one undoable step. `<maddie-import>` fires a cancelable `maddie-import` event with `{ file, bytes }`.

**Export:**

The toolbar has an **Export** button (`⌘⇧E`). Or do it in code:

```js
import { toMidiFile, fromMidiFile, downloadMidi } from '@tasteee/maddie/core';

const bytes = toMidiFile(el.doc); // Uint8Array, Standard MIDI File type 1
el.editor.commands.importMidi(bytes); // replace notes from a .mid (undoable)
const parsed = fromMidiFile(bytes); // just parse: { notes, tempo, timeSignature, key, … }
downloadMidi(el.doc, 'my-loop.mid'); // browser download
```

`<maddie-export>` names files `[key]-[scale]-[bpm]-DDMMYYYY-HHMM.mid` (set `filename` to override). It fires a cancelable `maddie-export` event with `{ bytes, filename }`, so you can upload instead of downloading.

## Compose your own

```html
<maddie-root scale="D dorian">
  <my-toolbar>
    <maddie-grid-select></maddie-grid-select>
  </my-toolbar>
  <maddie-keyboard></maddie-keyboard>
  <maddie-piano-roll></maddie-piano-roll>
</maddie-root>
```

Pieces find the nearest `<maddie-root>` automatically. Or wire one directly: `roll.editor = root.editor`.

## Styling

Maddie follows Zest's design system, so theming is Zest theming.

1. **Theme:** set `data-theme` (`dark`, `light`, `console`, `studio`) on `<html>`, or on `<maddie-editor theme="studio">` for the editor alone. Zest's `<z-theme-switcher>` does it for the whole page, and the canvas follows.
2. **Tokens:** every Maddie color is a Zest role (`--background`, `--card`, `--border`, `--foreground`, `--purple`, `--pink`, …). Override one with `--maddie-accent`, `--maddie-bg`, `--maddie-note`, `--maddie-note-radius`, `--maddie-scale` (root tint + scale dots), `--maddie-row-out-of-scale`, `--maddie-key-out-of-scale`, …
3. **Parts:** `maddie-editor::part(toolbar)`, `::part(piano-roll)`, …
4. **Slots:** replace `toolbar`, `corner`, `lane-label`, `inspector`, `footer`; add controls with `toolbar-start` / `toolbar-end` (a `<z-button kind="ghost" size="sm">` fits)
5. **Note color:** `note-color="pitch | pitch-class | mono"` (default `pitch`, sweeping Zest's dominant accent (purple) to its subordinate one (pink))
6. **Canvas hook:** `roll.noteStyle = (note, state) => ({ fill: '#f59e0b' })`

## Develop

```sh
pnpm install
pnpm dev        # playground at localhost:5173
pnpm test       # core unit tests
pnpm build      # library → dist/
```
