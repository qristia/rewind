import { HitSampleInfo } from "@osujs/core";

export interface HitSoundEvent {
  /** The game time at which the sound should be heard, in milliseconds. */
  timeInMs: number;
  /** The samples that are layered on top of each other at that moment. */
  samples: HitSampleInfo[];
}

/**
 * How far ahead of the playhead sounds are handed to the audio hardware. It has to comfortably exceed one frame so
 * that a late frame cannot delay a sound, while staying short enough that the clock's drift correction cannot move
 * the playhead noticeably within the window.
 */
const LOOKAHEAD_MS = 150;

/**
 * Sounds the playhead has already passed by more than this are dropped instead of fired late. Without it, a stall or
 * a rate change would be followed by a burst of everything that was missed in the meantime.
 */
const MAX_LATE_MS = 40;

/**
 * Plays a replay's hit sounds in sync with the music.
 *
 * The whole point is that nothing is ever played "now": every sound is handed to the Web Audio clock ahead of time
 * with an explicit start time, so its position is decided by the audio hardware rather than by whenever a frame
 * happens to run. `AudioBufferSourceNode.start(when)` is sample accurate, whereas firing sounds from a render loop
 * quantises them to frame boundaries and adds all the jitter of the frame timing on top.
 *
 * Because the gameplay clock follows the music track, mapping game time onto the audio context's clock also keeps hit
 * sounds locked to the music: both go through the same context and therefore share the same output latency.
 */
export class HitSoundPlayer {
  private schedule: HitSoundEvent[] = [];
  private buffers = new Map<string, AudioBuffer>();

  /** Index of the next event in `schedule` that has not been handed to the audio clock yet. */
  private pointer = 0;
  /** Sources that have been scheduled but have not finished playing, so that a seek can cut them off. */
  private pending = new Set<AudioBufferSourceNode>();

  private offsetInMs = 0;

  constructor(private readonly audioContext: AudioContext, private readonly destination: AudioNode) {}

  setSchedule(schedule: HitSoundEvent[], currentTimeInMs: number) {
    this.schedule = [...schedule].sort((a, b) => a.timeInMs - b.timeInMs);
    this.resetTo(currentTimeInMs);
  }

  setBuffers(buffers: Map<string, AudioBuffer>) {
    this.buffers = buffers;
  }

  /**
   * A positive offset delays the hit sounds, which is the knob to reach for when a particular setup plays them
   * consistently ahead of the music.
   */
  setOffset(offsetInMs: number) {
    this.offsetInMs = offsetInMs;
  }

  clear() {
    this.schedule = [];
    this.buffers = new Map();
    this.pointer = 0;
    this.cancelPending();
  }

  /**
   * Drops everything that was scheduled and points at the first event after `timeInMs`. Has to be called whenever the
   * playhead moves discontinuously, since sounds scheduled for the old timeline would otherwise still fire.
   */
  resetTo(timeInMs: number) {
    this.cancelPending();

    let lo = 0;
    let hi = this.schedule.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.schedule[mid].timeInMs <= timeInMs) lo = mid + 1;
      else hi = mid;
    }
    this.pointer = lo;
  }

  /**
   * Hands every sound that falls into the lookahead window to the audio clock. Meant to be called once per frame with
   * the time the rest of the frame is rendered at.
   */
  update(gameTimeInMs: number, rate: number) {
    if (this.schedule.length === 0) return;

    const contextNow = this.audioContext.currentTime;
    const horizonInMs = gameTimeInMs + LOOKAHEAD_MS * rate;

    while (this.pointer < this.schedule.length && this.schedule[this.pointer].timeInMs <= horizonInMs) {
      const event = this.schedule[this.pointer++];

      // A game time delta covers `delta / rate` milliseconds of real time.
      const delayInMs = (event.timeInMs - gameTimeInMs) / rate + this.offsetInMs;
      if (delayInMs < -MAX_LATE_MS) continue;

      const when = contextNow + Math.max(0, delayInMs) / 1000;
      for (const sample of event.samples) this.play(sample, when);
    }
  }

  private play(sample: HitSampleInfo, when: number) {
    const buffer = this.buffers.get(sample.key);
    if (!buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    // Deliberately no `playbackRate` adjustment: hit sounds keep their natural pitch at every game speed, matching
    // the pitch-preserving time stretch that the music gets.
    const gain = this.audioContext.createGain();
    gain.gain.value = Math.max(0, Math.min(1, sample.volume / 100));

    source.connect(gain);
    gain.connect(this.destination);

    source.onended = () => {
      this.pending.delete(source);
      gain.disconnect();
    };

    this.pending.add(source);
    source.start(when);
  }

  private cancelPending() {
    for (const source of this.pending) {
      try {
        source.stop();
      } catch {
        // Already stopped or never started; nothing to do.
      }
    }
    this.pending.clear();
  }
}
