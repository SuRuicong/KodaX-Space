#!/usr/bin/env node
import { buildMantaFrame, frameToText, MANTA_STATES, mantaStateLabel } from './manta-frames.mjs';

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const value = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

if (has('--help') || has('-h')) {
  console.log(`KodaX Manta Pulse TUI demo\n\n` +
`Usage: node manta-ansi-demo.mjs [options]\n\n` +
`  --state <name|cycle>  idle, loading, active, thinking, tool, agents, success, warning, error\n` +
`  --ascii              use ASCII-only characters (default)\n` +
`  --unicode            use box-drawing characters\n` +
`  --compact            render the 5-line compact mark\n` +
`  --fps <n>            animation frames per second (default 10)\n` +
`  --cycle-ms <n>       state duration in cycle mode (default 2200)\n` +
`  --once               print one frame and exit\n` +
`  --no-color           disable ANSI colors\n` +
`  --label              print state label below the mark\n` +
`  --list               list available states\n`);
  process.exit(0);
}
if (has('--list')) { console.log(MANTA_STATES.join('\n')); process.exit(0); }

const requestedState = value('--state', 'cycle');
if (requestedState !== 'cycle' && !MANTA_STATES.includes(requestedState)) {
  console.error(`Unknown state: ${requestedState}`);
  process.exit(1);
}
const fps = Math.max(1, Math.min(30, Number(value('--fps', '10')) || 10));
const cycleMs = Math.max(500, Number(value('--cycle-ms', '2200')) || 2200);
const compact = has('--compact');
const charset = has('--unicode') ? 'unicode' : 'ascii';
const noColor = has('--no-color') || Boolean(process.env.NO_COLOR);
const showLabel = has('--label');
const once = has('--once') || !process.stdout.isTTY;

function colorMode() {
  if (noColor) return 'none';
  const colorterm = (process.env.COLORTERM ?? '').toLowerCase();
  const term = (process.env.TERM ?? '').toLowerCase();
  if (colorterm.includes('truecolor') || colorterm.includes('24bit')) return 'truecolor';
  if (term.includes('256color')) return '256';
  return '16';
}
const mode = colorMode();
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const toneRgb = {
  dim: [76, 99, 118], body: [0, 236, 255], core: [214, 255, 250], accent: [10, 124, 255],
  success: [47, 229, 141], warning: [255, 176, 32], error: [255, 77, 90],
};
const tone256 = { dim: 66, body: 51, core: 159, accent: 39, success: 48, warning: 214, error: 203 };
const tone16 = { dim: 36, body: 96, core: 97, accent: 94, success: 92, warning: 93, error: 91 };
function ansi(tone) {
  if (mode === 'none') return '';
  const intensity = tone === 'dim' ? DIM : '\x1b[22m';
  if (mode === 'truecolor') { const [r,g,b] = toneRgb[tone]; return `${RESET}${intensity}\x1b[38;2;${r};${g};${b}m`; }
  if (mode === '256') return `${RESET}${intensity}\x1b[38;5;${tone256[tone]}m`;
  return `${RESET}${intensity}\x1b[${tone16[tone]}m`;
}
function renderRow(row) {
  if (mode === 'none') return row.map((cell) => cell.ch).join('').replace(/\s+$/u, '');
  let out = '';
  let last = null;
  for (const cell of row) {
    if (cell.tone !== last) { out += ansi(cell.tone); last = cell.tone; }
    out += cell.ch;
  }
  return out.replace(/\s+$/u, '') + RESET;
}
function frameState(tick) {
  if (requestedState !== 'cycle') return requestedState;
  const index = Math.floor((tick * 1000 / fps) / cycleMs) % MANTA_STATES.length;
  return MANTA_STATES[index];
}
function render(tick) {
  const state = frameState(tick);
  const frame = buildMantaFrame({ state, tick, compact, charset });
  const lines = frame.map(renderRow);
  if (showLabel) lines.push(`${mode === 'none' ? '' : ansi('dim')}KodaX · ${mantaStateLabel(state)}${mode === 'none' ? '' : RESET}`);
  return { state, lines };
}

if (once) {
  const { lines } = render(0);
  console.log(lines.join('\n'));
  process.exit(0);
}

let tick = 0;
let lineCount = 0;
let first = true;
process.stdout.write('\x1b[?25l');
const draw = () => {
  const { lines } = render(tick++);
  const output = lines.join('\n') + '\n';
  if (!first) process.stdout.write(`\x1b[${lineCount}F`);
  process.stdout.write('\x1b[J' + output);
  lineCount = lines.length;
  first = false;
};
const timer = setInterval(draw, Math.round(1000 / fps));
draw();
function cleanup(code = 0) {
  clearInterval(timer);
  process.stdout.write(RESET + '\x1b[?25h');
  process.exit(code);
}
process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));
process.on('exit', () => process.stdout.write(RESET + '\x1b[?25h'));
