import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import doggyLeftSheetUrl from '../assets/mascot/doggy3-left-sheet.png?url';
import doggyRightSheetUrl from '../assets/mascot/doggy3-right-sheet.png?url';

type DoggyAction =
  | 'idle'
  | 'patrol'
  | 'sniff'
  | 'thinking'
  | 'working'
  | 'success'
  | 'nap'
  | 'play'
  | 'react';
type DoggyFacing = 'left' | 'right';

interface DoggyCell {
  readonly col: number;
  readonly row: number;
}

interface DoggyStep extends DoggyCell {
  readonly action: DoggyAction;
  readonly x: number;
  readonly y: number;
  readonly ms: number;
  readonly facing: DoggyFacing;
}

interface KodaXDogSpriteMascotProps {
  readonly className?: string;
  readonly inputActive?: boolean;
  readonly inputActivityKey?: string | number;
  readonly working?: boolean;
}

const DOGGY_SHEET_COLUMNS = 9;
const DOGGY_SHEET_ROWS = 7;
const PATROL_LEFT_X = -24;
const PATROL_RIGHT_X = 0;
const IDLE_ACTION_DELAY_MS = [1600, 3200] as const;
const IDLE_PATROL_DELAY_MS = [6000, 10000] as const;
const INPUT_REACT_DELAY_MS = [220, 520] as const;
const INPUT_ACTION_DELAY_MS = [900, 1800] as const;
const INPUT_PATROL_DELAY_MS = [3500, 6500] as const;
const INPUT_ACTIVITY_THROTTLE_MS = 1000;
const WORKING_ACTION_DELAY_MS = [1200, 2600] as const;
const WORKING_PATROL_DELAY_MS = [4500, 8000] as const;
const DOGGY_MICRO_FRAME_MS = 210;
const DOGGY_ACTION_FRAME_MS = 185;
const DOGGY_FAST_FRAME_MS = 155;
const PATROL_RUN_DURATION_MS = [3200, 5000] as const;

function doggyCell(row: number, col: number): DoggyCell {
  return { col: col - 1, row: row - 1 };
}

const DOGGY = {
  runEaseIn: doggyCell(1, 1),
  runLiftA: doggyCell(1, 2),
  runStrideA: doggyCell(1, 3),
  runDriveA: doggyCell(1, 4),
  runStretch: doggyCell(1, 5),
  runDriveB: doggyCell(1, 6),
  runStrideB: doggyCell(1, 7),
  runLiftB: doggyCell(1, 8),
  runSettle: doggyCell(1, 9),

  rollSit: doggyCell(2, 1),
  rollStandWatch: doggyCell(2, 2),
  rollNap: doggyCell(2, 3),
  rollBack: doggyCell(2, 4),
  rollCurlA: doggyCell(2, 5),
  rollCurlB: doggyCell(2, 6),
  rollBallSit: doggyCell(2, 7),
  rollFluffySit: doggyCell(2, 8),
  rollFrontSit: doggyCell(2, 9),

  groomSitUp: doggyCell(3, 1),
  groomPawA: doggyCell(3, 2),
  groomPawB: doggyCell(3, 3),
  groomFace: doggyCell(3, 4),
  groomLickA: doggyCell(3, 5),
  groomLickB: doggyCell(3, 6),
  groomHugClosed: doggyCell(3, 7),
  groomHugHappy: doggyCell(3, 8),
  groomSideSit: doggyCell(3, 9),

  sleepCurious: doggyCell(4, 1),
  sleepLieA: doggyCell(4, 2),
  sleepLieB: doggyCell(4, 3),
  sleepCurl: doggyCell(4, 4),
  sleepZ1: doggyCell(4, 5),
  sleepZ2: doggyCell(4, 6),
  sleepStretchA: doggyCell(4, 7),
  sleepStretchB: doggyCell(4, 8),
  sleepSit: doggyCell(4, 9),

  boneFront: doggyCell(5, 1),
  bonePickA: doggyCell(5, 2),
  bonePickB: doggyCell(5, 3),
  boneWalkA: doggyCell(5, 4),
  boneWalkB: doggyCell(5, 5),
  boneWalkC: doggyCell(5, 6),
  boneChew: doggyCell(5, 7),
  boneHoldSit: doggyCell(5, 8),
  boneCuteFront: doggyCell(5, 9),

  faceNeutral: doggyCell(6, 1),
  faceSad: doggyCell(6, 2),
  faceCry: doggyCell(6, 3),
  faceCover: doggyCell(6, 4),
  faceSweat: doggyCell(6, 5),
  faceBlink: doggyCell(6, 6),
  faceHappyA: doggyCell(6, 7),
  faceHappyB: doggyCell(6, 8),
  faceSmile: doggyCell(6, 9),

  playSideSit: doggyCell(7, 1),
  playTailA: doggyCell(7, 2),
  playTailB: doggyCell(7, 3),
  playRunA: doggyCell(7, 4),
  playRunB: doggyCell(7, 5),
  playBallCarry: doggyCell(7, 6),
  playBallPounce: doggyCell(7, 7),
  playSitA: doggyCell(7, 8),
  playSitB: doggyCell(7, 9),
} satisfies Record<string, DoggyCell>;

