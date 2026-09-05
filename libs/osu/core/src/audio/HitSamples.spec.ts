import { parseBlueprint } from "../blueprint/BlueprintParser";
import { buildBeatmap } from "../beatmap/BeatmapBuilder";
import { HitSampleInfo } from "./HitSampleInfo";
import { Slider } from "../hitobjects/Slider";
import { HitCircle } from "../hitobjects/HitCircle";

/**
 * Builds a beatmap out of the given timing points and hit objects. The slider settings are fixed so that the slider
 * timings used in the expectations below stay predictable.
 */
function build(timingPoints: string[], hitObjects: string[]) {
  const data = `osu file format v14
[General]
AudioFilename: audio.mp3
SampleSet: Normal
StackLeniency: 0.7
Mode: 0

[Difficulty]
HPDrainRate:5
CircleSize:4
OverallDifficulty:9
ApproachRate:9
SliderMultiplier:1.8
SliderTickRate:1

[TimingPoints]
${timingPoints.join("\n")}

[HitObjects]
${hitObjects.join("\n")}
`;
  return buildBeatmap(parseBlueprint(data), { addStacking: false, mods: [] });
}

/** Reduces a sample list to `<lookup name>@<volume>` so that the expectations stay readable. */
function describeSamples(samples: HitSampleInfo[]): string[] {
  return samples.map((s) => `${s.lookupNames[0]}@${s.volume}`);
}

