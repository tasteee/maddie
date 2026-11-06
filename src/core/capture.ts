import { createId, type Editor } from './editor';
import { secondsToTicks, ticksToSeconds } from './music/timeline';
import type { NoteId } from './types';

const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_NOTES = 1000;

type CapturedNoteT = {
	pitch: number
	velocity: number
	pressedAtMs: number
	releasedAtMs: number | null
}

export type CaptureT = {
	/** How many played notes are waiting to be captured. */
	readonly count: number
	/** Subscribe to count changes. Returns an unsubscribe function. */
	onChange: (listener: () => void) => () => void
	/** @internal From `editor.liveNoteOn`. */
	noteOn: (pitch: number, velocity: number) => void
	/** @internal From `editor.liveNoteOff`. */
	noteOff: (pitch: number) => void
	/** Throw away everything heard so far. */
	clear: () => void
	/** Turn what was played into notes at the marker. One undo step. Returns the new note ids. */
	commit: () => NoteId[]
}

/**
 * Always listening. Remembers the live notes you play (computer keyboard, MIDI input)
 * while no take is recording, so a good idea played by accident can be kept after the fact.
 * Starting a take clears it, and so does a capture.
 * `now` is injectable so tests can control time.
 */
export const createCapture = (editor: Editor, now: () => number = () => performance.now()): CaptureT => {
	let heard: CapturedNoteT[] = []
	const heldByPitch = new Map<number, CapturedNoteT>()
	const listeners = new Set<() => void>()

	const notify = () => listeners.forEach((listener) => listener())

	const dropOldNotes = () => {
		const oldestAllowedMs = now() - MAX_AGE_MS
		const isRecentEnough = (note: CapturedNoteT) => note.releasedAtMs === null || note.releasedAtMs >= oldestAllowedMs
		const recentNotes = heard.filter(isRecentEnough)
		const newestNotes = recentNotes.slice(-MAX_NOTES)
		heard = newestNotes
	}

	const noteOn = (pitch: number, velocity: number) => {
		const isTakeRecording = editor.recorder.recording
		if (isTakeRecording) return
		const wasEmpty = heard.length === 0
		const note: CapturedNoteT = { pitch, velocity, pressedAtMs: now(), releasedAtMs: null }
		noteOff(pitch)
		heard.push(note)
		heldByPitch.set(pitch, note)
		dropOldNotes()
		if (wasEmpty) notify()
	}

	const noteOff = (pitch: number) => {
		const note = heldByPitch.get(pitch)
		if (!note) return
		note.releasedAtMs = now()
		heldByPitch.delete(pitch)
	}

	const clear = () => {
		const hadNotes = heard.length > 0
		heard = []
		heldByPitch.clear()
		if (hadNotes) notify()
	}

	const commit = (): NoteId[] => {
		const hasNothing = heard.length === 0
		if (hasNothing) return []

		const capturedAtMs = now()
		const firstPressedAtMs = heard[0].pressedAtMs
		const { tempo, ppq } = editor.meta
		const markerTick = editor.transport.marker
		const markerSeconds = ticksToSeconds(markerTick, tempo, ppq)

		const toTick = (timeMs: number) => {
			const secondsFromFirstNote = (timeMs - firstPressedAtMs) / 1000
			return Math.round(secondsToTicks(markerSeconds + secondsFromFirstNote, tempo, ppq))
		}

		const newNotes = heard.map((note) => {
			const start = toTick(note.pressedAtMs)
			const end = toTick(note.releasedAtMs ?? capturedAtMs)
			const duration = Math.max(1, end - start)
			return { id: createId(), pitch: note.pitch, velocity: note.velocity, start, duration }
		})

		editor.transact('Capture MIDI', (tx) => newNotes.forEach((note) => tx.add(note)))
		const newIds = newNotes.map((note) => note.id)
		editor.select(newIds)
		clear()
		return newIds
	}

	const onChange = (listener: () => void) => {
		listeners.add(listener)
		return () => listeners.delete(listener)
	}

	return {
		get count() {
			return heard.length
		},
		onChange,
		noteOn,
		noteOff,
		clear,
		commit,
	}
}
