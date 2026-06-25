import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import {
  buildMantaFrame,
  mantaStateLabel,
  type MantaCell,
  type MantaState,
  type MantaTone,
} from './manta-frames.js';

export interface KodaXMantaProps {
  state?: MantaState;
  compact?: boolean;
  charset?: 'ascii' | 'unicode';
  animate?: boolean;
  intervalMs?: number;
  showLabel?: boolean;
}

const COLOR: Record<MantaTone, string | undefined> = {
  dim: 'gray',
  body: 'cyan',
  core: 'white',
  accent: 'blueBright',
  success: 'greenBright',
  warning: 'yellowBright',
  error: 'redBright',
};

function runs(row: MantaCell[]): Array<{text: string; tone: MantaTone}> {
  const output: Array<{text: string; tone: MantaTone}> = [];
  for (const cell of row) {
    const last = output.at(-1);
    if (last?.tone === cell.tone) last.text += cell.ch;
    else output.push({text: cell.ch, tone: cell.tone});
  }
  return output;
}

export function KodaXManta({
  state = 'idle',
  compact = false,
  charset = 'ascii',
  animate = true,
  intervalMs = 110,
  showLabel = false,
}: KodaXMantaProps): React.ReactElement {
  const [tick, setTick] = useState(0);
  const reducedMotion = process.env.KODAX_REDUCED_MOTION === '1';

  useEffect(() => {
    if (!animate || reducedMotion) return;
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [animate, intervalMs, reducedMotion]);

  const frame = useMemo(
    () => buildMantaFrame({state, tick, compact, charset}),
    [state, tick, compact, charset],
  );

  return (
    <Box flexDirection="column">
      {frame.map((row, y) => (
        <Text key={y}>
          {runs(row).map((run, index) => (
            <Text
              key={`${y}-${index}`}
              color={COLOR[run.tone]}
              dimColor={run.tone === 'dim'}
              bold={run.tone === 'core'}
            >
              {run.text.replace(/\s+$/u, '')}
            </Text>
          ))}
        </Text>
      ))}
      {showLabel ? <Text dimColor>KodaX · {mantaStateLabel(state)}</Text> : null}
    </Box>
  );
}
