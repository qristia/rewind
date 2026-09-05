import { ControlPoint } from "./ControlPoint";
import { FileHitSampleInfo, HitSampleInfo, LegacyHitSampleInfo } from "../../audio/HitSampleInfo";

export class SampleControlPoint extends ControlPoint {
  static TYPE = "SampleControlPoint";
  static DEFAULT_BANK = HitSampleInfo.BANK_NORMAL;
  static DEFAULT = new SampleControlPoint();

  sampleBank = SampleControlPoint.DEFAULT_BANK;
  sampleVolume = 100;
  /**
   * The custom sample index of this timing point ("custom sample bank" in the editor). Hit objects that do not carry
   * an index of their own inherit this one.
   */
  sampleIndex = 0;

  isRedundant(existing: ControlPoint): boolean {
    if (existing.type !== SampleControlPoint.TYPE) return false;
    const e = existing as SampleControlPoint;
    return (
      this.sampleBank === e.sampleBank && this.sampleVolume === e.sampleVolume && this.sampleIndex === e.sampleIndex
    );
  }

  get type(): string {
    return SampleControlPoint.TYPE;
  }

  /**
   * Resolves a sample as it was written in the `.osu` file against this control point: every field the hit object left
   * unset (bank, custom index, volume) falls back to the value of the timing point active at its time.
   *
   * Port of `LegacySampleControlPoint.ApplyTo`.
   */
  applyTo(sample: LegacyHitSampleInfo): HitSampleInfo {
    const volume = sample.volume > 0 ? sample.volume : this.sampleVolume;
    if (sample.filename) return new FileHitSampleInfo(sample.filename, volume);

    const bank = sample.bank ?? this.sampleBank;
    const index = sample.customSampleBank > 0 ? sample.customSampleBank : this.sampleIndex;
    // Indices of 0 and 1 both mean "the plain, unsuffixed file"; only 2 and above get a suffix.
    return new HitSampleInfo(sample.name, bank, index >= 2 ? index.toString() : null, volume);
  }
}
