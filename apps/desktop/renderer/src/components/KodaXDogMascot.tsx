import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

type DogAction = 'idle' | 'walk' | 'sniff' | 'thinking' | 'success';
type DogFacing = 'left' | 'right';

interface DogFrameStep {
  readonly action: DogAction;
  readonly src: string;
  readonly x: number;
  readonly y: number;
  readonly ms: number;
  readonly facing: DogFacing;
}

interface KodaXDogMascotProps {
  readonly className?: string;
  readonly inputActive?: boolean;
  readonly working?: boolean;
}

type DogFrames = Record<DogAction, readonly string[]>;

const DOG_FRAME_COUNTS = {
  idle: 6,
  walk: 24,
  sniff: 6,
  thinking: 6,
  success: 6,
} satisfies Record<DogAction, number>;

const FALLBACK_FRAME_SRC =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201%201%22%2F%3E';

const FALLBACK_DOG_FRAMES: DogFrames = {
  idle: [FALLBACK_FRAME_SRC],
  walk: [FALLBACK_FRAME_SRC],
  sniff: [FALLBACK_FRAME_SRC],
  thinking: [FALLBACK_FRAME_SRC],
  success: [FALLBACK_FRAME_SRC],
};

const dogFrameLoaders = import.meta.glob('../assets/mascot/dog-frames/*.png', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

async function loadDogFrameAction(action: DogAction): Promise<readonly string[]> {
  const frameUrls = await Promise.all(
    Array.from({ length: DOG_FRAME_COUNTS[action] }, async (_, index) => {
      const frameNumber = String(index + 1).padStart(2, '0');
      const key = `../assets/mascot/dog-frames/${action}_${frameNumber}.png`;
      const load = dogFrameLoaders[key];
      if (!load) return FALLBACK_FRAME_SRC;
      try {
        return await load();
      } catch {
        return FALLBACK_FRAME_SRC;
      }
    }),
  );

  return Promise.all(frameUrls.map(preloadDogFrame));
}

async function loadDogFrameActions(actions: readonly DogAction[]): Promise<Partial<DogFrames>> {
  const entries = await Promise.all(
    actions.map(async (action) => [action, await loadDogFrameAction(action)] as const),
  );
  return Object.fromEntries(entries) as Partial<DogFrames>;
}

function collectFrames(frames: DogFrames, action: DogAction, count: number): readonly string[] {
  const available = frames[action];
  const firstVisibleFrame = available.find((src) => src !== FALLBACK_FRAME_SRC);
  return Array.from({ length: count }, (_, index) => {
    const frame = available[index];
    if (frame && frame !== FALLBACK_FRAME_SRC) return frame;
    return firstVisibleFrame ?? frame ?? FALLBACK_FRAME_SRC;
  });
}

function normalizeDogFrames(frames: DogFrames): DogFrames {
  return {
    idle: collectFrames(frames, 'idle', DOG_FRAME_COUNTS.idle),
    walk: collectFrames(frames, 'walk', DOG_FRAME_COUNTS.walk),
    sniff: collectFrames(frames, 'sniff', DOG_FRAME_COUNTS.sniff),
    thinking: collectFrames(frames, 'thinking', DOG_FRAME_COUNTS.thinking),
    success: collectFrames(frames, 'success', DOG_FRAME_COUNTS.success),
  };
}

function hasVisibleDogFrames(frames: DogFrames, action: DogAction): boolean {
  return frames[action].some((src) => src !== FALLBACK_FRAME_SRC);
}

function preloadDogFrame(src: string): Promise<string> {
  if (src === FALLBACK_FRAME_SRC || typeof Image === 'undefined') {
    return Promise.resolve(src);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(src);
    image.onerror = () => resolve(FALLBACK_FRAME_SRC);
    image.src = src;
  });
}

function addReadyDogActions(
  current: readonly DogAction[],
  actions: readonly DogAction[],
): readonly DogAction[] {
  let changed = false;
  const next = new Set(current);
  for (const action of actions) {
    if (!next.has(action)) {
      next.add(action);
      changed = true;
    }
  }
  return changed ? Array.from(next) : current;
}

