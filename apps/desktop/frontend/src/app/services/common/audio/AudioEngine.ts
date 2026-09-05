import { inject, injectable, postConstruct } from "inversify";
import { AudioSettings, AudioSettingsStore } from "./settings";
import { STAGE_TYPES } from "../../types";
import { GameplayClock, GameplayClockSource } from "../game/GameplayClock";
import { HitSoundEvent, HitSoundPlayer } from "./HitSoundPlayer";

// HTML5 Audio supports time stretching without pitch changing (otherwise sounds like night core)
// Chromium's implementation of <audio> is the best.
// HTML5 Audio currentTime sucks though in terms of accuracy, which is why the gameplay clock interpolates it instead
// of reading it directly.

/**
 * Owns the music track and the hit sounds, and acts as the gameplay clock's source.
 *
 * Both go through the same `AudioContext`, which is what keeps them in sync: the clock follows the music, and hit
 * sounds are scheduled onto the context's clock from that same time, so the two share one timeline and one output
 * latency.
 */
@injectable()
export class AudioEngine implements GameplayClockSource {
  // Just like in osu!, we can change the volume of music and samples separately
  musicGain: GainNode;
  samplesGain: GainNode;
  masterGain: GainNode;

  song?: MediaElementAudioSourceNode;

  private readonly hitSoundPlayer: HitSoundPlayer;

  constructor(
    private readonly audioSettingService: AudioSettingsStore,
    @inject(STAGE_TYPES.AUDIO_CONTEXT) private readonly audioContext: AudioContext,
    private readonly gameClock: GameplayClock,
  ) {
    this.masterGain = this.audioContext.createGain();
    this.musicGain = this.audioContext.createGain();
    this.musicGain.connect(this.masterGain);
    this.samplesGain = this.audioContext.createGain();
    this.samplesGain.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);

    this.hitSoundPlayer = new HitSoundPlayer(this.audioContext, this.samplesGain);
  }

  @postConstruct()
  postConstruct() {
    console.log("Initializing AudioEngine");
    this.setupListeners();
  }

  setSong(audio: HTMLAudioElement) {
    this.song = this.audioContext.createMediaElementSource(audio);
    this.song.connect(this.musicGain);
    this.gameClock.setSource(this);
  }

  setupListeners() {
    this.gameClock.seeked$.subscribe(this.seekTo.bind(this));
    this.gameClock.isPlaying$.subscribe((isPlaying: boolean) => {
      if (isPlaying) this.start();
      else this.pause();
    });
    this.gameClock.speed$.subscribe(this.changePlaybackRate.bind(this));

    this.audioSettingService.settings$.subscribe((value) => this.handleAudioSettingsChanged(value));
  }

  // --- GameplayClockSource -------------------------------------------------

  get currentTimeInMs(): number {
    return (this.song?.mediaElement.currentTime ?? 0) * 1000;
  }

  get isRunning(): boolean {
    const element = this.song?.mediaElement;
    if (!element) return false;
    // `paused` clears the moment `play()` is called and `seeking` only clears once the new position is ready, so
    // together they separate "the track is producing audio" from "the track is about to".
    return !element.paused && !element.seeking && element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;
  }

  // --- Hit sounds ----------------------------------------------------------

  setHitSoundSchedule(schedule: HitSoundEvent[]) {
    this.hitSoundPlayer.setSchedule(schedule, this.gameClock.timeElapsedInMs);
  }

  setHitSoundBuffers(buffers: Map<string, AudioBuffer>) {
    this.hitSoundPlayer.setBuffers(buffers);
  }

  /**
   * Hands the upcoming hit sounds to the audio clock. Must be called once per frame, after the gameplay clock has
   * been ticked, so that it works off the same time as everything else in the frame.
   */
  update() {
    if (!this.gameClock.isPlaying) return;

    if (!this.gameClock.isSynced) {
      // The playhead is still free-running while the track catches up, and will jump once it takes over. Anything
      // scheduled against it now would land at the wrong moment, so only the pointer is kept up to date.
      this.hitSoundPlayer.resetTo(this.gameClock.timeElapsedInMs);
      return;
    }

    this.hitSoundPlayer.update(this.gameClock.timeElapsedInMs, this.gameClock.speed);
  }

  // --- Playback ------------------------------------------------------------

  start() {
    // TODO: ???
    this.audioContext.resume();
    this.song?.mediaElement.play();
  }

  pause() {
    this.song?.mediaElement.pause();
    // Anything already handed to the audio clock would otherwise keep playing over the paused music.
    this.hitSoundPlayer.resetTo(this.gameClock.timeElapsedInMs);
  }

  changePlaybackRate(newPlaybackRate: number) {
    if (this.song) {
      this.song.mediaElement.playbackRate = newPlaybackRate;
    }
    // Sounds scheduled at the old rate would land at the wrong moment.
    this.hitSoundPlayer.resetTo(this.gameClock.timeElapsedInMs);
  }

  // Don't know if this is accurate *enough*
  currentTime() {
    return this.currentTimeInMs;
  }

  seekTo(toInMs: number) {
    if (this.song) {
      this.song.mediaElement.currentTime = toInMs / 1000;
    }
    this.hitSoundPlayer.resetTo(toInMs);
  }

  get isPlaying() {
    return !this.song?.mediaElement.paused;
  }

  togglePlaying(): boolean {
    if (this.isPlaying) this.pause();
    else this.start();
    return this.isPlaying;
  }

  get durationInMs() {
    return (this.song?.mediaElement.duration ?? 1) * 1000;
  }

  destroy() {
    this.gameClock.setSource(undefined);
    this.hitSoundPlayer.clear();
    if (this.song) {
      this.song.disconnect();
      this.song = undefined;
    }
  }

  private handleAudioSettingsChanged(settings: AudioSettings) {
    const { muted, volume, hitSoundOffsetInMs } = settings;
    this.masterGain.gain.value = muted ? 0 : volume.master;
    this.musicGain.gain.value = volume.music;
    this.samplesGain.gain.value = volume.effects;
    this.hitSoundPlayer.setOffset(hitSoundOffsetInMs);
  }
}
