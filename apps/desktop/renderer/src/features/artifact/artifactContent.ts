// ArtifactContent — the discriminated union ArtifactView dispatches on (F056/F059).
// Kept in a JSX-free module so non-React code (toArtifactContent, node:test) can
// import the type without pulling ArtifactView.tsx (React/recharts) into scope.

export type ArtifactContent =
  | { kind: 'markdown'; content: string }
  | { kind: 'code'; content: string; filename?: string }
  | { kind: 'html'; content: string }
  | { kind: 'svg'; content: string }
  | { kind: 'image'; src: string; alt?: string }
  | { kind: 'chart'; spec: unknown }
  | { kind: 'pdf' | 'docx' | 'xlsx'; projectRoot: string; path: string }
  | { kind: 'react'; indexUrl: string; sandboxOrigin: string; code: string; artifactId: string };
