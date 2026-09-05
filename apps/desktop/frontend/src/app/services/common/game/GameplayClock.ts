import { injectable } from "inversify";
import { BehaviorSubject, Subject } from "rxjs";

const getNowInMs = () => performance.now();

/**
 * A clock the gameplay clock can slave itself to, in practice the beatmap's audio track.
 */
export interface GameplayClockSource {
  /** Position of the source in milliseconds. */
  readonly currentTimeInMs: number;

  /**
   * Whether the source is currently producing audio. This is `false` while the track is paused, still starting up,
   * buffering or seeking; during those windows the gameplay clock runs on its own instead.
   */
  readonly isRunning: boolean;
}

/**
 * How far the interpolated time may drift from the source before it is thrown away in favour of the source's own
 * time. Two frames at 60 fps, same as osu!.
 */
const ALLOWABLE_ERROR_MS = (1000 / 60) * 2;

/**
 * The remaining drift towards the source halves every this many milliseconds. Correcting gradually turns what would
 * be a hard jump into a barely noticeable ramp in playback speed.
 */
const DRIFT_RECOVERY_HALF_LIFE_MS = 50;

/** Moves `current` towards `target`, halving the remaining distance every `halfLife` milliseconds. */
function dampContinuously(current: number, target: number, halfLife: number, elapsedInMs: number): number {
  return target + (current - target) * Math.pow(0.5, elapsedInMs / halfLife);
}

/**
 * The clock every part of the analyzer reads its time from.
 *
 * The audio track is the source of truth: it is the one thing that cannot be nudged without becoming audible, so
 * everything else follows it. Between the source's own updates -- which are coarse and only arrive every so often --
 * the time is interpolated with `performance.now()` so that the rendering stays smooth, and the accumulated error is
 * continuously damped away. This mirrors osu!'s `DecouplingFramedClock` / `InterpolatingFramedClock` pair.
 *
 * Without a source (no replay loaded, or the track has not started yet) the clock simply free-runs.
 */
@injectable()
export class GameplayClock {
  public isPlaying$: BehaviorSubject<boolean>;
  public durationInMs$: BehaviorSubject<number>;
  public speed$: BehaviorSubject<number>;

  public seeked$: Subject<number>;

  // Things that get updated very often should not be Subjects due to performance issues
  public timeElapsedInMs = 0;
  private lastUpdateTimeInMs = 0;

  private source?: GameplayClockSource;
  /**
   * Whether the last update interpolated instead of taking the source's time verbatim. Interpolation only starts once
   * the source has actually moved, so that a seek or a fresh start snaps rather than ramps.
   */
  private isInterpolating = false;
  /** The source's time at the previous update, used to tell whether it has moved at all. */
  private lastSourceTimeInMs?: number;

  constructor() {
    this.isPlaying$ = new BehaviorSubject<boolean>(false);
    this.durationInMs$ = new BehaviorSubject<number>(0);
    this.speed$ = new BehaviorSubject<number>(1);
    this.seeked$ = new Subject<number>();
  }

  /**
   * Slaves this clock to `source`. Passing `undefined` lets it free-run again, which is what happens when a replay is
   * unloaded.
   */
  setSource(source?: GameplayClockSource) {
    this.source = source;
    this.resetSourceTracking();
  }

  private resetSourceTracking() {
    this.isInterpolating = false;
    this.lastSourceTimeInMs = undefined;
  }

  /**
   * Whether `timeElapsedInMs` currently tracks the source. It is `false` in the short window after a start or a seek,
   * while the track is still catching up and the clock free-runs; the time may jump once the source takes over.
   *
   * Without a source there is nothing to be out of sync with, so it is `true`.
   */
  get isSynced(): boolean {
    return this.source === undefined || this.isInterpolating;
  }

  /**
   * Tick should only be used once in each frame and for the rest of the frame one should refer to `timeElapsedInMs`.
   * This is to ensure that every related game object is referring to the same time at the same time.
   */
  tick() {
    this.updateTimeElapsed();
    if (this.timeElapsedInMs > this.durationInMs) {
      this.pause();
      this.timeElapsedInMs = this.durationInMs;
    }
    return this.timeElapsedInMs;
  }

  get speed() {
    return this.speed$.getValue();
  }

