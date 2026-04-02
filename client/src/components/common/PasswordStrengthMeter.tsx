import { useState, useEffect, useRef } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { zxcvbnAsync, zxcvbnOptions } from '@zxcvbn-ts/core';

let optionsLoaded = false;
let optionsPromise: Promise<void> | null = null;

async function ensureOptionsLoaded() {
  if (optionsLoaded) return;
  if (!optionsPromise) {
    optionsPromise = Promise.all([
      import('@zxcvbn-ts/language-common'),
      import('@zxcvbn-ts/language-en'),
    ])
      .then(([zxcvbnCommonPackage, zxcvbnEnPackage]) => {
        zxcvbnOptions.setOptions({
          translations: zxcvbnEnPackage.translations,
          graphs: zxcvbnCommonPackage.adjacencyGraphs,
          dictionary: {
            ...zxcvbnCommonPackage.dictionary,
            ...zxcvbnEnPackage.dictionary,
          },
        });
        optionsLoaded = true;
      })
      .finally(() => {
        if (!optionsLoaded) {
          optionsPromise = null;
        }
      });
  }

  await optionsPromise;
}

interface PasswordStrengthMeterProps {
  password: string;
  onScoreChange?: (score: number) => void;
}

const SCORE_CONFIG = [
  { label: 'Very Weak', color: 'error' as const, value: 5 },
  { label: 'Weak', color: 'error' as const, value: 25 },
  { label: 'Fair', color: 'warning' as const, value: 50 },
  { label: 'Strong', color: 'info' as const, value: 75 },
  { label: 'Very Strong', color: 'success' as const, value: 100 },
];

export default function PasswordStrengthMeter({ password, onScoreChange }: PasswordStrengthMeterProps) {
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onScoreChangeRef = useRef(onScoreChange);
  useEffect(() => { onScoreChangeRef.current = onScoreChange; });

  useEffect(() => {
    clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      if (!password) {
        setScore(0);
        setFeedback('');
        onScoreChangeRef.current?.(0);
        return;
      }

      try {
        await ensureOptionsLoaded();
        const result = await zxcvbnAsync(password);
        setScore(result.score);
        const msg = result.feedback.warning || result.feedback.suggestions[0] || '';
        setFeedback(msg);
        onScoreChangeRef.current?.(result.score);
      } catch {
        setScore(0);
        setFeedback('');
        onScoreChangeRef.current?.(0);
      }
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [password]);

  if (!password) return null;

  const config = SCORE_CONFIG[score];

  return (
    <Box sx={{ mt: 0.5, mb: 0.5 }}>
      <LinearProgress
        variant="determinate"
        value={config.value}
        color={config.color}
        sx={{ height: 6, borderRadius: 3 }}
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography variant="caption" color={`${config.color}.main`}>
          {config.label}
        </Typography>
        {feedback && (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right', maxWidth: '70%' }}>
            {feedback}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