function staticFrame(frames: DogFrames): DogFrameStep {
  return {
    action: 'idle',
    src: frames.idle[0] ?? FALLBACK_FRAME_SRC,
    x: 0,
    y: 0,
    ms: 360,
    facing: 'left',
  };
}

function makeFrame(
  framesByAction: DogFrames,
  action: DogAction,
  index: number,
  x = 0,
  y = 0,
  ms = 320,
  facing: DogFacing = 'left',
): DogFrameStep {
  const frames = framesByAction[action];

  return {
    action,
    src: frames[index % frames.length] ?? FALLBACK_FRAME_SRC,
    x,
    y,
    ms,
    facing,
  };
}

function makeIdleSequence(frames: DogFrames): readonly DogFrameStep[] {
  return frames.idle.map((_, index) =>
    makeFrame(frames, 'idle', index, 0, index === 2 || index === 4 ? -1 : 0, 380),
  );
}

function makeWalkSequence(frames: DogFrames, facing: DogFacing): readonly DogFrameStep[] {
  const start = facing === 'left' ? 7 : -7;
  const end = facing === 'left' ? -7 : 7;
  const frameCount = frames.walk.length;

  return frames.walk.map((_, index) => {
    const progress = frameCount <= 1 ? 0 : index / (frameCount - 1);
    const x = start + (end - start) * progress;
    const y = index % 4 === 1 || index % 4 === 2 ? -1 : 0;

    return makeFrame(frames, 'walk', index, x, y, 155, facing);
  });
}

function makeSniffSequence(frames: DogFrames): readonly DogFrameStep[] {
  return frames.sniff.map((_, index) =>
    makeFrame(frames, 'sniff', index, 2 - index * 0.8, index > 0 && index < 5 ? 1 : 0, 250),
  );
}

function makeThinkingSequence(frames: DogFrames): readonly DogFrameStep[] {
  return frames.thinking.map((_, index) =>
    makeFrame(
      frames,
      'thinking',
      index,
      0,
      index === 2 ? -2 : index === 1 || index === 3 ? -1 : 0,
      300,
    ),
  );
}

function makeSuccessSequence(frames: DogFrames): readonly DogFrameStep[] {
  return [
    makeFrame(frames, 'success', 0, 0, 0, 180),
    makeFrame(frames, 'success', 1, 0, -1, 180),
    makeFrame(frames, 'success', 2, 0, -4, 190),
    makeFrame(frames, 'success', 3, 0, 0, 180),
    makeFrame(frames, 'success', 4, 0, -1, 180),
    makeFrame(frames, 'success', 5, 0, -3, 190),
  ];
}

