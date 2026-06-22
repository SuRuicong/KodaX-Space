// URL guard for renderer-supplied custom-provider baseUrl.
//
// Default mode is conservative because provider tests send the user's API key to
// this URL: require https, reject IP/localhost/private-looking hostnames, and
// allow only standard reverse-proxy ports.
//
// Trusted/internal mode is explicit: callers pass skipValidation=true. That path
// only trims whitespace and one trailing slash so enterprise gateways like
// http://10.8.0.12:8080/v1, localhost labs, or IP:port endpoints continue to
// work when the user deliberately opts out of Space URL safety checks.
const ALLOWED_PORTS = new Set([443, 8443]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  '.local',
  '.internal',
  '.lan',
  '.corp',
  '.intranet',
  '.private',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata.azure.com',
]);

/** IPv4 字面量：四段十进制。*/
const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** IPv6 字面量（粗略）：含 `:` 字符的合法 hostname。URL 解析会自动套上 `[]`。*/
function isIPv6Literal(host: string): boolean {
  return host.startsWith('[') && host.endsWith(']');
}

export interface UrlValidation {
  readonly ok: boolean;
  readonly normalizedUrl?: string;
  readonly error?: string;
}

export interface UrlValidationOptions {
  readonly skipValidation?: boolean;
}

function normalizeUncheckedBaseUrl(input: string): UrlValidation {
  // Trusted/internal mode: callers explicitly opted out of Space URL safety
  // checks. Keep this path format-light so http://IP:port gateways work.
  const normalizedUrl = input.trim().replace(/\/$/, '');
  if (normalizedUrl.length === 0) {
    return { ok: false, error: 'empty URL' };
  }
  return { ok: true, normalizedUrl };
}

/**
 * 校验 + normalize 用户提供的 baseUrl。
 *
 * 接受：`https://api.example.com/v1` / `https://api.example.com/v1/`
 * 拒绝：`http://...`（C1+M2）、IP 字面量、内网 hostname、非标准端口
 *
 * normalizedUrl：去掉 trailing slash，便于后续 `${baseUrl}/models` 拼接。
 */
export function validateBaseUrl(
  input: string,
  options: UrlValidationOptions = {},
): UrlValidation {
  if (options.skipValidation === true) return normalizeUncheckedBaseUrl(input);

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: 'invalid URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'only https:// URLs are allowed (cleartext API keys are not permitted)' };
  }

  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) {
    return { ok: false, error: 'empty hostname' };
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: `hostname blocked: ${host}` };
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (host.endsWith(suffix)) {
      return { ok: false, error: `hostname suffix blocked: ${suffix}` };
    }
  }

  // 拒绝 IP 字面量——内网范围太多不可枚举（10/8, 172.16/12, 192.168/16, link-local
  // 169.254/16, loopback 127/8, CGNAT 100.64/10, multicast, 等）。
  // 用户合法的内网网关也不该走这条路（应该装个内部 https reverse-proxy）。
  if (IPV4_LITERAL.test(host)) {
    return { ok: false, error: 'IP address literals are not allowed (use a hostname)' };
  }
  if (isIPv6Literal(parsed.hostname)) {
    return { ok: false, error: 'IPv6 address literals are not allowed (use a hostname)' };
  }

  // port：URL 解析后空字符串 = 默认端口（443 for https），允许；显式端口必须在白名单
  if (parsed.port !== '') {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || !ALLOWED_PORTS.has(portNum)) {
      return { ok: false, error: `port ${parsed.port} is not allowed (use 443 or 8443)` };
    }
  }

  // normalize：去掉 trailing slash 但保留路径
  const normalizedUrl = parsed.toString().replace(/\/$/, '');
  return { ok: true, normalizedUrl };
}
