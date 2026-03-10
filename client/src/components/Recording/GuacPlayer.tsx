import { useEffect, useRef, useState, useCallback } from 'react';
import * as Guacamole from '@glokon/guacamole-common-js';
import { Box, IconButton, Slider, Typography, Stack, Select, MenuItem } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import { getRecordingStreamUrl } from '../../api/recordings.api';
import { useAuthStore } from '../../store/authStore';

interface GuacPlayerProps {
  recordingId: string;
  onError?: (message: string) => void;
}

export default function GuacPlayer({ recordingId, onError }: GuacPlayerProps) {
  const displayRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef<Guacamole.SessionRecording | null>(null);
  const displayInstanceRef = useRef<Guacamole.Display | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const url = getRecordingStreamUrl(recordingId);
    const token = useAuthStore.getState().accessToken;

    const tunnel = new Guacamole.StaticHTTPTunnel(url, false, {
      'Authorization': `Bearer ${token}`,
    });
    const recording = new Guacamole.SessionRecording(tunnel);
    const display = recording.getDisplay();

    recordingRef.current = recording;
    displayInstanceRef.current = display;

    if (displayRef.current) {
      displayRef.current.innerHTML = '';
      displayRef.current.appendChild(display.getElement());
    }

    const scaleToFit = () => {
      if (!displayRef.current) return;
      const containerWidth = displayRef.current.clientWidth;
      const containerHeight = displayRef.current.clientHeight;
      const displayWidth = display.getWidth();
      const displayHeight = display.getHeight();
      if (displayWidth > 0 && displayHeight > 0) {
        const scale = Math.min(containerWidth / displayWidth, containerHeight / displayHeight, 1);
        display.scale(scale);
      }
    };

    // Important: Scale display whenever Guacamole reports a new resolution
    // This fixes the black screen issue by recalculating the scale when the video actually has dimensions
    (display as unknown as { onresize: (() => void) | null }).onresize = scaleToFit;

    recording.onload = () => {
      setDuration(recording.getDuration() / 1000);
      setLoaded(true);
      scaleToFit();
      // Deferred scale — display dimensions may be 0 at onload time
      requestAnimationFrame(scaleToFit);
    };

    recording.onplay = () => setPlaying(true);
    recording.onpause = () => setPlaying(false);
    recording.onseek = (pos) => setCurrentTime(pos / 1000);

    recording.onerror = (message: string) => {
      onError?.(message || 'Failed to load recording');
    };

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(scaleToFit);
    });
    if (displayRef.current) {
      ro.observe(displayRef.current);
    }

    recording.connect();

    return () => {
      ro.disconnect();
      recording.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId]);

  const play = useCallback(() => {
    recordingRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    recordingRef.current?.pause();
  }, []);

  const seekTo = useCallback((_: Event | React.SyntheticEvent, value: number | number[]) => {
    const targetMs = (value as number) * 1000;
    recordingRef.current?.seek(targetMs);
  }, []);

  const restart = useCallback(() => {
    recordingRef.current?.seek(0, () => {
      recordingRef.current?.pause();
      setCurrentTime(0);
    });
  }, []);

  // Speed control: at non-1x speeds, drive playback via periodic seek
  // (guacamole-common-js 1.6.0 removed the playbackSpeed property)
  useEffect(() => {
    if (!playing || speed === 1 || !recordingRef.current) return;
    const recording = recordingRef.current;
    const stepMs = 100;
    const interval = setInterval(() => {
      const pos = recording.getPosition();
      const dur = recording.getDuration();
      const advance = pos + stepMs * speed;
      if (advance < dur) {
        recording.seek(advance);
      } else {
        recording.seek(dur);
      }
    }, stepMs);
    return () => clearInterval(interval);
  }, [playing, speed]);

  // Periodic time update during playback
  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      if (recordingRef.current) {
        setCurrentTime(recordingRef.current.getPosition() / 1000);
      }
    }, 250);
    return () => clearInterval(interval);
  }, [playing]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box
        ref={displayRef}
        sx={{
          flex: 1,
          bgcolor: '#000',
          borderRadius: 1,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      />
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, px: 1 }}>
        {playing ? (
          <IconButton size="small" onClick={pause}><PauseIcon /></IconButton>
        ) : (
          <IconButton size="small" onClick={play} disabled={!loaded}><PlayArrowIcon /></IconButton>
        )}
        <IconButton size="small" onClick={restart} disabled={!loaded}><ReplayIcon /></IconButton>
        <Typography variant="caption" sx={{ minWidth: 40 }}>{formatTime(currentTime)}</Typography>
        <Slider
          size="small"
          value={currentTime}
          max={duration || 1}
          onChange={seekTo}
          sx={{ flex: 1 }}
        />
        <Typography variant="caption" sx={{ minWidth: 40 }}>{formatTime(duration)}</Typography>
        <Select
          size="small"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          sx={{ minWidth: 70, '& .MuiSelect-select': { py: 0.5, fontSize: '0.75rem' } }}
        >
          <MenuItem value={0.5}>0.5x</MenuItem>
          <MenuItem value={1}>1x</MenuItem>
          <MenuItem value={2}>2x</MenuItem>
          <MenuItem value={4}>4x</MenuItem>
          <MenuItem value={8}>8x</MenuItem>
        </Select>
      </Stack>
    </Box>
  );
}
