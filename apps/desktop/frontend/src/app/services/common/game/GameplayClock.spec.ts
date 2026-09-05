import { GameplayClock, GameplayClockSource } from "./GameplayClock";

/** A source whose position and running state the test drives by hand. */
class FakeSource implements GameplayClockSource {
  currentTimeInMs = 0;
  isRunning = true;
}

describe("GameplayClock", () => {
  let now = 0;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    now = 1000;
    nowSpy = jest.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => nowSpy.mockRestore());

  /** Advances wall time and ticks the clock, as one frame of the game loop would. */
  function frame(clock: GameplayClock, deltaInMs = 16) {
    now += deltaInMs;
    clock.tick();
  }

  function startedClock(durationInMs = 100000) {
    const clock = new GameplayClock();
    clock.setDuration(durationInMs);
    clock.start();
    return clock;
  }

  describe("without a source", () => {
    it("free-runs at the playback speed", () => {
      const clock = startedClock();

      frame(clock, 100);
      expect(clock.timeElapsedInMs).toBeCloseTo(100, 6);

      clock.setSpeed(1.5);
      frame(clock, 100);
      expect(clock.timeElapsedInMs).toBeCloseTo(250, 6);
    });

    it("does not advance while paused", () => {
      const clock = startedClock();
      frame(clock, 100);
      clock.pause();

      frame(clock, 500);
      expect(clock.timeElapsedInMs).toBeCloseTo(100, 6);
    });
  });

  describe("with a source", () => {
    it("takes the source's time verbatim until the source has actually moved", () => {
      const clock = startedClock();
      const source = new FakeSource();
      source.currentTimeInMs = 5000;
      clock.setSource(source);

      // The source has not moved yet, so the clock is not allowed to trust the interpolation.
      frame(clock);
      expect(clock.timeElapsedInMs).toBe(5000);
      expect(clock.isSynced).toBe(false);

      source.currentTimeInMs = 5016;
      frame(clock);
      expect(clock.timeElapsedInMs).toBe(5016);
      expect(clock.isSynced).toBe(true);
    });

    it("keeps moving between the source's updates instead of stalling on them", () => {
      const clock = startedClock();
      const source = new FakeSource();
      clock.setSource(source);

      // Get the clock interpolating first; until the source has moved once, it deliberately just mirrors it.
      source.currentTimeInMs = 0;
      frame(clock);
      source.currentTimeInMs = 16;
      frame(clock);

      // From here the source only reports a new position every third frame, which is what a media element's coarse
      // `currentTime` looks like in practice.
      let sourceTime = 16;
      const times: number[] = [];
      for (let i = 2; i < 14; i++) {
        if (i % 3 === 0) sourceTime = i * 16;
        source.currentTimeInMs = sourceTime;
        frame(clock);
        times.push(clock.timeElapsedInMs);
      }

      // Strictly increasing: no frame is left showing the same time as the previous one.
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThan(times[i - 1]);
      }
    });

    it("converges onto a source that runs slightly ahead", () => {
      const clock = startedClock();
      const source = new FakeSource();
      clock.setSource(source);

      // Get the clock interpolating and then push the source 10 ms ahead of it.
      source.currentTimeInMs = 0;
      frame(clock);
      source.currentTimeInMs = 16;
      frame(clock);

      const drift = 10;
      for (let i = 2; i < 30; i++) {
        source.currentTimeInMs = i * 16 + drift;
        frame(clock);
      }

      expect(clock.timeElapsedInMs).toBeCloseTo(source.currentTimeInMs, 1);
    });

    it("snaps instead of ramping when the source jumps away", () => {
      const clock = startedClock();
      const source = new FakeSource();
      clock.setSource(source);

      source.currentTimeInMs = 0;
      frame(clock);
      source.currentTimeInMs = 16;
      frame(clock);
      expect(clock.isSynced).toBe(true);

      // Far beyond what drift correction is meant for: the source was seeked from underneath us.
      source.currentTimeInMs = 40000;
      frame(clock);

      expect(clock.timeElapsedInMs).toBe(40000);
    });

    it("free-runs while the source is not producing audio", () => {
      const clock = startedClock();
      const source = new FakeSource();
      source.currentTimeInMs = 5000;
      clock.setSource(source);

      source.isRunning = false;
      frame(clock, 100);
      frame(clock, 100);

      // 200 ms of free-running from where the clock already was, ignoring the stalled source entirely.
      expect(clock.timeElapsedInMs).toBeCloseTo(200, 6);
      expect(clock.isSynced).toBe(false);
    });

    it("never runs backwards while the source moves forwards", () => {
      const clock = startedClock();
      const source = new FakeSource();
      clock.setSource(source);

      source.currentTimeInMs = 0;
      frame(clock);
      source.currentTimeInMs = 16;
      frame(clock);

      const times: number[] = [];
      for (let i = 2; i < 20; i++) {
        // A source that keeps lagging a little behind the interpolated time.
        source.currentTimeInMs = i * 16 - 8;
        frame(clock);
        times.push(clock.timeElapsedInMs);
      }

      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
      }
    });

    it("re-syncs from scratch after a seek", () => {
      const clock = startedClock();
      const source = new FakeSource();
      clock.setSource(source);

      source.currentTimeInMs = 0;
      frame(clock);
      source.currentTimeInMs = 16;
      frame(clock);
      expect(clock.isSynced).toBe(true);

      clock.seekTo(30000);
      expect(clock.timeElapsedInMs).toBe(30000);
      expect(clock.isSynced).toBe(false);
    });
  });
});
