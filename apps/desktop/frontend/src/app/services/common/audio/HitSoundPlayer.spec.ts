import { HitSampleInfo } from "@osujs/core";
import { HitSoundEvent, HitSoundPlayer } from "./HitSoundPlayer";

interface StartedSource {
  when: number;
  stopped: boolean;
}

/**
 * The slice of the Web Audio API the player touches, recording every `start(when)` so that the scheduling maths can
 * be asserted on directly.
 */
class FakeAudioContext {
  currentTime = 0;
  readonly started: StartedSource[] = [];

  createBufferSource() {
    const record: StartedSource = { when: NaN, stopped: false };
    return {
      buffer: null as AudioBuffer | null,
      onended: null as (() => void) | null,
      connect: () => undefined,
      start: (when: number) => {
        record.when = when;
        this.started.push(record);
      },
      stop: () => {
        record.stopped = true;
      },
    };
  }

  createGain() {
    return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
  }
}

const SAMPLE = new HitSampleInfo(HitSampleInfo.HIT_NORMAL, HitSampleInfo.BANK_NORMAL, null, 100);

function setup(schedule: HitSoundEvent[], currentTimeInMs = 0) {
  const context = new FakeAudioContext();
  const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
  player.setBuffers(new Map([[SAMPLE.key, {} as AudioBuffer]]));
  player.setSchedule(schedule, currentTimeInMs);
  return { context, player };
}

const event = (timeInMs: number, samples = [SAMPLE]): HitSoundEvent => ({ timeInMs, samples });

describe("HitSoundPlayer", () => {
  it("starts a sound at the audio-clock time the game time maps onto", () => {
    const { context, player } = setup([event(5100)]);
    context.currentTime = 10;

    player.update(5000, 1);

    // 100 ms after the frame's game time, so 0.1 s after the context time that game time corresponds to.
    expect(context.started).toHaveLength(1);
    expect(context.started[0].when).toBeCloseTo(10.1, 9);
  });

  it("compresses the delay by the playback rate", () => {
    const { context, player } = setup([event(5150)]);
    context.currentTime = 10;

    // At 1.5x, 150 ms of game time pass in 100 ms of real time.
    player.update(5000, 1.5);

    expect(context.started[0].when).toBeCloseTo(10.1, 9);
  });

  it("layers every sample of an event at the same time", () => {
    const whistle = new HitSampleInfo(HitSampleInfo.HIT_WHISTLE, HitSampleInfo.BANK_NORMAL, null, 100);
    const context = new FakeAudioContext();
    const player = new HitSoundPlayer(context as unknown as AudioContext, {} as AudioNode);
    player.setBuffers(
      new Map([
        [SAMPLE.key, {} as AudioBuffer],
        [whistle.key, {} as AudioBuffer],
      ]),
    );
    player.setSchedule([event(5100, [SAMPLE, whistle])], 0);
    context.currentTime = 10;

    player.update(5000, 1);

    expect(context.started.map((s) => s.when)).toEqual([10.1, 10.1]);
  });

  it("only schedules what falls inside the lookahead window", () => {
    const { context, player } = setup([event(5100), event(5900)]);
    context.currentTime = 10;

    player.update(5000, 1);
    expect(context.started).toHaveLength(1);

    // Once the playhead has moved close enough, the second sound is handed over too.
    context.currentTime = 10.8;
    player.update(5800, 1);
    expect(context.started).toHaveLength(2);
    expect(context.started[1].when).toBeCloseTo(10.9, 9);
  });

  it("hands each sound to the audio clock exactly once", () => {
    const { context, player } = setup([event(5100)]);
    context.currentTime = 10;

    player.update(5000, 1);
    player.update(5016, 1);
    player.update(5032, 1);

    expect(context.started).toHaveLength(1);
  });

  it("drops sounds the playhead has long passed instead of firing a burst", () => {
    const { context, player } = setup([event(5000)]);
    context.currentTime = 10;

    // A stall put the playhead a full second past the sound.
    player.update(6000, 1);

    expect(context.started).toHaveLength(0);
  });

  it("still plays a sound that is only marginally late, at the earliest possible moment", () => {
    const { context, player } = setup([event(4990)]);
    context.currentTime = 10;

    player.update(5000, 1);

    expect(context.started).toHaveLength(1);
    expect(context.started[0].when).toBe(10);
  });

  it("applies the offset on top of the scheduled time", () => {
    const { context, player } = setup([event(5100)]);
    context.currentTime = 10;
    player.setOffset(20);

    player.update(5000, 1);

    expect(context.started[0].when).toBeCloseTo(10.12, 9);
  });

  it("stops what is already scheduled when the playhead jumps", () => {
    const { context, player } = setup([event(5100)]);
    context.currentTime = 10;
    player.update(5000, 1);

    player.resetTo(20000);

    expect(context.started[0].stopped).toBe(true);
  });

  it("re-points at the first sound after a seek", () => {
    const { context, player } = setup([event(1000), event(2000), event(3000)]);

    // The sound sitting exactly on the seek target counts as already past, so the next one up is the one at 3000.
    player.resetTo(2000);
    context.currentTime = 10;
    player.update(2900, 1);

    expect(context.started).toHaveLength(1);
    expect(context.started[0].when).toBeCloseTo(10.1, 9);
  });

  it("silently skips samples whose file could not be loaded", () => {
    const missing = new HitSampleInfo("hitclap", "drum", null, 100);
    const { context, player } = setup([event(5100, [SAMPLE, missing])]);
    context.currentTime = 10;

    player.update(5000, 1);

    expect(context.started).toHaveLength(1);
  });
});