describe("hit sample resolution", () => {
  describe("hit circles", () => {
    it("takes bank, index and volume from the timing point when the object does not specify them", () => {
      // sampleSet = soft (2), sampleIndex = 1, volume = 80
      const beatmap = build(["0,400,4,2,1,80,1,0"], ["100,100,1000,1,0,0:0:0:0:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(describeSamples(circle.samples)).toEqual(["soft-hitnormal@80"]);
    });

    it("keeps the banks the object specifies, using the addition bank for the additions", () => {
      // normalSet = drum (3), additionSet = soft (2); hit sound 6 = whistle | finish
      const beatmap = build(["0,400,4,1,0,100,1,0"], ["100,100,1000,1,6,3:2:0:0:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(describeSamples(circle.samples)).toEqual([
        "drum-hitnormal@100",
        "soft-hitfinish@100",
        "soft-hitwhistle@100",
      ]);
    });

    it("layers the normal sample underneath an addition even when the Normal flag is not set", () => {
      // Hit sound 2 = whistle only, yet the hitnormal is still played below it.
      const beatmap = build(["0,400,4,1,0,100,1,0"], ["100,100,1000,1,2,0:0:0:0:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(describeSamples(circle.samples)).toEqual(["normal-hitnormal@100", "normal-hitwhistle@100"]);
    });

    it("only suffixes the file name for custom sample indices of 2 and above", () => {
      const beatmap = build(
        ["0,400,4,1,0,100,1,0"],
        ["100,100,1000,1,0,0:0:1:0:", "100,100,2000,1,0,0:0:2:0:", "100,100,3000,1,0,0:0:7:0:"],
      );
      const [a, b, c] = beatmap.hitObjects as HitCircle[];

      expect(a.samples[0].lookupNames).toEqual(["normal-hitnormal", "hitnormal"]);
      expect(b.samples[0].lookupNames).toEqual(["normal-hitnormal2", "normal-hitnormal", "hitnormal"]);
      expect(c.samples[0].lookupNames).toEqual(["normal-hitnormal7", "normal-hitnormal", "hitnormal"]);
    });

    it("inherits the custom index of the timing point when the object leaves it at 0", () => {
      const beatmap = build(["0,400,4,1,3,100,1,0"], ["100,100,1000,1,0,0:0:0:0:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(circle.samples[0].lookupNames[0]).toBe("normal-hitnormal3");
    });

    it("prefers the object's own volume over the timing point's", () => {
      const beatmap = build(["0,400,4,1,0,80,1,0"], ["100,100,1000,1,0,0:0:0:35:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(circle.samples[0].volume).toBe(35);
    });

    it("uses a custom file name and keeps the bank sample as a fallback", () => {
      const beatmap = build(["0,400,4,1,0,80,1,0"], ["100,100,1000,1,0,0:0:0:0:clap.wav"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(circle.samples[0].lookupNames).toEqual(["clap.wav", "clap", "normal-hitnormal", "hitnormal"]);
      expect(circle.samples[0].volume).toBe(80);
    });

    it("picks up a timing point that starts exactly on the object", () => {
      // Without the 5 ms lookup leniency the object would still resolve against the first timing point.
      const beatmap = build(["0,400,4,1,0,100,1,0", "1000,400,4,3,0,100,0,0"], ["100,100,1000,1,0,0:0:0:0:"]);
      const circle = beatmap.hitObjects[0] as HitCircle;

      expect(circle.samples[0].lookupNames[0]).toBe("drum-hitnormal");
    });
  });

  describe("sliders", () => {
    // 3 slides over 22.5 px with a 1.8 multiplier and a 400 ms beat length give one 50 ms span per slide.
    // edgeSounds "0|2|4|8": nothing, whistle, finish, clap. edgeSets switches the tail to the drum bank.
    const sliderLine = "100,100,1000,2,0,L|200:100,3,22.5,0|2|4|8,0:0|0:0|0:0|3:3,0:0:0:0:";

    it("gives the head, the repeats and the tail the sounds of their own node", () => {
      const beatmap = build(["0,400,4,2,0,100,1,0"], [sliderLine]);
      const slider = beatmap.hitObjects[0] as Slider;
      const repeats = slider.checkPoints.filter((c) => c.type === "REPEAT");

      expect(describeSamples(slider.head.samples)).toEqual(["soft-hitnormal@100"]);
      expect(repeats).toHaveLength(2);
      expect(describeSamples(repeats[0].samples)).toEqual(["soft-hitnormal@100", "soft-hitwhistle@100"]);
      expect(describeSamples(repeats[1].samples)).toEqual(["soft-hitnormal@100", "soft-hitfinish@100"]);
      expect(describeSamples(slider.tailSamples)).toEqual(["drum-hitnormal@100", "drum-hitclap@100"]);
    });

    it("leaves the scoring last tick silent, since the tail sound belongs to the slider end", () => {
      const beatmap = build(["0,400,4,2,0,100,1,0"], [sliderLine]);
      const slider = beatmap.hitObjects[0] as Slider;
      const lastTick = slider.checkPoints.find((c) => c.type === "LAST_LEGACY_TICK");

      expect(lastTick).toBeDefined();
      expect(lastTick?.samples).toEqual([]);
    });

    it("derives the tick sound from the slider's own normal sample", () => {
      // A long slider so that ticks are generated. The slider's own sample field selects the drum bank.
      const beatmap = build(["0,400,4,2,0,100,1,0"], ["100,100,1000,2,0,L|600:100,1,500,0|0,0:0|0:0,3:0:0:0:"]);
      const slider = beatmap.hitObjects[0] as Slider;
      const ticks = slider.checkPoints.filter((c) => c.type === "TICK");

      expect(ticks.length).toBeGreaterThan(0);
      for (const tick of ticks) {
        expect(describeSamples(tick.samples)).toEqual(["drum-slidertick@100"]);
      }
    });

    it("resolves each node against the timing point active at that node", () => {
      // The slider starts at 1000 ms and spans 50 ms per slide, so its four nodes sit at 1000, 1050, 1100 and 1150 ms.
      // A timing point at 1100 ms switching the bank to drum must therefore only affect the second repeat and the tail.
      const beatmap = build(
        ["0,400,4,2,0,100,1,0", "1100,400,4,3,0,100,0,0"],
        ["100,100,1000,2,0,L|200:100,3,22.5,0|0|0|0,0:0|0:0|0:0|0:0,0:0:0:0:"],
      );
      const slider = beatmap.hitObjects[0] as Slider;
      const repeats = slider.checkPoints.filter((c) => c.type === "REPEAT");

      expect(describeSamples(slider.head.samples)).toEqual(["soft-hitnormal@100"]);
      expect(describeSamples(repeats[0].samples)).toEqual(["soft-hitnormal@100"]);
      expect(describeSamples(repeats[1].samples)).toEqual(["drum-hitnormal@100"]);
      expect(describeSamples(slider.tailSamples)).toEqual(["drum-hitnormal@100"]);
    });

    it("falls back to the object's hit sound for nodes that edgeSounds does not cover", () => {
      const beatmap = build(["0,400,4,1,0,100,1,0"], ["100,100,1000,2,8,L|200:100,3,22.5"]);
      const slider = beatmap.hitObjects[0] as Slider;

      expect(describeSamples(slider.head.samples)).toEqual(["normal-hitnormal@100", "normal-hitclap@100"]);
      expect(describeSamples(slider.tailSamples)).toEqual(["normal-hitnormal@100", "normal-hitclap@100"]);
    });
  });

  it("keys samples by their lookup names so that identical samples share one decoded buffer", () => {
    const beatmap = build(["0,400,4,1,0,100,1,0"], ["100,100,1000,1,0,0:0:0:0:", "100,100,2000,1,0,0:0:0:50:"]);
    const [a, b] = beatmap.hitObjects as HitCircle[];

    // Same file, different volume: volume is applied at play time and must not split the cache entry.
    expect(a.samples[0].key).toBe(b.samples[0].key);
  });
});