  set speed(value: number) {
    this.speed$.next(value);
  }

  get durationInMs() {
    return this.durationInMs$.getValue();
  }

  set durationInMs(value: number) {
    this.durationInMs$.next(Number.isNaN(value) ? 0 : value);
  }

  get isPlaying() {
    return this.isPlaying$.getValue();
  }

  set isPlaying(value: boolean) {
    this.isPlaying$.next(value);
  }

  updateTimeElapsed() {
    const nowInMs = getNowInMs();
    const realDeltaInMs = nowInMs - this.lastUpdateTimeInMs;
    this.lastUpdateTimeInMs = nowInMs;

    if (!this.isPlaying) return;

    const previousTimeInMs = this.timeElapsedInMs;

    // The source is only usable while it is actually producing audio. It is not right after `play()`, during a seek
    // or while buffering, and following it through those windows would stutter.
    const sourceTimeInMs = this.source?.isRunning ? this.source.currentTimeInMs : undefined;
    const sourceElapsedInMs =
      sourceTimeInMs !== undefined && this.lastSourceTimeInMs !== undefined
        ? sourceTimeInMs - this.lastSourceTimeInMs
        : 0;
    this.lastSourceTimeInMs = sourceTimeInMs;

    if (sourceTimeInMs === undefined) {
      // Free-running, either because no track is loaded or because it has not caught up yet.
      this.isInterpolating = false;
      this.timeElapsedInMs += this.speed * realDeltaInMs;
    } else if (this.isInterpolating) {
      this.timeElapsedInMs += this.speed * realDeltaInMs;
      this.timeElapsedInMs = dampContinuously(
        this.timeElapsedInMs,
        sourceTimeInMs,
        DRIFT_RECOVERY_HALF_LIFE_MS,
        realDeltaInMs,
      );

      // Damping is meant for the small error that accumulates between the source's own updates. Anything larger is a
      // real discontinuity -- a stall, or a seek we did not initiate -- and is better resolved by jumping.
      if (Math.abs(sourceTimeInMs - this.timeElapsedInMs) > ALLOWABLE_ERROR_MS * this.speed) {
        this.isInterpolating = false;
        this.timeElapsedInMs = sourceTimeInMs;
      }
    } else {
      this.timeElapsedInMs = sourceTimeInMs;
      // Only start interpolating once the source has moved: the first time it reports after a start or a seek is
      // frequently still the previous one.
      if (sourceElapsedInMs !== 0) this.isInterpolating = true;
    }

    // Playback only ever runs forwards here, so the time must not go back unless the source itself did. This is what
    // keeps a snap onto a still-catching-up source from being visible as a stutter.
    if (sourceElapsedInMs >= 0) {
      this.timeElapsedInMs = Math.max(previousTimeInMs, this.timeElapsedInMs);
    }
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.start();
  }

  start() {
    if (this.isPlaying) return;

    // TODO: Maybe
    // Resets it back to 0 in case the user wants to start the clock again when it already ended.
    if (this.timeElapsedInMs >= this.durationInMs) {
      // Will also emit an event
      this.seekTo(0);
    }
    this.isPlaying = true;
    this.resetSourceTracking();
    this.lastUpdateTimeInMs = getNowInMs();
  }

  pause() {
    if (!this.isPlaying) return;
    this.updateTimeElapsed();
    this.isPlaying = false;
    this.resetSourceTracking();
  }

  setSpeed(speed: number) {
    this.updateTimeElapsed();
    this.speed = speed;
    // The track applies its own rate change a moment later, so re-sync from scratch.
    this.resetSourceTracking();
  }

  setDuration(durationInMs: number) {
    console.debug(`GameClock duration has been set to ${durationInMs}ms`);
    this.durationInMs = durationInMs;
  }

  seekTo(timeInMs: number) {
    timeInMs = Math.min(this.durationInMs, Math.max(0, timeInMs));
    this.timeElapsedInMs = timeInMs;
    this.lastUpdateTimeInMs = getNowInMs();
    this.resetSourceTracking();
    this.seeked$.next(timeInMs);
  }

  clear() {
    this.pause();
    this.setSource(undefined);
    this.speed$.next(1.0);
    // This is just ahot fix
    this.durationInMs$.next(1);
    this.timeElapsedInMs = 0;
  }
}
