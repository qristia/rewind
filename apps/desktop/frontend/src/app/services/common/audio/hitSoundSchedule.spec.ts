import {
  Beatmap,
  buildBeatmap,
  defaultGameState,
  GameState,
  isHitCircle,
  isSlider,
  parseBlueprint,
  Slider,
} from "@osujs/core";
import { buildHitSoundSchedule, distinctSamples } from "./hitSoundSchedule";

function build(hitObjects: string[]): Beatmap {
  const data = `osu file format v14
[General]
AudioFilename: audio.mp3
SampleSet: Normal
Mode: 0

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:9
ApproachRate:9
SliderMultiplier:1.8
SliderTickRate:1

[TimingPoints]
0,400,4,1,0,100,1,0

[HitObjects]
${hitObjects.join("\n")}
`;
  return buildBeatmap(parseBlueprint(data), { addStacking: false, mods: [] });
}

/** A state in which every circle was hit on time and every slider checkpoint was collected. */
function perfectState(beatmap: Beatmap): GameState {
  const state = defaultGameState();

  const judgeCircle = (id: string, time: number) => {
    state.hitCircleVerdict[id] = { type: "GREAT", judgementTime: time };
  };

  for (const hitObject of beatmap.hitObjects) {
    if (isSlider(hitObject)) {
      judgeCircle(hitObject.head.id, hitObject.head.hitTime);
      for (const checkPoint of hitObject.checkPoints) {
        state.checkPointVerdict[checkPoint.id] = { hit: true };
      }
    } else if (isHitCircle(hitObject)) {
      judgeCircle(hitObject.id, hitObject.hitTime);
    }
  }

  return state;
}

const names = (beatmap: Beatmap, state: GameState) =>
  buildHitSoundSchedule(beatmap, state).map((e) => [e.timeInMs, e.samples.map((s) => s.lookupNames[0])] as const);

describe("buildHitSoundSchedule", () => {
  it("plays a circle at the time the player actually hit it, not at the object's time", () => {
    const beatmap = build(["100,100,1000,1,0,0:0:0:0:"]);
    const state = perfectState(beatmap);
    state.hitCircleVerdict["0"] = { type: "OK", judgementTime: 1037 };

    expect(names(beatmap, state)).toEqual([[1037, ["normal-hitnormal"]]]);
  });

  it("keeps missed objects silent", () => {
    const beatmap = build(["100,100,1000,1,0,0:0:0:0:", "100,100,2000,1,0,0:0:0:0:"]);
    const state = perfectState(beatmap);
    state.hitCircleVerdict["0"] = { type: "MISS", judgementTime: 1050, missReason: "TIME_EXPIRED" };

    expect(names(beatmap, state)).toEqual([[2000, ["normal-hitnormal"]]]);
  });

  it("keeps objects that were never judged silent", () => {
    const beatmap = build(["100,100,1000,1,0,0:0:0:0:"]);

    expect(names(beatmap, defaultGameState())).toEqual([]);
  });

  it("plays the slider tail at the slider's end rather than at the scoring last tick", () => {
    const beatmap = build(["100,100,1000,2,0,L|200:100,1,22.5,0|8,0:0|0:0,0:0:0:0:"]);
    const slider = beatmap.hitObjects[0] as Slider;
    const lastTick = slider.checkPoints.find((c) => c.type === "LAST_LEGACY_TICK");
    const state = perfectState(beatmap);

    const schedule = buildHitSoundSchedule(beatmap, state);
    const tail = schedule[schedule.length - 1];

    expect(lastTick?.hitTime).toBeLessThan(slider.endTime);
    expect(tail.timeInMs).toBe(slider.endTime);
    expect(tail.samples.map((s) => s.lookupNames[0])).toEqual(["normal-hitnormal", "normal-hitclap"]);
  });

  it("skips the checkpoints that were dropped mid-slider", () => {
    const beatmap = build(["100,100,1000,2,0,L|200:100,3,22.5,0|0|0|0,0:0|0:0|0:0|0:0,0:0:0:0:"]);
    const slider = beatmap.hitObjects[0] as Slider;
    const repeats = slider.checkPoints.filter((c) => c.type === "REPEAT");
    const state = perfectState(beatmap);
    state.checkPointVerdict[repeats[0].id] = { hit: false };

    const times = buildHitSoundSchedule(beatmap, state).map((e) => e.timeInMs);

    expect(times).not.toContain(repeats[0].hitTime);
    expect(times).toContain(repeats[1].hitTime);
  });

  it("returns the schedule ordered by time", () => {
    const beatmap = build([
      "100,100,3000,1,0,0:0:0:0:",
      "100,100,1000,2,0,L|200:100,3,22.5,0|0|0|0,0:0|0:0|0:0|0:0,0:0:0:0:",
      "100,100,2000,1,0,0:0:0:0:",
    ]);
    const times = buildHitSoundSchedule(beatmap, perfectState(beatmap)).map((e) => e.timeInMs);

    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("collects each distinct sample only once", () => {
    const beatmap = build(["100,100,1000,1,0,0:0:0:0:", "100,100,2000,1,0,0:0:0:0:", "100,100,3000,1,2,0:0:0:0:"]);
    const schedule = buildHitSoundSchedule(beatmap, perfectState(beatmap));

    expect(
      distinctSamples(schedule)
        .map((s) => s.lookupNames[0])
        .sort(),
    ).toEqual(["normal-hitnormal", "normal-hitwhistle"]);
  });
});
