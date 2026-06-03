// SSRF / scheme guard for renderer-supplied baseUrl — review C1 + M2-sec (2026-05-17)
//
// Threat: 用户（被 LLM 诱导）或被攻陷的 renderer 添加自定义 provider 时填
// `http://169.254.169.254/...`（AWS metadata endpoint） 或 `http://attacker.com`，
// 然后点 Test connection——main 会用用户的 API key 作 Authorization 头去请求那个 URL，
// **把 key 泄给攻击者控制的端点**。
//
// 防御层：
//   1) 仅允许 https://（cleartext key 是不可接受的）
//   2) 解析后的 hostname 不允许是：
//      - 数字 IP（IPv4 / IPv6 字面量）—— 内部网段太多无法穷举，干脆全禁
//      - localhost / *.localhost / 0.0.0.0
//      - private suffixes（.local / .internal / .lan / .corp 等）
//   3) port 限制：标准 https 端口（443）或常见 reverse-proxy 端口（8443）；
//      其余端口都拦——4444/8000/8080/9000 等是常见内网服务
//
// 备注：
//   - 这是 defense-in-depth，不是绝对安全。攻击者控制公网域名 + 反向解析到内网是另一层威胁
//     （SSRF via DNS rebinding），需要在 fetch 时再校验解析后的 IP——本期不做（fetch 用 keep-alive，
//     重新 resolve 涉及 socket-level 拦截，超出 alpha 范围）
//   - 这个 guard 的调用点：addCustom IPC handler（持久化前校验用户填的 baseUrl）。
//     （测连接已改走 SDK verifyProviderCredential，不再在 Space 侧拼 probe URL。）

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

/**
 * 校验 + normalize 用户提供的 baseUrl。
 *
 * 接受：`https://api.example.com/v1` / `https://api.example.com/v1/`
 * 拒绝：`http://...`（C1+M2）、IP 字面量、内网 hostname、非标准端口
 *
 * normalizedUrl：去掉 trailing slash，便于后续 `${baseUrl}/models` 拼接。
 */
export function validateBaseUrl(input: string): UrlValidation {
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