function usePrefersMinimalDogMotion(): boolean {
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

function useDogMotionActive(): boolean {
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

export function KodaXDogMascot({
  className = '',
  inputActive = false,
  working = false,
}: KodaXDogMascotProps): JSX.Element {
  const minimalMotion = usePrefersMinimalDogMotion();
  const dogMotionActive = useDogMotionActive();
  const [dogFrames, setDogFrames] = useState<DogFrames>(() =>
    normalizeDogFrames(FALLBACK_DOG_FRAMES),
  );
  const sequences = useMemo(
    () => ({
      staticFrame: staticFrame(dogFrames),
      idle: makeIdleSequence(dogFrames),
      sniff: makeSniffSequence(dogFrames),
      thinking: makeThinkingSequence(dogFrames),
      success: makeSuccessSequence(dogFrames),
    }),
    [dogFrames],
  );
  const [renderFrame, setRenderFrame] = useState<DogFrameStep>(() => sequences.staticFrame);
  const [successPulse, setSuccessPulse] = useState(0);
  const [readyActions, setReadyActions] = useState<readonly DogAction[]>([]);
  const wasWorkingRef = useRef(false);
  const lastHandledSuccessRef = useRef(0);
  const directionRef = useRef<DogFacing>('right');
  const requestedActionsRef = useRef<Set<DogAction>>(new Set());
  const readyActionSet = useMemo(() => new Set(readyActions), [readyActions]);

  useEffect(() => {
    let cancelled = false;
    requestedActionsRef.current.add('idle');
    void loadDogFrameActions(['idle']).then((loadedFrames) => {
      if (!cancelled) {
        setDogFrames((current) => normalizeDogFrames({ ...current, ...loadedFrames }));
        setReadyActions((current) => addReadyDogActions(current, ['idle']));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const wanted: DogAction[] = [];
    if (working) {
      wanted.push('thinking', 'walk', 'sniff', 'success');
    } else if (inputActive) {
      wanted.push('walk', 'sniff');
    }
    const missing = wanted.filter((action) => !requestedActionsRef.current.has(action));
    if (missing.length === 0) return;
    for (const action of missing) requestedActionsRef.current.add(action);

    let cancelled = false;
    void loadDogFrameActions(missing).then((loadedFrames) => {
      if (!cancelled) {
        setDogFrames((current) => normalizeDogFrames({ ...current, ...loadedFrames }));
        setReadyActions((current) => addReadyDogActions(current, missing));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inputActive, working]);

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
    if (minimalMotion) {
      setRenderFrame(sequences.staticFrame);
      return;
    }
    if (!dogMotionActive) {
      return;
    }

    let activeSequence: readonly DogFrameStep[] = sequences.idle;
    let activeIndex = 0;
    let cancelled = false;
    let cycle = 0;
    let timerId: number | undefined;
    const canUseAction = (action: DogAction): boolean =>
      readyActionSet.has(action) && hasVisibleDogFrames(dogFrames, action);
    const idleSequence = canUseAction('idle') ? sequences.idle : [sequences.staticFrame];

    function chooseNextSequence(): readonly DogFrameStep[] {
      if (!working && successPulse !== lastHandledSuccessRef.current && canUseAction('success')) {
        lastHandledSuccessRef.current = successPulse;
        return sequences.success;
      }

      cycle += 1;

      if (working) {
        if (cycle % 5 === 0 && canUseAction('walk')) {
          directionRef.current = directionRef.current === 'left' ? 'right' : 'left';
          return makeWalkSequence(dogFrames, directionRef.current);
        }

        if (cycle % 3 === 0 && canUseAction('sniff')) {
          return sequences.sniff;
        }

        return canUseAction('thinking') ? sequences.thinking : idleSequence;
      }

      if (inputActive) {
        if (cycle % 7 === 0 && canUseAction('walk')) {
          directionRef.current = directionRef.current === 'left' ? 'right' : 'left';
          return makeWalkSequence(dogFrames, directionRef.current);
        }

        if (cycle % 4 === 0 && canUseAction('sniff')) {
          return sequences.sniff;
        }
      }

      return idleSequence;
    }

    function tick() {
      if (cancelled) {
        return;
      }

      const step = activeSequence[activeIndex] ?? sequences.staticFrame;
      setRenderFrame(step);
      activeIndex += 1;

      if (activeIndex >= activeSequence.length) {
        activeSequence = chooseNextSequence();
        activeIndex = 0;
      }

      timerId = window.setTimeout(tick, step.ms);
    }

    activeSequence = chooseNextSequence();
    tick();

    return () => {
      cancelled = true;

      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [
    dogFrames,
    dogMotionActive,
    inputActive,
    minimalMotion,
    readyActionSet,
    sequences,
    successPulse,
    working,
  ]);

  const motionStyle = useMemo<CSSProperties>(
    () => ({
      transform: `translate3d(${renderFrame.x}px, ${renderFrame.y}px, 0)`,
    }),
    [renderFrame.x, renderFrame.y],
  );
  const flipStyle = useMemo<CSSProperties>(
    () => ({
      transform: `scaleX(${renderFrame.facing === 'right' ? -1 : 1})`,
    }),
    [renderFrame.facing],
  );

  return (
    <span
      className={`kodax-dog-mascot ${className}`}
      aria-hidden="true"
      data-action={renderFrame.action}
      data-testid="kodax-dog-mascot"
    >
      <span className="kodax-dog-mascot__frame">
        <span className="kodax-dog-mascot__motion" style={motionStyle}>
          <span className="kodax-dog-mascot__flip" style={flipStyle}>
            <img
              className="kodax-dog-mascot__image"
              src={renderFrame.src}
              alt=""
              draggable={false}
            />
          </span>
        </span>
      </span>
    </span>
  );
}