function makeStep(
  action: DoggyAction,
  cell: DoggyCell,
  ms: number,
  x = 0,
  y = 0,
  facing: DoggyFacing = 'right',
): DoggyStep {
  return {
    action,
    col: cell.col,
    row: cell.row,
    x,
    y,
    ms,
    facing,
  };
}

interface DoggyLoopOptions {
  readonly facing?: DoggyFacing;
  readonly xForFrame?: (index: number, count: number) => number;
  readonly yForFrame?: (index: number, count: number) => number;
}

function makeLoopSequence(
  action: DoggyAction,
  cells: readonly DoggyCell[],
  durationMs: number,
  frameMs: number,
  options: DoggyLoopOptions = {},
): readonly DoggyStep[] {
  if (cells.length === 0) return [];

  const fallbackCell = cells[0];
  if (!fallbackCell) return [];
  const count = Math.max(cells.length, Math.ceil(durationMs / frameMs));
  return Array.from({ length: count }, (_, index) => {
    const cell = cells[index % cells.length] ?? fallbackCell;
    return makeStep(
      action,
      cell,
      frameMs,
      options.xForFrame?.(index, count) ?? 0,
      options.yForFrame?.(index, count) ?? 0,
      options.facing,
    );
  });
}

const STATIC_DOGGY_STEP = makeStep('idle', DOGGY.faceSmile, 1200);

function makeIdleMicroSequence(): readonly DoggyStep[] {
  return [
    makeStep('idle', DOGGY.rollFrontSit, DOGGY_MICRO_FRAME_MS),
    makeStep('idle', DOGGY.faceBlink, DOGGY_MICRO_FRAME_MS),
    makeStep('idle', DOGGY.faceSmile, DOGGY_MICRO_FRAME_MS + 80),
    makeStep('idle', DOGGY.rollSit, DOGGY_MICRO_FRAME_MS + 120),
  ];
}

function makeWatchSequence(): readonly DoggyStep[] {
  return [
    makeStep('idle', DOGGY.rollStandWatch, 260, -1),
    makeStep('idle', DOGGY.groomSitUp, 300, -1, -1),
    makeStep('idle', DOGGY.sleepCurious, 360, 0, -1),
    makeStep('idle', DOGGY.groomSideSit, 320),
    makeStep('idle', DOGGY.faceSmile, 320),
  ];
}

function makeLickSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'idle',
    [
      DOGGY.groomSitUp,
      DOGGY.groomPawA,
      DOGGY.groomPawB,
      DOGGY.groomFace,
      DOGGY.groomLickA,
      DOGGY.groomLickB,
      DOGGY.groomHugClosed,
      DOGGY.groomHugHappy,
      DOGGY.groomSideSit,
    ],
    2800,
    DOGGY_ACTION_FRAME_MS,
  );
}

function makeBlinkSequence(): readonly DoggyStep[] {
  return [
    makeStep('idle', DOGGY.faceNeutral, 190),
    makeStep('idle', DOGGY.faceBlink, 180),
    makeStep('idle', DOGGY.faceSmile, 240),
    makeStep('idle', DOGGY.faceHappyA, 220, 0, -1),
    makeStep('idle', DOGGY.faceSmile, 260),
  ];
}

function makeTailSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'idle',
    [DOGGY.playSideSit, DOGGY.playTailA, DOGGY.playTailB],
    2400,
    DOGGY_ACTION_FRAME_MS,
    {
      yForFrame: (index) => (index % 3 === 0 ? 0 : -1),
    },
  );
}

function makePatrolSequence(
  facing: DoggyFacing,
  startX: number,
  endX: number,
): readonly DoggyStep[] {
  const cells = [
    DOGGY.runEaseIn,
    DOGGY.runLiftA,
    DOGGY.runStrideA,
    DOGGY.runDriveA,
    DOGGY.runStretch,
    DOGGY.runDriveB,
    DOGGY.runStrideB,
    DOGGY.runLiftB,
    DOGGY.runSettle,
  ];
  const durationMs = randomDelay(PATROL_RUN_DURATION_MS);

  return makeLoopSequence('patrol', cells, durationMs, DOGGY_FAST_FRAME_MS, {
    facing,
    xForFrame: (index, count) => {
      const progress = count <= 1 ? 0 : index / (count - 1);
      return startX + (endX - startX) * progress;
    },
    yForFrame: (index, count) =>
      index === 0 || index === count - 1 ? 0 : index % 2 === 0 ? -1 : -2,
  });
}

function makeSniffSequence(): readonly DoggyStep[] {
  return [
    makeStep('sniff', DOGGY.rollStandWatch, 240, -1),
    makeStep('sniff', DOGGY.sleepCurious, 300, -2, 1),
    makeStep('sniff', DOGGY.groomSitUp, 260, -1),
    makeStep('sniff', DOGGY.groomLickA, 260, -1),
    makeStep('sniff', DOGGY.groomSideSit, 320),
  ];
}

function makeThinkingSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'thinking',
    [
      DOGGY.faceNeutral,
      DOGGY.faceSweat,
      DOGGY.sleepCurious,
      DOGGY.groomHugClosed,
      DOGGY.faceBlink,
      DOGGY.faceSmile,
    ],
    2400,
    DOGGY_ACTION_FRAME_MS + 20,
    {
      yForFrame: (index) => (index % 6 === 1 || index % 6 === 2 ? -1 : 0),
    },
  );
}

function makeWorkingSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'working',
    [
      DOGGY.bonePickA,
      DOGGY.bonePickB,
      DOGGY.boneWalkA,
      DOGGY.boneWalkB,
      DOGGY.boneWalkC,
      DOGGY.boneChew,
      DOGGY.boneHoldSit,
    ],
    3200,
    DOGGY_ACTION_FRAME_MS,
    {
      yForFrame: (index) => (index % 7 === 1 || index % 7 === 5 ? -1 : 0),
    },
  );
}

function makeHopSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [DOGGY.playSideSit, DOGGY.playRunA, DOGGY.playRunB, DOGGY.playBallPounce, DOGGY.playSitA],
    2200,
    DOGGY_ACTION_FRAME_MS,
    {
      yForFrame: (index) => (index % 5 === 2 ? -4 : index % 5 === 3 ? -2 : 0),
    },
  );
}

function makePounceSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [DOGGY.playRunA, DOGGY.playRunB, DOGGY.playBallCarry, DOGGY.playBallPounce, DOGGY.playSitB],
    2600,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => -1 - (index % 5),
      yForFrame: (index) => (index % 5 === 1 ? -2 : index % 5 === 3 ? -1 : 0),
    },
  );
}

function makeRollSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [
      DOGGY.rollSit,
      DOGGY.rollStandWatch,
      DOGGY.rollNap,
      DOGGY.rollBack,
      DOGGY.rollCurlA,
      DOGGY.rollCurlB,
      DOGGY.rollBallSit,
      DOGGY.rollFluffySit,
      DOGGY.rollFrontSit,
    ],
    3200,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => [-1, -1, -2, -2, -1, 1, 1, 0, 0][index % 9] ?? 0,
      yForFrame: (index) => [0, 0, 1, -1, -1, 1, -1, 0, 0][index % 9] ?? 0,
    },
  );
}

