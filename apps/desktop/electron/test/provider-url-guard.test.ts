// URL guard tests — review C1 SSRF + M2 HTTPS-only + M3 baseUrl normalize
//
// 防御重点：renderer 提交的 custom baseUrl 必须挡住 SSRF 和明文 key 风险：
//   - https:// 必填
//   - IP literal 禁止
//   - 内网 hostname 禁止
//   - 非标准端口禁止

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl } from '../providers/url-guard.js';

// --- 接受合法 URL ---

test('accepts https://api.example.com/v1', () => {
  const r = validateBaseUrl('https://api.example.com/v1');
  assert.equal(r.ok, true);
  assert.equal(r.normalizedUrl, 'https://api.example.com/v1');
});

test('strips trailing slash from normalizedUrl', () => {
  const r = validateBaseUrl('https://api.example.com/v1/');
  assert.equal(r.ok, true);
  assert.equal(r.normalizedUrl, 'https://api.example.com/v1');
});

test('accepts standard port 443 explicit', () => {
  const r = validateBaseUrl('https://api.example.com:443/v1');
  assert.equal(r.ok, true);
});

test('accepts 8443 (common reverse-proxy port)', () => {
  const r = validateBaseUrl('https://api.example.com:8443/v1');
  assert.equal(r.ok, true);
});

// --- C1 SSRF: block IP literals ---

test('rejects IPv4 literal (AWS metadata endpoint)', () => {
  const r = validateBaseUrl('https://169.254.169.254/latest/meta-data');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /IP/);
});

test('rejects loopback 127.0.0.1', () => {
  const r = validateBaseUrl('https://127.0.0.1/v1');
  assert.equal(r.ok, false);
});

test('rejects private 10.0.0.1', () => {
  const r = validateBaseUrl('https://10.0.0.1/v1');
  assert.equal(r.ok, false);
});

test('rejects private 192.168.1.1', () => {
  const r = validateBaseUrl('https://192.168.1.1/v1');
  assert.equal(r.ok, false);
});

test('rejects IPv6 literal', () => {
  const r = validateBaseUrl('https://[::1]/v1');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /IPv6/);
});

// --- C1: block internal hostnames ---

test('rejects localhost hostname', () => {
  const r = validateBaseUrl('https://localhost/v1');
  assert.equal(r.ok, false);
});

test('rejects .local suffix', () => {
  const r = validateBaseUrl('https://server.local/v1');
  assert.equal(r.ok, false);
});

test('rejects .internal suffix', () => {
  const r = validateBaseUrl('https://api.internal/v1');
  assert.equal(r.ok, false);
});

test('rejects metadata.google.internal', () => {
  const r = validateBaseUrl('https://metadata.google.internal/v1');
  assert.equal(r.ok, false);
});

// --- C1: block non-standard ports ---

test('rejects port 8080', () => {
  const r = validateBaseUrl('https://api.example.com:8080/v1');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /port/);
});

test('rejects port 4444', () => {
  const r = validateBaseUrl('https://api.example.com:4444/v1');
  assert.equal(r.ok, false);
});

// --- M2-sec: HTTPS only ---

test('rejects http:// scheme (cleartext key)', () => {
  const r = validateBaseUrl('http://api.example.com/v1');
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /https/);
});

test('rejects file:// scheme', () => {
  const r = validateBaseUrl('file:///etc/passwd');
  assert.equal(r.ok, false);
});

test('rejects javascript: scheme', () => {
  const r = validateBaseUrl('javascript:alert(1)');
  assert.equal(r.ok, false);
});

// --- malformed input ---

test('rejects empty string', () => {
  const r = validateBaseUrl('');
  assert.equal(r.ok, false);
});

test('rejects garbage', () => {
  const r = validateBaseUrl('not a url at all');
  assert.equal(r.ok, false);
});

test('skipValidation accepts unchecked internal http URL', () => {
  const r = validateBaseUrl(' http://122.1.23.23/a/b/v1/ ', { skipValidation: true });
  assert.equal(r.ok, true);
  assert.equal(r.normalizedUrl, 'http://122.1.23.23/a/b/v1');
});

test('skipValidation accepts unchecked internal http IP with explicit port', () => {
  const r = validateBaseUrl(' http://10.8.0.12:8080/v1/ ', { skipValidation: true });
  assert.equal(r.ok, true);
  assert.equal(r.normalizedUrl, 'http://10.8.0.12:8080/v1');
});

