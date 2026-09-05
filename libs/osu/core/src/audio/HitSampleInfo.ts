/**
 * A gameplay hit sample that has been fully resolved, i.e. its bank, custom index and volume are already known and no
 * longer depend on the sample control point that was active at the hit object's time.
 *
 * Port of https://github.com/ppy/osu/blob/master/osu.Game/Audio/HitSampleInfo.cs
 */
export class HitSampleInfo {
  static readonly HIT_NORMAL = "hitnormal";
  static readonly HIT_WHISTLE = "hitwhistle";
  static readonly HIT_FINISH = "hitfinish";
  static readonly HIT_CLAP = "hitclap";
  static readonly SLIDER_TICK = "slidertick";

  static readonly BANK_NORMAL = "normal";
  static readonly BANK_SOFT = "soft";
  static readonly BANK_DRUM = "drum";

  static readonly ALL_ADDITIONS: readonly string[] = [
    HitSampleInfo.HIT_WHISTLE,
    HitSampleInfo.HIT_FINISH,
    HitSampleInfo.HIT_CLAP,
  ];

  constructor(
    readonly name: string,
    readonly bank: string = HitSampleInfo.BANK_NORMAL,
    readonly suffix: string | null = null,
    readonly volume: number = 100,
  ) {}

  /**
   * The file names (without extension) that may act as a source for this sample, highest priority first.
   *
   * The suffixed name is only tried for custom sample indices of 2 and above, which is why the index-less name is
   * always kept as a fallback.
   */
  get lookupNames(): string[] {
    const names: string[] = [];
    if (this.suffix) names.push(`${this.bank}-${this.name}${this.suffix}`);
    names.push(`${this.bank}-${this.name}`);
    names.push(this.name);
    return names;
  }

  /**
   * Identifies the sample independently of the hit object it belongs to, so that one decoded buffer can be shared by
   * every hit object that resolves to the same file. Volume is deliberately left out: it is applied at play time.
   */
  get key(): string {
    return this.lookupNames.join("|");
  }

  withName(name: string): HitSampleInfo {
    return new HitSampleInfo(name, this.bank, this.suffix, this.volume);
  }
}

/** Drops a trailing `.wav` / `.ogg` / ... so that a custom file name can also be matched without its extension. */
function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/**
 * A sample that a hit object overrides with a file of its own (the last field of `normalSet:additionSet:index:volume:
 * filename`). The banked names are kept as a fallback for when the beatmap folder does not actually contain the file.
 */
export class FileHitSampleInfo extends HitSampleInfo {
  constructor(readonly filename: string, volume: number) {
    super(HitSampleInfo.HIT_NORMAL, HitSampleInfo.BANK_NORMAL, null, volume);
  }

  override get lookupNames(): string[] {
    return [this.filename, stripExtension(this.filename), ...super.lookupNames];
  }

  override get key(): string {
    return `file:${this.filename}`;
  }

  /**
   * A custom file overrides every bank specification, so it also stands in for the slider tick sample derived from it
   * (this mirrors osu!, where `FileHitSampleInfo.With` ignores the new name).
   */
  override withName(): HitSampleInfo {
    return this;
  }
}

/**
 * A hit sample as it was written in the `.osu` file, before the active sample control point has been taken into
 * account. Bank, custom index and volume are all optional there and fall back to the control point's values.
 *
 * Port of `ConvertHitObjectParser.LegacyHitSampleInfo`.
 */
export class LegacyHitSampleInfo {
  constructor(
    readonly name: string,
    /** `null` when the hit object did not specify a bank, in which case the control point's bank is used. */
    readonly bank: string | null = null,
    readonly volume = 0,
    readonly customSampleBank = 0,
    /** An overriding file name which causes all bank/index specifications to be ignored. */
    readonly filename: string | null = null,
  ) {}
}