function makeDashSequence(): readonly DoggyStep[] {
  const cells = [
    DOGGY.runEaseIn,
    DOGGY.runLiftA,
    DOGGY.runStrideA,
    DOGGY.runDriveA,
    DOGGY.runStretch,
    DOGGY.runDriveB,
    DOGGY.runStrideB,
    DOGGY.runLiftB,
    DOGGY.runSettle,
  ];
  return makeLoopSequence('play', cells, 2600, DOGGY_FAST_FRAME_MS, {
    xForFrame: (index, count) => {
      const progress = count <= 1 ? 0 : index / (count - 1);
      return -10 + 10 * progress;
    },
    yForFrame: (index) => (index % 3 === 1 ? -2 : index % 3 === 2 ? -1 : 0),
  });
}

function makeWiggleSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [DOGGY.playSideSit, DOGGY.playTailA, DOGGY.playTailB, DOGGY.faceHappyA, DOGGY.faceHappyB],
    2400,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => (index % 2 === 0 ? -1 : 1),
      yForFrame: (index) => (index % 5 >= 3 ? -1 : 0),
    },
  );
}

function makeSparkleSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [DOGGY.faceNeutral, DOGGY.faceBlink, DOGGY.faceHappyA, DOGGY.faceHappyB, DOGGY.faceSmile],
    2100,
    DOGGY_ACTION_FRAME_MS + 25,
    {
      yForFrame: (index) => (index % 5 === 2 || index % 5 === 3 ? -1 : 0),
    },
  );
}

function makeBoneSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [
      DOGGY.boneFront,
      DOGGY.bonePickA,
      DOGGY.bonePickB,
      DOGGY.boneWalkA,
      DOGGY.boneWalkB,
      DOGGY.boneWalkC,
      DOGGY.boneChew,
      DOGGY.boneHoldSit,
      DOGGY.boneCuteFront,
    ],
    3400,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => [0, 0, 0, -1, -2, -1, 0, 0, 0][index % 9] ?? 0,
      yForFrame: (index) => [0, 0, -1, 0, -1, 0, -1, 0, 0][index % 9] ?? 0,
    },
  );
}

function makeBallSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [
      DOGGY.playSideSit,
      DOGGY.playTailA,
      DOGGY.playTailB,
      DOGGY.playRunA,
      DOGGY.playRunB,
      DOGGY.playBallCarry,
      DOGGY.playBallPounce,
      DOGGY.playSitA,
      DOGGY.playSitB,
    ],
    3200,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => [0, -1, 1, -2, -3, -2, -1, 0, 0][index % 9] ?? 0,
      yForFrame: (index) => [0, 0, 0, -1, -2, -1, 0, 0, 0][index % 9] ?? 0,
    },
  );
}

function makeSleepySequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'nap',
    [
      DOGGY.sleepCurious,
      DOGGY.sleepLieA,
      DOGGY.sleepLieB,
      DOGGY.sleepCurl,
      DOGGY.sleepZ1,
      DOGGY.sleepZ2,
    ],
    3600,
    260,
    {
      yForFrame: (index) => (index % 6 === 0 ? 0 : 1),
    },
  );
}

function makeMoodSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'react',
    [
      DOGGY.faceNeutral,
      DOGGY.faceSad,
      DOGGY.faceCry,
      DOGGY.faceCover,
      DOGGY.faceSweat,
      DOGGY.faceBlink,
      DOGGY.faceHappyA,
      DOGGY.faceHappyB,
      DOGGY.faceSmile,
    ],
    2600,
    DOGGY_ACTION_FRAME_MS,
    {
      yForFrame: (index) => (index % 9 === 2 ? 1 : index % 9 >= 6 ? -1 : 0),
    },
  );
}

function makeShakeSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'react',
    [DOGGY.faceCover, DOGGY.faceSweat, DOGGY.faceCover, DOGGY.faceBlink, DOGGY.faceHappyA],
    1800,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => (index % 2 === 0 ? -1 : 1),
      yForFrame: (index) => (index % 5 === 1 || index % 5 === 4 ? -1 : 0),
    },
  );
}

function makeToySequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'play',
    [DOGGY.playTailA, DOGGY.playTailB, DOGGY.playBallCarry, DOGGY.playBallPounce, DOGGY.playSitB],
    2400,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => [-1, 1, -1, -3, 0][index % 5] ?? 0,
      yForFrame: (index) => [0, 0, -1, 0, 0][index % 5] ?? 0,
    },
  );
}

function makeQuestionSequence(): readonly DoggyStep[] {
  return [
    makeStep('react', DOGGY.rollStandWatch, 220),
    makeStep('react', DOGGY.sleepCurious, 320, 0, -1),
    makeStep('react', DOGGY.faceSweat, 280, 0, -1),
    makeStep('react', DOGGY.groomHugClosed, 320),
    makeStep('react', DOGGY.faceSmile, 300),
  ];
}

function makeSuccessSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'success',
    [
      DOGGY.faceNeutral,
      DOGGY.playRunA,
      DOGGY.playRunB,
      DOGGY.faceHappyA,
      DOGGY.faceHappyB,
      DOGGY.playTailA,
      DOGGY.playTailB,
      DOGGY.faceSmile,
    ],
    2400,
    DOGGY_ACTION_FRAME_MS,
    {
      xForFrame: (index) => (index % 8 === 5 ? -1 : index % 8 === 6 ? 1 : 0),
      yForFrame: (index) => (index % 8 === 2 ? -5 : index % 8 === 3 || index % 8 === 4 ? -2 : 0),
    },
  );
}

function makeNapSequence(): readonly DoggyStep[] {
  return makeLoopSequence(
    'nap',
    [
      DOGGY.sleepCurious,
      DOGGY.sleepLieA,
      DOGGY.sleepLieB,
      DOGGY.sleepCurl,
      DOGGY.sleepZ1,
      DOGGY.sleepZ2,
      DOGGY.sleepStretchA,
      DOGGY.sleepStretchB,
      DOGGY.sleepSit,
    ],
    4600,
    260,
    {
      xForFrame: (index) => (index % 9 === 6 ? -1 : index % 9 === 7 ? 1 : 0),
      yForFrame: (index) => (index % 9 >= 1 && index % 9 <= 5 ? 1 : 0),
    },
  );
}

function usePrefersMinimalDoggyMotion(): boolean {
  const [minimalMotion, setMinimalMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const readPreference = () => {
      setMinimalMotion(
        mediaQuery.matches || document.documentElement.classList.contains('q-minimal'),
      );
    };

    readPreference();
    mediaQuery.addEventListener('change', readPreference);

    const observer = new MutationObserver(readPreference);
    observer.observe(document.documentElement, {
      attributeFilter: ['class'],
      attributes: true,
    });

    return () => {
      mediaQuery.removeEventListener('change', readPreference);
      observer.disconnect();
    };
  }, []);

  return minimalMotion;
}

function useDoggyMotionActive(): boolean {
  const [active, setActive] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden && document.hasFocus(),
  );

  useEffect(() => {
    const readActive = () => {
      setActive(!document.hidden && document.hasFocus());
    };

    readActive();
    document.addEventListener('visibilitychange', readActive);
    window.addEventListener('focus', readActive);
    window.addEventListener('blur', readActive);

    return () => {
      document.removeEventListener('visibilitychange', readActive);
      window.removeEventListener('focus', readActive);
      window.removeEventListener('blur', readActive);
    };
  }, []);

  return active;
}

