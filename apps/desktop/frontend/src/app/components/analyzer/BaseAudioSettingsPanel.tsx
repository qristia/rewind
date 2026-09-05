import { Box, FormControlLabel, Slider, Stack, Switch, Tooltip, Typography } from "@mui/material";
import { VolumeDown, VolumeUp } from "@mui/icons-material";

type Change = (x: number) => void;

/** How far the hit sounds can be shifted against the music, in milliseconds. */
const MAX_HIT_SOUND_OFFSET_MS = 100;

interface BaseAudioSettingsPanelProps {
  master: number;
  effects: number;
  music: number;

  beatmapHitSounds: boolean;
  hitSoundOffsetInMs: number;

  onMasterChange: Change;
  onEffectsChange: Change;
  onMusicChange: Change;
  onMutedChange: (muted: boolean) => unknown;
  onBeatmapHitSoundsChange: (enabled: boolean) => unknown;
  onHitSoundOffsetChange: Change;
}

export function VolumeSlider({ disabled, onChange, value }: { disabled?: boolean; onChange: Change; value: number }) {
  return (
    <Stack gap={2} direction={"row"}>
      <VolumeDown />
      <Slider
        size="small"
        valueLabelDisplay="auto"
        disabled={disabled}
        value={Math.floor(value * 100)}
        step={1}
        onChange={(_, x) => onChange((x as number) / 100)}
      />
      <VolumeUp />
    </Stack>
  );
}

export function BaseAudioSettingsPanel(props: BaseAudioSettingsPanelProps) {
  const {
    master,
    effects,
    music,
    beatmapHitSounds,
    hitSoundOffsetInMs,
    onMasterChange,
    onEffectsChange,
    onMusicChange,
    onBeatmapHitSoundsChange,
    onHitSoundOffsetChange,
  } = props;
  return (
    <Stack
      sx={{
        p: 2,
      }}
      gap={1}
    >
      <Box>
        <Typography id="input-slider" gutterBottom>
          Master Volume
        </Typography>
        <VolumeSlider onChange={onMasterChange} value={master} />
      </Box>

      <Box>
        <Typography id="input-slider" gutterBottom>
          Music Volume
        </Typography>
        <VolumeSlider onChange={onMusicChange} value={music} />
      </Box>
      <Box>
        <Typography id="input-slider" gutterBottom>
          Effects Volume
        </Typography>
        <VolumeSlider onChange={onEffectsChange} value={effects} />
      </Box>
      <Box>
        <Tooltip title={"Use the hit sounds that come with the beatmap instead of the ones from your skin"}>
          <FormControlLabel
            control={
              <Switch
                size={"small"}
                checked={beatmapHitSounds}
                onChange={(event) => onBeatmapHitSoundsChange(event.target.checked)}
              />
            }
            label={<Typography variant={"body2"}>Beatmap hit sounds</Typography>}
          />
        </Tooltip>
      </Box>
      <Box>
        <Tooltip title={"Shifts the hit sounds against the music. Increase it if they sound early."}>
          <Typography gutterBottom>Hit sound offset: {hitSoundOffsetInMs}ms</Typography>
        </Tooltip>
        <Slider
          size="small"
          valueLabelDisplay="auto"
          value={hitSoundOffsetInMs}
          min={-MAX_HIT_SOUND_OFFSET_MS}
          max={MAX_HIT_SOUND_OFFSET_MS}
          step={1}
          marks={[{ value: 0 }]}
          onChange={(_, x) => onHitSoundOffsetChange(x as number)}
        />
      </Box>
    </Stack>
  );
}
