export type MantaState =
  | 'idle'
  | 'loading'
  | 'active'
  | 'thinking'
  | 'tool'
  | 'agents'
  | 'success'
  | 'warning'
  | 'error';

export type MantaTone =
  | 'dim'
  | 'body'
  | 'core'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error';

export interface MantaCell {
  ch: string;
  tone: MantaTone;
}

export interface MantaFrameOptions {
  state?: MantaState;
  tick?: number;
  charset?: 'ascii' | 'unicode';
  compact?: boolean;
}

export const MANTA_STATES: readonly MantaState[] = [
  'idle', 'loading', 'active', 'thinking', 'tool', 'agents',
  'success', 'warning', 'error',
] as const;

const WIDTH = 41;
const FULL_ASCII = [
  '                    .                    ',
  '             .------+------.             ',
  "       .-----'      |      '-----.       ",
  "<------'            @            '------>",
  "       '-----.      |      .-----'       ",
  "             '------+------'             ",
  '                    |                    ',
  '                    `-.                  ',
  '                      `                  ',
  '                                         ',
  '                                         ',
];

const FULL_UNICODE = [
  '                    ·                    ',
  '             ╭──────┼──────╮             ',
  '       ╭─────╯      │      ╰─────╮       ',
  '<──────╯            @            ╰──────>',
  '       ╰─────╮      │      ╭─────╯       ',
  '             ╰──────┼──────╯             ',
  '                    │                    ',
  '                    ╰╮                   ',
  '                     ╰                   ',
  '                                         ',
  '                                         ',
];

const COMPACT_ASCII = [
  '   .---+---.   ',
  "<--'   @   '-->",
  "   '---+---'   ",
  '       |       ',
  '       `-.     ',
];

const COMPACT_UNICODE = [
  '   ╭───┼───╮   ',
  '<──╯   @   ╰──>',
  '   ╰───┼───╯   ',
  '       │       ',
  '       ╰╮      ',
];

function baseTone(ch: string): MantaTone {
  if (ch === '@') return 'core';
  if (ch === '.' || ch === '·') return 'dim';
  return ch === ' ' ? 'dim' : 'body';
}

function canvasFrom(lines: string[]): MantaCell[][] {
  return lines.map((line) => [...line].map((ch) => ({
    ch: ch === '@' ? '*' : ch,
    tone: baseTone(ch),
  })));
}

function setCell(canvas: MantaCell[][], x: number, y: number, ch: string, tone: MantaTone): void {
  if (!canvas[y] || x < 0 || x >= canvas[y].length) return;
  canvas[y][x] = { ch, tone };
}

function setText(canvas: MantaCell[][], x: number, y: number, text: string, tone: MantaTone): void {
  [...text].forEach((ch, i) => setCell(canvas, x + i, y, ch, tone));
}

function pulseGlyph(tick: number): string {
  return ['.', '+', '*', '+'][Math.floor(tick / 2) % 4] ?? '*';
}

export function buildMantaFrame(options: MantaFrameOptions = {}): MantaCell[][] {
  const state = options.state ?? 'idle';
  const tick = Math.max(0, options.tick ?? 0);
  const compact = options.compact ?? false;
  const unicode = options.charset === 'unicode';
  const lines = compact
    ? (unicode ? COMPACT_UNICODE : COMPACT_ASCII)
    : (unicode ? FULL_UNICODE : FULL_ASCII);
  const canvas = canvasFrom(lines);

  const coreX = compact ? 7 : 20;
  const coreY = compact ? 1 : 3;
  setCell(canvas, coreX, coreY, pulseGlyph(tick), 'core');

  if (state === 'idle') {
    if (!compact && tick % 8 < 4) setCell(canvas, 20, 0, '.', 'accent');
  }

  if (state === 'loading') {
    const phase = tick % 8;
    setCell(canvas, coreX, coreY, ['.', '+', '*', '#', '*', '+', '.', '+'][phase]!, 'core');
    if (!compact) {
      const bar = 12;
      const filled = Math.floor((phase + 1) / 8 * bar);
      setText(canvas, 14, 10, `[${'='.repeat(filled)}${'.'.repeat(bar - filled)}]`, 'accent');
    }
  }

  if (state === 'active') {
    const phase = tick % 5;
    if (!compact) {
      const packets = ['>    ', ' >   ', '  >  ', '   > ', '    >'][phase]!;
      setText(canvas, 31, 2, packets, 'accent');
      setText(canvas, 31, 4, packets, 'accent');
    }
  }

  if (state === 'thinking') {
    const orbit = compact
      ? [[1,0],[13,0],[14,2],[12,4],[2,4],[0,2]]
      : [[8,1],[32,1],[39,3],[32,5],[8,5],[1,3]];
    const p = orbit[tick % orbit.length]!;
    setCell(canvas, p[0]!, p[1]!, 'o', 'accent');
    setCell(canvas, coreX, coreY, tick % 3 === 0 ? 'x' : '*', 'core');
  }

  if (state === 'tool') {
    const path = compact
      ? [[9,1],[11,1],[13,0],[14,0]]
      : [[24,3],[29,3],[34,2],[38,1]];
    const p = path[tick % path.length]!;
    setCell(canvas, p[0]!, p[1]!, '*', 'accent');
    if (!compact) setText(canvas, 34, 0, 'tool', 'dim');
  }

  if (state === 'agents') {
    const open = tick % 10 >= 2 && tick % 10 <= 7;
    if (open) {
      if (compact) {
        setText(canvas, 0, 3, 'o', 'accent');
        setText(canvas, 14, 3, 'o', 'accent');
      } else {
        setText(canvas, 0, 1, '<o>', 'accent');
        setText(canvas, 38, 1, '<o>', 'accent');
        setText(canvas, 19, 9, 'o o', 'accent');
      }
    }
  }

  if (state === 'success') {
    canvas.flat().forEach((cell) => {
      if (cell.tone === 'body' || cell.tone === 'accent') cell.tone = 'success';
    });
    setCell(canvas, coreX, coreY, '*', 'success');
    if (!compact) setText(canvas, 35, 8, 'OK', 'success');
  }

  if (state === 'warning') {
    canvas.flat().forEach((cell) => {
      if (cell.tone === 'body' || cell.tone === 'accent') cell.tone = 'warning';
    });
    setCell(canvas, coreX, coreY, tick % 4 < 2 ? '!' : '*', 'warning');
    if (!compact) setText(canvas, 36, 8, '!', 'warning');
  }

  if (state === 'error') {
    canvas.flat().forEach((cell) => {
      if (cell.tone !== 'dim') cell.tone = 'error';
    });
    setCell(canvas, coreX, coreY, 'x', 'error');
    if (!compact && tick % 6 === 2) {
      const row = canvas[2]!;
      row.unshift({ ch: ' ', tone: 'dim' });
      row.pop();
    }
    if (!compact && tick % 6 === 4) {
      const row = canvas[4]!;
      row.shift();
      row.push({ ch: ' ', tone: 'dim' });
    }
    if (!compact) setText(canvas, 34, 8, 'ERR', 'error');
  }

  return canvas;
}

export function frameToText(frame: MantaCell[][]): string[] {
  return frame.map((row) => row.map((cell) => cell.ch).join('').replace(/\s+$/u, ''));
}

export function mantaStateLabel(state: MantaState): string {
  return {
    idle: 'Idle', loading: 'Loading', active: 'Active', thinking: 'Thinking',
    tool: 'Tool call', agents: 'Multi-agent', success: 'Success',
    warning: 'Warning', error: 'Error',
  }[state];
}
