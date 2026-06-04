// Cross-process canonicalizer for project roots.
//
// Why this lives in the schema package:
//   - Both main (electron/ipc/session.ts) and renderer (LeftSidebar.tsx) need it
//   - Two separate implementations had drifted (F040 / F041 review MED-3)
//   - schema package is pure JS / no Node deps → safe to import from both env
//
// Why we don't use `path.normalize`:
//   - Renderer is browser env; `node:path` is not bundled by Vite
//   - The cases we care about (separator unification, trailing slash, Windows
//     case-folding) are doable in ~5 lines without `path.normalize`'s
//     `..`-resolution overhead
//   - validateProjectRoot (main) already rejects `..` paths upstream, so the
//     canonicalizer never sees them in practice
//
// Caller responsibilities:
//   - Detect the current platform's "Windowsness" themselves (main: `process.platform`,
//     renderer: `navigator.userAgent`) — this util is platform-agnostic by design
//   - Don't pass paths that haven't gone through input validation (size limits etc.)

/**
 * Canonicalize a project root path so equality checks work across:
 *   - Slash variation (Windows accepts both `/` and `\`, POSIX only `/`)
 *   - Trailing separator (`C:\Works\foo\` vs `C:\Works\foo`)
 *   - Windows case (NTFS is case-insensitive; `C:\` vs `c:\`)
 *
 * @param p input path; may include trailing separator and mixed slashes
 * @param isWindows Windows-platform flag (caller determines from process.platform / navigator.userAgent)
 * @returns canonical form suitable for `===` comparison
 */
export function canonProjectRoot(p: string, isWindows: boolean): string {
  if (typeof p !== 'string') return '';
  // 1. Unify separators to native style
  let n = isWindows ? p.replace(/\//g, '\\') : p.replace(/\\/g, '/');
  // 2. Collapse repeated separators (cheap pass; `C:\\foo\\\\bar` → `C:\foo\bar`)
  //    Note: Windows UNC paths start with `\\server\share` — preserve the leading `\\`
  const uncPrefix = isWindows && n.startsWith('\\\\') ? '\\\\' : '';
  if (uncPrefix.length > 0) {
    n = uncPrefix + n.slice(2).replace(/\\+/g, '\\');
  } else if (isWindows) {
    n = n.replace(/\\+/g, '\\');
  } else {
    n = n.replace(/\/+/g, '/');
  }
  // 3. Strip trailing separator (preserve root form like `C:\` / `/` — min length 4 / 1)
  const minLen = isWindows ? 3 : 1;
  while (n.length > minLen && (n.endsWith('\\') || n.endsWith('/'))) {
    n = n.slice(0, -1);
  }
  // 4. Windows case-fold
  return isWindows ? n.toLowerCase() : n;
}
