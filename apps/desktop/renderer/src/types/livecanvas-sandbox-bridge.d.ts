// Local TYPE STUB for @livecanvas/sandbox-bridge.
//
// 目的：让 `tsc`（typecheck）在 **没有** LiveCanvas 源码 link 的机器上也能解析
// SandboxFrame.tsx 的 import —— 这样仓库的 install / build / typecheck / 打包 / 运行
// 全部 **零 LC 依赖**（LC 只是开发期可选的 react-artifact 档，默认门控关闭）。
//
// 接线方式（见 apps/desktop/tsconfig.json 的 "paths"）：tsc 通过 paths 总是解析到本 stub；
// 而 Vite **不读** tsconfig paths（只用 resolve.alias 的 `@`），所以：
//   - dev 跑 LC 档时，Vite 仍从 node_modules 解析 **真实** @livecanvas/sandbox-bridge；
//   - 生产构建里 SandboxFrame 整支被 `import.meta.env.DEV=false` + Rollup DCE 掉，根本不解析。
//
// 因此本 stub 只服务 tsc 的类型解析，不进任何运行时 / 产物。保持与 SandboxFrame.tsx 实际
// 用到的子集一致即可；真实 API 在 LiveCanvas/packages/sandbox-bridge。

export interface HostArtifactMessage {
  readonly type: 'lc:artifact';
  readonly code: string;
  readonly bootstrap: {
    readonly artifactId: string;
    readonly scopedToken: string;
    readonly apiBase: string;
    readonly sandboxOrigin: string;
  };
}

export interface Host {
  sendArtifact(msg: HostArtifactMessage): void;
  dispose(): void;
}

export interface CreateHostOptions {
  iframe: HTMLIFrameElement;
  sandboxOrigin: string;
  onReady: () => void;
  onError: (msg: { message: string }) => void;
  onTimeout: () => void;
}

export function createHost(options: CreateHostOptions): Host;
