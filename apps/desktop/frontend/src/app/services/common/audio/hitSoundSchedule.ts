import { Beatmap, GameState, HitCircle, HitSampleInfo, isHitCircle, isSlider, isSpinner } from "@osujs/core";
import { HitSoundEvent } from "./HitSoundPlayer";

/**
 * Turns a fully simulated replay into the list of hit sounds it produces.
 *
 * Only what the player actually hit makes a sound: misses stay silent, and so do the ticks and repeats that were
 * dropped mid-slider, exactly as when the replay was played.
 */
export function buildHitSoundSchedule(beatmap: Beatmap, state: GameState): HitSoundEvent[] {
  const schedule: HitSoundEvent[] = [];

  const push = (timeInMs: number, samples: HitSampleInfo[]) => {
    if (samples.length > 0) schedule.push({ timeInMs, samples });
  };

  // Hit circles and slider heads share the same verdict map.
  const pushCircle = (circle: HitCircle) => {
    const verdict = state.hitCircleVerdict[circle.id];
    if (!verdict || verdict.type === "MISS") return;
    // The sound belongs to the moment the player pressed, not to the moment the note was supposed to be hit --
    // hearing the hit error is precisely what makes it useful in an analyzer.
    push(verdict.judgementTime, circle.samples);
  };

  for (const hitObject of beatmap.hitObjects) {
    if (isHitCircle(hitObject)) {
      pushCircle(hitObject);
    } else if (isSlider(hitObject)) {
      pushCircle(hitObject.head);

      for (const checkPoint of hitObject.checkPoints) {
        if (!state.checkPointVerdict[checkPoint.id]?.hit) continue;

        if (checkPoint.type === "LAST_LEGACY_TICK") {
          // Holding the slider until its last tick is what completes it, but osu! plays the tail sound at the visual
          // end of the slider, which sits `legacyLastTickOffset` later than that tick.
          push(hitObject.endTime, hitObject.tailSamples);
        } else {
          push(checkPoint.hitTime, checkPoint.samples);
        }
      }
    } else if (isSpinner(hitObject)) {
      // Rewind does not judge spinners yet, so this plays unconditionally at the spinner's end, which is where osu!
      // plays it for every spinner that was completed.
      push(hitObject.endTime, hitObject.samples);
    }
  }

  schedule.sort((a, b) => a.timeInMs - b.timeInMs);
  return schedule;
}

/**
 * The distinct samples a schedule refers to, so that each underlying file is only located and decoded once.
 */
export function distinctSamples(schedule: HitSoundEvent[]): HitSampleInfo[] {
  const byKey = new Map<string, HitSampleInfo>();
  for (const event of schedule) {
    for (const sample of event.samples) {
      if (!byKey.has(sample.key)) byKey.set(sample.key, sample);
    }
  }
  return [...byKey.values()];
}
