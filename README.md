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

The **top row** holds transport, tempo, input, output, and the MIDI file menu. The **edit row** holds grid division and feel, key and scale, row folding, chords, undo/redo, and zoom. The **track strip** keeps Add piano track, Add chord track, and Snap to grid at the right while tracks scroll. Open a track's options for rename, mute, solo, color, and remove.

- **Space** starts from the **insert marker** and stops back at it. Click empty grid space or the ruler to place the marker for paste and the next start, even while playback continues. **Shift+Space** resumes from where playback stopped. **Shift-click** the ruler to jump playback while keeping the insert marker in place. **Enter** goes back to the start.
- **← / →** move to the previous / next grid line: the play marker when nothing is selected, else the selected notes (the first one lands on the line, the rest keep their spacing). **Ctrl ← / →** (⌘ on Mac) step by lines one level finer than the zoom shows (halfway between visible lines), and **Ctrl ⇧ ← / →** two levels finer (a quarter of the way), down to 1/64. Small aligned moves without zooming in. **⇧← / ⇧→** move note ends to grid lines. Everything snaps to lines of the current grid, never a grid step away from an off-grid spot.
- **Loop:** drag on the ruler to draw a loop, drag its ends to resize, or click the loop bar to toggle it. **Ctrl+L** (**⌘+L** on Mac) sets the loop to the selection.
- **Toggle palette:** tap **T**, then press **L** for looping, **F** to follow the playhead, or **M** for the metronome. Pick a row with the mouse or apply a shortcut on release. **T** or **Esc** dismisses the palette.
- **Volume** (**⇧M** mutes): open **Output** for the sound, volume, mute and metronome. The metronome uses `output.click(e)` if present, else a short built-in click. Volume uses `output.setVolume(v)` if present, else scales velocity.
- **Fold rows:** tap **F**, then **O** for Off, **N** for Notes, or **K** for Key. **Key** is available after you choose a key. **F** or **Esc** dismisses the menu.
- **Reading the keys:** when a key is set, an orange mark appears at the right edge of each piano key outside the scale.
- **Keyboard input:** **`** toggles. Only letters play notes. The Z row starts at C2, and each row above continues from the one below in semitone steps. **+ / −** shift octaves (Z wraps C6 → C0). Standalone letter shortcuts and **S + T + G** are paused while it's on.
- **Grid:** tap **G** to open Grid, then press **D** to cycle divisions, **F** to cycle feel, **A** for Auto, or **S** for snapping. The menu stays open for adjustments. **G** or **Esc** dismisses it.
- **Snap to grid:** hold **S + T + G** together in any order. Tap **S** to solo the active track or **M** to mute it.
- **Panels palette:** tap **/**, then **C** for Chords, **S** for Suggestions, or **V** for the velocity lane. Hold **/** and press a letter to toggle its panel directly. Both forms work with keyboard MIDI input on.
- **Track focus:** press **Tab** to move to the next track, or **Shift+Tab** to move to the previous one, while editing in the grid.
- **Velocity and mute:** press **0** to mute or unmute selected notes or chord blocks. Start with **1–9** to enter a MIDI velocity like **80** or a range like **50-70**. **Enter** applies it immediately and **Esc** cancels. A complete entry also applies after a short pause. A chord range makes higher pitches louder and follows changes to its voicing and pattern.
- **MIDI input:** the MIDI button asks the browser for access (Web MIDI) and plays notes from a controller. Open **Input** to pick a device, or listen to all. Keyboard and MIDI input are separate modes: turning one on turns the other off.
- **Record** (the red button, or **R** while keyboard input is off): plays from the marker and records what you play (computer keyboard or MIDI) onto the grid until you stop. Notes grow under a red playhead while held. Each take is one undo step and ends selected. Loops overdub. Space or the stop button also ends the take. From code: `editor.recorder.start()` / `.stop()`; anything sent to `editor.liveNoteOn/Off` is recorded.
- **Capture** (the viewfinder button next to record, or **⇧R** while keyboard input is off): MIDI input is always listening. Play something while not recording, then press capture to keep it: the last ~10 minutes of what you played land as notes at the marker, keeping your timing, as one undo step. Starting a take or capturing clears the memory. From code: `editor.capture.commit()` / `.clear()` / `.count`.
- **Detect from notes:** open the **Key** menu to find the key and scale that best fit the unmuted notes across all tracks. Detection keeps the current key if every note already fits it. Key changes can be undone.
- **Marquee select** plays each note as it enters the box, so a fast sweep over a chord sounds the chord.
- **Chords** (**/ + C**): a panel of every chord built only from notes in the key, grouped by scale degree. Triads, power, sus, 6ths, 7ths, 9ths, 11ths, 13ths, add, ♭5, no 3 / no 5, and combos (`7sus4♭9`, `maj9♯11`, `m(add9)(11)`…). Filter by type, search, pick an inversion. Click to hear. Drag onto the grid: the chord follows the cursor, release to place it (one beat long, selected, ready to resize). Its lowest note lands on the row nearest the cursor, keeping the root, so it stays in key.
- **Velocity lane:** its header holds the selection’s velocity, Humanize and Ramp, plus Accent on chord tracks. Drag stems or chord handles in the graph to adjust velocity directly.
- **Legato:** hold **N + L** to extend selected notes to the next note.
- A single-key shortcut runs on release. A held combination runs when its final key goes down and cancels the individual shortcuts for its keys.
- `global-shortcuts` attribute: handle shortcuts even when focus is on `<body>` (for full-page editors).

## Local project files

In a browser that supports the File System Access API, open the Project menu and select **Local project folder… → Choose folder…**. Create or select a folder in the browser picker and grant read/write access. Select a listed `.maddie` file to open it, or choose **Save project here** to write the current project to that folder. Maddie asks before replacing an existing file.

Maddie remembers the selected folder in this browser. Use **Allow folder access** if the browser asks for permission again. The browser library continues to autosave your working copy. **Import project…** and **Export project…** also work with individual files in browsers without folder access.

## Import / export MIDI

**Import:** choose **Import MIDI** from the toolbar's **MIDI** menu (`⌘O`) or drop one or more MIDI files onto the grid. Maddie appends the tracks in one undo step and keeps the project's tempo, time signature, and key. Tracks from the same file share a color, and multi-track files prefix each track name with the filename. Each file fires a cancelable `maddie-import` event with `{ file, bytes }`.

**Export:**

Choose **Export MIDI** from a track's options to download that track, or from the toolbar's **MIDI** menu (`⌘⇧E`) to download the full project. Or do it in code:

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

1. **Theme:** set `data-theme` (`dark` or `light`) on `<html>`, or use `<maddie-editor theme="light">` for the editor alone. Zest's `<z-theme-switcher>` does it for the whole page, and the canvas follows.
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
