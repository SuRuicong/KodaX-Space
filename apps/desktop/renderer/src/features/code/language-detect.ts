// 从文件扩展名推断 Monaco language id（用于语法高亮）。F009 内只接最常见的几种——
// Monaco 内置的 ~60 种 language 不全启用，简化包大小 + UI 一致性。

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'plaintext',
  xml: 'xml',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  ini: 'ini',
  dockerfile: 'dockerfile',
};

export function languageFromPath(filePath: string): string {
  // basename 后面的扩展名；处理 .gitignore 这种没有 ext 的也直接 plaintext
  const lower = filePath.toLowerCase();
  const basename = lower.split('/').pop() ?? '';
  if (basename === 'dockerfile') return 'dockerfile';
  const dot = basename.lastIndexOf('.');
  if (dot < 0) return 'plaintext';
  const ext = basename.slice(dot + 1);
  return EXT_TO_LANG[ext] ?? 'plaintext';
}
