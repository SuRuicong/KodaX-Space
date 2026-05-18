// TerminalPanel — F011-revised placeholder
//
// F011 revised：在 alpha.1 阶段先做空壳，真实 xterm.js + node-pty 接入留 v0.1.1。
// 当前显示"Coming"状态，但 popout 框架已就位。

export function TerminalPanel(): JSX.Element {
  return (
    <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs p-4 gap-2">
      <span aria-hidden className="text-2xl">{'>_'}</span>
      <div className="text-zinc-500">Terminal popout</div>
      <div className="text-center max-w-[280px]">
        xterm.js + node-pty 集成留 <code className="font-mono text-zinc-500">v0.1.1 F011</code>。
        alpha.1 先把 popout 框架立起来。
      </div>
    </div>
  );
}
