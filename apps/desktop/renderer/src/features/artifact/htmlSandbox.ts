import {
  ARTIFACT_PERMISSION_MAX_SOURCES,
  looksLikeInteractiveHtml,
  type ArtifactHtmlPermissionsT,
} from '@kodax-space/space-ipc-schema';

export { looksLikeInteractiveHtml };

export const INTERACTIVE_HTML_CSP = buildInteractiveHtmlCsp();

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function originSource(raw: string): string | null {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function websocketOriginSource(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return `wss://${url.host}`;
  } catch {
    return null;
  }
}

function scriptSource(raw: string): string | null {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function sourceList(sources: readonly string[], fallback: string): string {
  return sources.length > 0 ? unique(sources).join(' ') : fallback;
}

function originList(rawSources: readonly string[] | undefined): string[] {
  return (rawSources ?? [])
    .map(originSource)
    .filter((source): source is string => source !== null);
}

function connectList(rawSources: readonly string[] | undefined): string[] {
  return unique([
    ...originList(rawSources),
    ...(rawSources ?? [])
      .map(websocketOriginSource)
      .filter((source): source is string => source !== null),
  ]);
}

function scriptList(permissions: ArtifactHtmlPermissionsT | undefined): string[] {
  return (permissions?.scripts ?? [])
    .map((entry) => scriptSource(entry.url))
    .filter((source): source is string => source !== null);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function cspMeta(permissions?: ArtifactHtmlPermissionsT): string {
  return `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(buildInteractiveHtmlCsp(permissions))}">`;
}

export function buildInteractiveHtmlCsp(permissions?: ArtifactHtmlPermissionsT): string {
  const scripts = scriptList(permissions);
  const connects = connectList(permissions?.connect);
  const styles = originList(permissions?.style);
  const imgs = originList(permissions?.img);
  const media = originList(permissions?.media);
  const fonts = originList(permissions?.font);
  const forms = originList(permissions?.forms);

  return [
    "default-src 'none'",
    `script-src ${sourceList(["'unsafe-inline'", ...scripts], "'none'")}`,
    `style-src ${sourceList(["'unsafe-inline'", ...styles], "'none'")}`,
    `img-src ${sourceList(['data:', 'blob:', ...imgs], "'none'")}`,
    `font-src ${sourceList(['data:', ...fonts], "'none'")}`,
    `media-src ${sourceList(['data:', 'blob:', ...media], "'none'")}`,
    `connect-src ${sourceList(connects, "'none'")}`,
    "frame-src 'none'",
    "child-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    `form-action ${sourceList(forms, "'none'")}`,
  ].join('; ');
}

export function sandboxForInteractiveHtml(permissions?: ArtifactHtmlPermissionsT): string {
  const tokens = ['allow-scripts'];
  if ((permissions?.forms?.length ?? 0) > 0) tokens.push('allow-forms');
  if (permissions?.popups === 'confirm-external') tokens.push('allow-popups');
  return tokens.join(' ');
}

function stripAttribute(attrs: string, name: string): string {
  const pattern = new RegExp(`\\s+${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'gi');
  return attrs.replace(pattern, '');
}

function srcFromAttributes(attrs: string): string | null {
  return attrFromAttributes(attrs, 'src');
}

function attrFromAttributes(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = attrs.match(
    new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null;
}

function addOrigin(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  const origin = originSource(raw.trim());
  if (origin && target.size < ARTIFACT_PERMISSION_MAX_SOURCES) target.add(origin);
}

function addSrcsetOrigins(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  for (const candidate of raw.split(',')) {
    const url = candidate.trim().split(/\s+/)[0];
    addOrigin(target, url);
  }
}

function isFontUrl(raw: string): boolean {
  try {
    const normalized = raw.startsWith('//') ? `https:${raw}` : raw;
    const url = new URL(normalized);
    return /\.(?:woff2?|ttf|otf|eot)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function permissionsFromSets(sets: {
  style: Set<string>;
  img: Set<string>;
  media: Set<string>;
  font: Set<string>;
}): ArtifactHtmlPermissionsT | undefined {
  const out: ArtifactHtmlPermissionsT = {};
  if (sets.style.size > 0) out.style = Array.from(sets.style);
  if (sets.img.size > 0) out.img = Array.from(sets.img);
  if (sets.media.size > 0) out.media = Array.from(sets.media);
  if (sets.font.size > 0) out.font = Array.from(sets.font);
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Compatibility layer for generated interactive HTML: scripts still cannot add
 * arbitrary network access, but stylesheet/image/media/font URLs already present
 * in the document may load so existing visual artifacts do not collapse.
 */
export function inferPassiveHtmlPermissions(html: string): ArtifactHtmlPermissionsT | undefined {
  const sets = {
    style: new Set<string>(),
    img: new Set<string>(),
    media: new Set<string>(),
    font: new Set<string>(),
  };

  for (const match of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = match[2] ?? '';
    if (tag === 'link') {
      const rel = (attrFromAttributes(attrs, 'rel') ?? '').toLowerCase();
      const as = (attrFromAttributes(attrs, 'as') ?? '').toLowerCase();
      const href = attrFromAttributes(attrs, 'href');
      if (rel.includes('stylesheet') || as === 'style') {
        addOrigin(sets.style, href);
        if (originSource(href ?? '') === 'https://fonts.googleapis.com') {
          addOrigin(sets.font, 'https://fonts.gstatic.com');
        }
      } else if (as === 'font') {
        addOrigin(sets.font, href);
      }
      continue;
    }

    if (tag === 'img' || tag === 'image') {
      addOrigin(sets.img, attrFromAttributes(attrs, 'src'));
      addSrcsetOrigins(sets.img, attrFromAttributes(attrs, 'srcset'));
      continue;
    }

    if (tag === 'video' || tag === 'audio') {
      addOrigin(sets.media, attrFromAttributes(attrs, 'src'));
      addOrigin(sets.img, attrFromAttributes(attrs, 'poster'));
      continue;
    }

    if (tag === 'source') {
      addOrigin(sets.media, attrFromAttributes(attrs, 'src'));
      addSrcsetOrigins(sets.img, attrFromAttributes(attrs, 'srcset'));
    }
  }

  for (const match of html.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'" ]+))\s*\)/gi)) {
    const raw = match[1] ?? match[2] ?? match[3];
    if (!raw) continue;
    addOrigin(isFontUrl(raw) ? sets.font : sets.img, raw);
  }

  return permissionsFromSets(sets);
}

function injectScriptIntegrity(html: string, permissions?: ArtifactHtmlPermissionsT): string {
  const scripts = permissions?.scripts ?? [];
  if (scripts.length === 0) return html;
  const integrityByUrl = new Map(scripts.map((entry) => [entry.url, entry.integrity]));

  return html.replace(/<script\b([^>]*)>/gi, (full, attrs: string) => {
    const src = srcFromAttributes(attrs);
    if (!src) return full;
    const integrity = integrityByUrl.get(src);
    if (!integrity) return full;
    let nextAttrs = stripAttribute(attrs, 'integrity');
    nextAttrs = stripAttribute(nextAttrs, 'crossorigin');
    return `<script${nextAttrs} integrity="${escapeAttribute(integrity)}" crossorigin="anonymous">`;
  });
}

/**
 * Add an in-document CSP to generated interactive HTML. The iframe sandbox
 * supplies the hard process/origin boundary; this CSP keeps generated scripts on
 * an explicit allow-list for network, external scripts, forms, and embeds.
 */
export function buildInteractiveHtmlSrcDoc(
  html: string,
  permissions?: ArtifactHtmlPermissionsT,
): string {
  const htmlWithIntegrity = injectScriptIntegrity(html, permissions);
  const effectivePermissions = permissions ?? inferPassiveHtmlPermissions(html);
  const meta = cspMeta(effectivePermissions);
  const headOpen = htmlWithIntegrity.match(/<head\b[^>]*>/i);
  if (headOpen?.index !== undefined) {
    const insertAt = headOpen.index + headOpen[0].length;
    return `${htmlWithIntegrity.slice(0, insertAt)}${meta}${htmlWithIntegrity.slice(insertAt)}`;
  }

  const htmlOpen = htmlWithIntegrity.match(/<html\b[^>]*>/i);
  if (htmlOpen?.index !== undefined) {
    const insertAt = htmlOpen.index + htmlOpen[0].length;
    return `${htmlWithIntegrity.slice(0, insertAt)}<head>${meta}</head>${htmlWithIntegrity.slice(insertAt)}`;
  }

  return `${meta}${htmlWithIntegrity}`;
}
