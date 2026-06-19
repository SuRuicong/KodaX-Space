// Guard env var names before they become process.env write targets.
//
// API keys may be injected into process.env for SDK compatibility. Provider
// config therefore must not be allowed to choose process/runtime control vars.

const RESERVED_ENV_VARS = new Set([
  'PATH',
  'NODE_OPTIONS',
  'NODE_PATH',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
  'PYTHONPATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
]);

export function validateApiKeyEnv(name: string): string | null {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name)) {
    return 'apiKeyEnv must match /^[A-Z_][A-Z0-9_]*$/ (uppercase snake)';
  }
  if (RESERVED_ENV_VARS.has(name)) {
    return `apiKeyEnv "${name}" is reserved and cannot be used`;
  }
  return null;
}
