import React, {useEffect, useState} from 'react';
import {Box, render, Text} from 'ink';
import {KodaXManta} from './KodaXManta.js';
import {MANTA_STATES, type MantaState} from './manta-frames.js';

function Demo(): React.ReactElement {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => (value + 1) % MANTA_STATES.length), 2200);
    return () => clearInterval(timer);
  }, []);
  const state = MANTA_STATES[index] as MantaState;
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>KodaX Manta Pulse</Text>
      <KodaXManta state={state} charset="ascii" showLabel />
    </Box>
  );
}

render(<Demo />);
