// CSP 相关常量。
// 抽到独立文件 因为单测要 import 但不能拖 electron 模块进 node:test 环境。

/**
 * apps/desktop/index.html 头部 inline theme-bootstrap 脚本的 sha256 base64 hash。
 *
 * 注入到 prod CSP `script-src` 让浏览器允许该 inline 脚本跑。
 * 改 inline 脚本任何字节，hash 都要重算。
 *
 * 防漂移单测：apps/desktop/electron/test/csp-inline-hash.test.ts
 */
export const THEME_BOOTSTRAP_INLINE_HASH =
  'sha256-QYRn3eir70BMmvTzcpqvdZHyF/bv4JruA39O8NJpCEo=';
