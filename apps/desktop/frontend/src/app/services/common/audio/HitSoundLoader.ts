import { inject, injectable } from "inversify";
import { readFile } from "fs/promises";
import { join } from "path";
import { HitSampleInfo } from "@osujs/core";
import { STAGE_TYPES } from "../../types";
import { SkinLoader } from "../local/SkinLoader";
import { SkinSettingsStore } from "../skin";
import { stringToSkinId } from "../../../model/SkinId";

/** Tried in this order for every lookup name, matching what osu! accepts for skin samples. */
const AUDIO_EXTENSIONS = [".wav", ".ogg", ".mp3"];

/** The skin shipped with Rewind that holds osu!'s stock hit sounds; the last resort of every lookup. */
const FALLBACK_SKIN_FOLDER = "OsuDefaultSkin";

/**
 * `lookupNames` are extension-less, except for the custom file name of a hit object which already carries one.
 */
function candidateFileNames(lookupName: string): string[] {
  const withExtensions = AUDIO_EXTENSIONS.map((extension) => lookupName + extension);
  const alreadyHasExtension = AUDIO_EXTENSIONS.some((extension) => lookupName.toLowerCase().endsWith(extension));
  return alreadyHasExtension ? [lookupName, ...withExtensions] : withExtensions;
}

/**
 * Locates and decodes the sample files a schedule needs.
 *
 * Sources are consulted in osu!'s order: the beatmap's own folder wins over the selected skin, which in turn wins
 * over Rewind's bundled default skin. Within a source the sample's own preference order applies, so an indexed file
 * such as `normal-hitnormal2` is preferred over the plain `normal-hitnormal` of the same source.
 */
@injectable()
export class HitSoundLoader {
  constructor(
    @inject(STAGE_TYPES.AUDIO_CONTEXT) private readonly audioContext: AudioContext,
    @inject(STAGE_TYPES.REWIND_SKINS_FOLDER) private readonly rewindSkinsFolder: string,
    private readonly skinLoader: SkinLoader,
    private readonly skinSettingsStore: SkinSettingsStore,
  ) {}

  private skinFolders(): string[] {
    const folders: string[] = [];

    try {
      const { preferredSkinId } = this.skinSettingsStore.settings;
      folders.push(this.skinLoader.resolveToPath(stringToSkinId(preferredSkinId)));
    } catch (error) {
      console.error("Could not resolve the preferred skin folder for hit sounds", error);
    }

    folders.push(join(this.rewindSkinsFolder, FALLBACK_SKIN_FOLDER));
    return folders;
  }

  /**
   * Decodes every given sample into a buffer, keyed by `HitSampleInfo.key`. Samples whose file cannot be found or
   * decoded are simply left out; playback then skips them instead of failing the whole replay.
   */
  async load(
    samples: HitSampleInfo[],
    { beatmapFolder, useBeatmapHitSounds }: { beatmapFolder: string; useBeatmapHitSounds: boolean },
  ): Promise<Map<string, AudioBuffer>> {
    const folders = useBeatmapHitSounds ? [beatmapFolder, ...this.skinFolders()] : this.skinFolders();
    const buffers = new Map<string, AudioBuffer>();

    await Promise.all(
      samples.map(async (sample) => {
        const buffer = await this.loadSample(sample, folders);
        if (buffer) buffers.set(sample.key, buffer);
      }),
    );

    console.log(`Loaded ${buffers.size} of ${samples.length} hit sound samples`);
    return buffers;
  }

  private async loadSample(sample: HitSampleInfo, folders: string[]): Promise<AudioBuffer | undefined> {
    for (const folder of folders) {
      for (const lookupName of sample.lookupNames) {
        for (const fileName of candidateFileNames(lookupName)) {
          const buffer = await this.decodeFile(join(folder, fileName));
          if (buffer) return buffer;
        }
      }
    }
    return undefined;
  }

  private async decodeFile(path: string): Promise<AudioBuffer | undefined> {
    let contents: Buffer;
    try {
      contents = await readFile(path);
    } catch {
      // Not in this folder under this name; the caller moves on to the next candidate.
      return undefined;
    }

    // `readFile` hands out a view into a pooled ArrayBuffer and `decodeAudioData` detaches whatever it is given, so
    // the sample's own bytes have to be copied out first.
    const arrayBuffer = contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);

    try {
      return await this.audioContext.decodeAudioData(arrayBuffer as ArrayBuffer);
    } catch (error) {
      // osu! skins are full of zero-length placeholder files that are meant to silence a sample.
      if (contents.byteLength > 0) console.warn(`Could not decode hit sound sample '${path}'`, error);
      return undefined;
    }
  }
}