function backgroundPositionPercent(index: number, count: number): number {
  return count <= 1 ? 0 : (index / (count - 1)) * 100;
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function randomDelay([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

function nextDueAt(values: readonly number[]): number {
  return values.reduce((earliest, value) => Math.min(earliest, value), Number.POSITIVE_INFINITY);
}

function checkDelayUntil(dueAt: number): number {
  if (!Number.isFinite(dueAt)) return 260;
  return Math.max(120, Math.min(260, dueAt - nowMs()));
}

function pickWeightedSequence(
  choices: readonly {
    readonly weight: number;
    readonly sequence: () => readonly DoggyStep[];
  }[],
): readonly DoggyStep[] {
  const totalWeight = choices.reduce((total, choice) => total + choice.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const choice of choices) {
    roll -= choice.weight;
    if (roll <= 0) return choice.sequence();
  }
  return choices.at(-1)?.sequence() ?? [];
}

export function KodaXDogSpriteMascot({
  className = '',
  inputActive = false,
  inputActivityKey = '',
  working = false,
}: KodaXDogSpriteMascotProps): JSX.Element {
  const minimalMotion = usePrefersMinimalDoggyMotion();
  const dogMotionActive = useDoggyMotionActive();
  const [renderStep, setRenderStep] = useState<DoggyStep>(STATIC_DOGGY_STEP);
  const [successPulse, setSuccessPulse] = useState(0);
  const lastInputActivityAtRef = useRef(0);
  const pendingInputActivityRef = useRef(0);
  const handledInputActivityRef = useRef(0);
  const wasWorkingRef = useRef(false);
  const lastHandledSuccessRef = useRef(0);
  const patrolOffsetRef = useRef(PATROL_RIGHT_X);
  const patrolDirectionRef = useRef<DoggyFacing>('left');

  const sequences = useMemo(
    () => ({
      idleMicro: makeIdleMicroSequence(),
      blink: makeBlinkSequence(),
      tail: makeTailSequence(),
      watch: makeWatchSequence(),
      lick: makeLickSequence(),
      sniff: makeSniffSequence(),
      thinking: makeThinkingSequence(),
      working: makeWorkingSequence(),
      hop: makeHopSequence(),
      pounce: makePounceSequence(),
      roll: makeRollSequence(),
      dash: makeDashSequence(),
      wiggle: makeWiggleSequence(),
      sparkle: makeSparkleSequence(),
      bone: makeBoneSequence(),
      ball: makeBallSequence(),
      sleepy: makeSleepySequence(),
      mood: makeMoodSequence(),
      shake: makeShakeSequence(),
      toy: makeToySequence(),
      question: makeQuestionSequence(),
      success: makeSuccessSequence(),
      nap: makeNapSequence(),
    }),
    [],
  );

  useEffect(() => {
    if (working) {
      wasWorkingRef.current = true;
      return;
    }

    if (wasWorkingRef.current) {
      wasWorkingRef.current = false;
      setSuccessPulse((value) => value + 1);
    }
  }, [working]);

  useEffect(() => {
    if (!inputActive) {
      lastInputActivityAtRef.current = 0;
      return;
    }

    const currentTime = nowMs();
    if (currentTime - lastInputActivityAtRef.current < INPUT_ACTIVITY_THROTTLE_MS) {
      return;
    }

    lastInputActivityAtRef.current = currentTime;
    pendingInputActivityRef.current += 1;
  }, [inputActive, inputActivityKey]);

  useEffect(() => {
    if (minimalMotion) {
      setRenderStep(STATIC_DOGGY_STEP);
      return;
    }
    if (!dogMotionActive) {
      return;
    }

    let activeSequence: readonly DoggyStep[] | null = null;
    let activeIndex = 0;
    let cancelled = false;
    let timerId: number | undefined;
    let actionAt = working
      ? nowMs()
      : nowMs() + randomDelay(inputActive ? INPUT_ACTION_DELAY_MS : IDLE_ACTION_DELAY_MS);
    let patrolAt =
      nowMs() +
      randomDelay(
        working
          ? WORKING_PATROL_DELAY_MS
          : inputActive
            ? INPUT_PATROL_DELAY_MS
            : IDLE_PATROL_DELAY_MS,
      );
    let inputReactAt = inputActive
      ? nowMs() + randomDelay(INPUT_REACT_DELAY_MS)
      : Number.POSITIVE_INFINITY;
    const pendingSuccess =
      !working && successPulse !== lastHandledSuccessRef.current
        ? { handled: false }
        : { handled: true };

    function makeNextPatrol(): readonly DoggyStep[] {
      const facing = patrolDirectionRef.current;
      const startX = patrolOffsetRef.current;
      const endX = facing === 'left' ? PATROL_LEFT_X : PATROL_RIGHT_X;
      patrolOffsetRef.current = endX;
      patrolDirectionRef.current = facing === 'left' ? 'right' : 'left';
      return makePatrolSequence(facing, startX, endX);
    }

    function scheduleAction(referenceTime = nowMs()) {
      actionAt =
        referenceTime +
        randomDelay(
          working
            ? WORKING_ACTION_DELAY_MS
            : inputActive
              ? INPUT_ACTION_DELAY_MS
              : IDLE_ACTION_DELAY_MS,
        );
    }

    function schedulePatrol(referenceTime = nowMs()) {
      patrolAt =
        referenceTime +
        randomDelay(
          working
            ? WORKING_PATROL_DELAY_MS
            : inputActive
              ? INPUT_PATROL_DELAY_MS
              : IDLE_PATROL_DELAY_MS,
        );
    }

    function idleSequence(): readonly DoggyStep[] {
      return pickWeightedSequence([
        { weight: 12, sequence: () => sequences.idleMicro },
        { weight: 10, sequence: () => sequences.blink },
        { weight: 10, sequence: () => sequences.tail },
        { weight: 10, sequence: () => sequences.watch },
        { weight: 8, sequence: () => sequences.sniff },
        { weight: 7, sequence: () => sequences.lick },
        { weight: 7, sequence: () => sequences.hop },
        { weight: 6, sequence: () => sequences.wiggle },
        { weight: 6, sequence: () => makeNextPatrol() },
        { weight: 5, sequence: () => sequences.pounce },
        { weight: 5, sequence: () => sequences.roll },
        { weight: 5, sequence: () => sequences.bone },
        { weight: 5, sequence: () => sequences.ball },
        { weight: 4, sequence: () => sequences.sparkle },
        { weight: 3, sequence: () => sequences.shake },
        { weight: 2, sequence: () => sequences.toy },
        { weight: 2, sequence: () => sequences.nap },
        { weight: 1, sequence: () => sequences.mood },
      ]);
    }

    function inputSequence(): readonly DoggyStep[] {
      return pickWeightedSequence([
        { weight: 12, sequence: () => sequences.watch },
        { weight: 12, sequence: () => sequences.sniff },
        { weight: 10, sequence: () => sequences.question },
        { weight: 9, sequence: () => sequences.pounce },
        { weight: 8, sequence: () => sequences.hop },
        { weight: 8, sequence: () => sequences.tail },
        { weight: 7, sequence: () => sequences.wiggle },
        { weight: 7, sequence: () => makeNextPatrol() },
        { weight: 6, sequence: () => sequences.bone },
        { weight: 6, sequence: () => sequences.ball },
        { weight: 5, sequence: () => sequences.sparkle },
        { weight: 5, sequence: () => sequences.dash },
        { weight: 3, sequence: () => sequences.roll },
      ]);
    }

    function workingSequence(): readonly DoggyStep[] {
      return pickWeightedSequence([
        { weight: 14, sequence: () => sequences.thinking },
        { weight: 12, sequence: () => sequences.working },
        { weight: 9, sequence: () => sequences.question },
        { weight: 8, sequence: () => sequences.bone },
        { weight: 7, sequence: () => makeNextPatrol() },
        { weight: 7, sequence: () => sequences.sniff },
        { weight: 6, sequence: () => sequences.sparkle },
        { weight: 6, sequence: () => sequences.ball },
        { weight: 5, sequence: () => sequences.dash },
        { weight: 4, sequence: () => sequences.shake },
      ]);
    }

    function inputActivitySequence(): readonly DoggyStep[] {
      return pickWeightedSequence([
        { weight: 14, sequence: () => sequences.watch },
        { weight: 12, sequence: () => sequences.question },
        { weight: 10, sequence: () => sequences.hop },
        { weight: 9, sequence: () => sequences.sniff },
        { weight: 8, sequence: () => sequences.tail },
        { weight: 8, sequence: () => makeNextPatrol() },
        { weight: 7, sequence: () => sequences.pounce },
        { weight: 6, sequence: () => sequences.ball },
        { weight: 5, sequence: () => sequences.dash },
        { weight: 4, sequence: () => sequences.bone },
      ]);
    }

    function chooseNextSequence(): readonly DoggyStep[] {
      const currentTime = nowMs();
      if (!pendingSuccess.handled) {
        pendingSuccess.handled = true;
        lastHandledSuccessRef.current = successPulse;
        scheduleAction(currentTime);
        schedulePatrol(currentTime);
        return sequences.success;
      }

      if (inputActive && pendingInputActivityRef.current !== handledInputActivityRef.current) {
        handledInputActivityRef.current = pendingInputActivityRef.current;
        inputReactAt = Number.POSITIVE_INFINITY;
        scheduleAction(currentTime);
        return inputActivitySequence();
      }

      if (working) {
        if (currentTime >= patrolAt) {
          scheduleAction(currentTime);
          schedulePatrol(currentTime);
          return makeNextPatrol();
        }
        if (currentTime >= actionAt) {
          scheduleAction(currentTime);
          return workingSequence();
        }
        return [];
      }

      if (inputActive) {
        if (currentTime >= patrolAt) {
          scheduleAction(currentTime);
          schedulePatrol(currentTime);
          return makeNextPatrol();
        }
        if (currentTime >= inputReactAt) {
          inputReactAt = Number.POSITIVE_INFINITY;
          scheduleAction(currentTime);
          return inputSequence();
        }
        if (currentTime >= actionAt) {
          scheduleAction(currentTime);
          return inputSequence();
        }
        return [];
      }

      if (currentTime >= patrolAt) {
        scheduleAction(currentTime);
        schedulePatrol(currentTime);
        return makeNextPatrol();
      }
      if (currentTime >= actionAt) {
        scheduleAction(currentTime);
        return idleSequence();
      }
      return [];
    }

    function nextCheckDelay(): number {
      if (!pendingSuccess.handled) return 180;
      if (inputActive && pendingInputActivityRef.current !== handledInputActivityRef.current)
        return 120;
      return checkDelayUntil(nextDueAt([actionAt, patrolAt, inputReactAt]));
    }

    function tick() {
      if (cancelled) {
        return;
      }

      if (activeSequence !== null) {
        const step = activeSequence[activeIndex] ?? STATIC_DOGGY_STEP;
        setRenderStep(step);
        activeIndex += 1;

        if (activeIndex < activeSequence.length) {
          timerId = window.setTimeout(tick, step.ms);
          return;
        }

        activeSequence = null;
        activeIndex = 0;
        timerId = window.setTimeout(tick, step.ms);
        return;
      }

      const nextSequence = chooseNextSequence();
      if (nextSequence.length > 0) {
        activeSequence = nextSequence;
        activeIndex = 0;
        tick();
        return;
      }

      setRenderStep(STATIC_DOGGY_STEP);
      timerId = window.setTimeout(tick, nextCheckDelay());
    }

    tick();

    return () => {
      cancelled = true;

      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [dogMotionActive, inputActive, minimalMotion, sequences, successPulse, working]);

  const motionStyle = useMemo<CSSProperties>(
    () => ({
      transform: `translate3d(${renderStep.x}px, ${renderStep.y}px, 0)`,
    }),
    [renderStep.x, renderStep.y],
  );
  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      backgroundImage: `url(${
        renderStep.facing === 'left' ? doggyLeftSheetUrl : doggyRightSheetUrl
      })`,
      backgroundPosition: `${backgroundPositionPercent(
        renderStep.col,
        DOGGY_SHEET_COLUMNS,
      )}% ${backgroundPositionPercent(renderStep.row, DOGGY_SHEET_ROWS)}%`,
      backgroundSize: `${DOGGY_SHEET_COLUMNS * 100}% ${DOGGY_SHEET_ROWS * 100}%`,
    }),
    [renderStep.col, renderStep.facing, renderStep.row],
  );

  return (
    <span
      className={`kodax-dog-sprite-mascot ${className}`}
      aria-hidden="true"
      data-action={renderStep.action}
      data-cell={`${renderStep.row + 1}-${renderStep.col + 1}`}
      data-testid="kodax-doggy-sprite-mascot"
    >
      <span className="kodax-dog-sprite-mascot__frame">
        <span className="kodax-dog-sprite-mascot__motion" style={motionStyle}>
          <span className="kodax-dog-sprite-mascot__flip">
            <span className="kodax-dog-sprite-mascot__sprite" style={spriteStyle} />
          </span>
        </span>
      </span>
    </span>
  );
}
