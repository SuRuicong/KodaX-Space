// .mcpb installer — F021 (v0.1.3)  + v0.1.3.1 security/correctness patch
//
// v0.1.3.1 修复（详 docs/features/v0.1.3.md F021 安全审计）：
//   - F021-SEC-C2: 顺序解压 + 单 fd + 每 entry 压缩比 ≤ MAX_RATIO（zip bomb 兜底）
//   - F021-SEC-H1: open 一次（fromFd），用 yauzl.fromFd 避免 3 次 open 间 file-swap (TOCTOU)
//   - F021-SEC-H3: 解压后 lstat 每个 entry，是 symlink 直接 reject（archive-symlink 越界）
//   - F021-FUNC-H1: 删 pending[] 并发数组，改成 'entry' handler 完成一个 stream 才 readEntry —
//                   yauzl 文档明确说 openReadStream 不可并发
//
// 流程（重写）：
//   1) fsp.open(filePath) 拿到 fd（其后所有操作都用这个 fd，TOCTOU 关闭）
//   2) yauzl.fromFd(fd) → 顺序扫描所有 entries：
//        - 找 manifest.json 时把内容流到 buffer（< 1MB cap）
//        - 其它 entries 临时缓存（fileName + uncompressed/compressed size）
//   3) parseManifest → 拿到 name + version
//   4) 第二次 yauzl.fromFd 顺序遍历相同 fd（offset=0 由 fromFd 内部 dup 重置），
//      把每个 entry 解压到 installDir，逐个跑 zip-slip / lstat / ratio 守护
//   5) 写 registry —— caller (ipc/mcpb.ts) 负责

import { promises as fsp, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { parseManifest, type ManifestT } from './manifest.js';

const MAX_ENTRIES = 4096;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB extract cap
const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MB
/**
 * 每 entry 的解压/压缩比上限 —— 标准 zip bomb 的核心特征是单文件大幅压缩 (1:1000+)。
 * 100 倍对正常文件（文本 ~3x、二进制 ~1.5x、特殊 archive 嵌套或 sparse JSON 偶尔 ~50x）够用，
 * 远低于 zip bomb 的 1000x+。
 */
const MAX_COMPRESSION_RATIO = 100;

/** 拿 fd → yauzl.fromFd 包一层 promise */
function openZipFromFd(fd: number): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromFd(fd, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('yauzl.fromFd returned no zipfile'));
        return;
      }
      resolve(zip);
    });
  });
}

/**
 * 顺序遍历 entries，调 perEntry handler；handler resolve 后才 readEntry 下一条。
 * yauzl 文档明确：openReadStream MUST NOT be called concurrently for the same zip.
 * 这个工具函数把整个遍历变成"完成一个才推下一个"的串行链。
 */
async function forEachEntrySequential(
  zip: yauzl.ZipFile,
  perEntry: (entry: yauzl.Entry) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let processed = 0;
    let stopped = false;
    const stop = (err: Error): void => {
      if (stopped) return;
      stopped = true;
      reject(err);
    };
    zip.on('entry', (entry: yauzl.Entry) => {
      processed++;
      if (processed > MAX_ENTRIES) {
        stop(new Error(`archive has more than ${MAX_ENTRIES} entries (zip bomb guard)`));
        return;
      }
      perEntry(entry)
        .then(() => {
          if (!stopped) zip.readEntry();
        })
        .catch(stop);
    });
    zip.on('end', () => {
      if (!stopped) resolve();
    });
    zip.on('error', stop);
    zip.readEntry();
  });
}

/** 把 stream 读完成 Buffer，超 maxBytes 立即 destroy 流并 reject */
function readStreamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        stream.destroy(new Error(`entry exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

interface ZipSlipCheck {
  ok: boolean;
  destPath?: string;
  reason?: string;
}

/** zip-slip + symlink-target-path guard */
function safeJoin(extractRoot: string, entryFileName: string): ZipSlipCheck {
  if (entryFileName.length === 0) return { ok: false, reason: 'empty entry name' };
  if (entryFileName.startsWith('/') || entryFileName.startsWith('\\')) {
    return { ok: false, reason: 'absolute path' };
  }
  if (/^[A-Za-z]:[\\/]/.test(entryFileName)) {
    return { ok: false, reason: 'windows drive letter' };
  }
  const segments = entryFileName.split(/[\\/]/);
  if (segments.includes('..')) return { ok: false, reason: 'path traversal' };
  if (segments.some((s) => s === '')) return { ok: false, reason: 'empty segment' };

  const dest = path.resolve(extractRoot, entryFileName);
  const rootWithSep = extractRoot.endsWith(path.sep) ? extractRoot : extractRoot + path.sep;
  if (dest !== extractRoot && !dest.startsWith(rootWithSep)) {
    return { ok: false, reason: 'escapes extract root' };
  }
  return { ok: true, destPath: dest };
}

/**
 * yauzl entry 的外部属性高 16 位包含 stat-style mode；S_IFLNK 在常见 zip 工具
 * （info-zip 系列、Python zipfile）里都按 POSIX 规范写。检测到 symlink 直接 reject。
 * Windows 上 yauzl 仍然能读到 externalFileAttributes，但实际 fs 写出来不会是 symlink，
 * 所以即便 false-positive 也是更安全的拒绝。
 */
function isSymlinkEntry(entry: yauzl.Entry): boolean {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const S_IFLNK = 0o120000;
  const S_IFMT = 0o170000;
  return (mode & S_IFMT) === S_IFLNK;
}

/** 找 manifest.json 并 parse —— 单次顺序扫描，找到立即停（继续 readEntry 但不再读流） */
async function readManifestSequential(zip: yauzl.ZipFile): Promise<ManifestT> {
  let manifest: ManifestT | null = null;
  let parseError: string | null = null;
  await forEachEntrySequential(zip, async (entry) => {
    if (manifest !== null || parseError !== null) return; // 已找到，剩下 entries 不读
    if (entry.fileName !== 'manifest.json') return;
    if (isSymlinkEntry(entry)) {
      parseError = 'manifest.json is a symlink — refusing';
      return;
    }
    const stream = await new Promise<Readable>((res, rej) => {
      zip.openReadStream(entry, (err, s) => {
        if (err || !s) {
          rej(err ?? new Error('openReadStream returned no stream'));
          return;
        }
        res(s);
      });
    });
    const buf = await readStreamToBuffer(stream, MAX_MANIFEST_BYTES);
    const parsed = parseManifest(buf);
    if (parsed.ok) manifest = parsed.manifest;
    else parseError = parsed.error;
  });
  if (parseError !== null) throw new Error(parseError);
  if (manifest === null) throw new Error('manifest.json not found in archive');
  return manifest;
}

interface ExtractAllOptions {
  zip: yauzl.ZipFile;
  extractRoot: string;
}

interface ExtractAllResult {
  fileCount: number;
  totalBytes: number;
}

/**
 * 顺序解压每个 entry → installDir，逐个跑：
 *   1. safeJoin（zip-slip）
 *   2. compression ratio ≤ MAX_COMPRESSION_RATIO
 *   3. totalBytes 累计 ≤ MAX_TOTAL_BYTES（原子 check —— 顺序 + 流内边写边查）
 *   4. 写完 lstat，若是 symlink reject（兜底：archive 标记没标但实际是 symlink）
 */
async function extractAllSequential(opts: ExtractAllOptions): Promise<ExtractAllResult> {
  let fileCount = 0;
  let totalBytes = 0;
  await forEachEntrySequential(opts.zip, async (entry) => {
    const isDir = entry.fileName.endsWith('/');
    const probePath = isDir ? entry.fileName.slice(0, -1) : entry.fileName;
    const slip = safeJoin(opts.extractRoot, probePath);
    if (!slip.ok) {
      throw new Error(`unsafe archive entry "${entry.fileName}": ${slip.reason}`);
    }
    if (isSymlinkEntry(entry)) {
      throw new Error(
        `archive entry "${entry.fileName}" is a symlink — refusing (symlink escape guard)`,
      );
    }
    const destPath = slip.destPath!;

    if (isDir) {
      await fsp.mkdir(destPath, { recursive: true });
      return;
    }

    // 比率守护：用 yauzl 提供的 uncompressedSize / compressedSize 头字段（解压前就能读）
    const u = Number(entry.uncompressedSize ?? 0);
    const c = Number(entry.compressedSize ?? 0);
    if (c > 0 && u / c > MAX_COMPRESSION_RATIO) {
      throw new Error(
        `archive entry "${entry.fileName}" exceeds compression ratio ${MAX_COMPRESSION_RATIO}:1 (${u}/${c}) — zip bomb suspected`,
      );
    }
    if (totalBytes + u > MAX_TOTAL_BYTES) {
      throw new Error(`archive exceeds total extracted size ${MAX_TOTAL_BYTES} bytes`);
    }

    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    const stream = await new Promise<Readable>((res, rej) => {
      opts.zip.openReadStream(entry, (err, s) => {
        if (err || !s) {
          rej(err ?? new Error('openReadStream returned no stream'));
          return;
        }
        res(s);
      });
    });
    let entryBytes = 0;
    stream.on('data', (chunk: Buffer) => {
      entryBytes += chunk.length;
      if (entryBytes > u + 1024 || totalBytes + entryBytes > MAX_TOTAL_BYTES) {
        // 头声明的 u 是上限；超 1KB tolerance 表示头被伪造 (zip-bomb 伎俩) → kill
        stream.destroy(
          new Error(`archive entry "${entry.fileName}" exceeds declared uncompressedSize`),
        );
      }
    });
    await pipeline(stream, createWriteStream(destPath));
    totalBytes += entryBytes;
    fileCount++;

    // 写完再 lstat —— 兜底防 archive symlink 标志位漏检
    const st = await fsp.lstat(destPath);
    if (st.isSymbolicLink()) {
      throw new Error(`extracted entry "${entry.fileName}" became a symlink — refusing`);
    }
  });
  return { fileCount, totalBytes };
}

/** 读 manifest 不解压全部 archive —— 用单 fd / 顺序扫描，无 TOCTOU */
export async function readManifestOnly(filePath: string): Promise<ManifestT> {
  const fileHandle = await fsp.open(filePath, 'r');
  try {
    const zip = await openZipFromFd(fileHandle.fd);
    try {
      return await readManifestSequential(zip);
    } finally {
      zip.close();
    }
  } finally {
    await fileHandle.close();
  }
}

export interface InstallResult {
  manifest: ManifestT;
  installDir: string;
  fileCount: number;
  totalBytes: number;
}

/**
 * 完整安装：
 *   1. 把用户 filePath copy 到 SPACE_HOME/tmp/<random>.mcpb （TOCTOU close — 后续操作都对副本）
 *   2. 对副本 open fd, 第一遍读 manifest
 *   3. mkdir installDir（先 rm 旧的 → 升级语义；caller 在 registry 层负责回收旧 install dir）
 *   4. 同一个 fd 上 fromFd 第二次（重新 open 一次 zip header），顺序解压
 *   5. 解压成功后 rm tmp copy
 *
 * 失败时 installDir 已 mkdir 但 partial 状态 —— caller 负责 cleanup。tmp copy 总是 cleanup。
 */
export async function installMcpb(
  filePath: string,
  baseDir: string,
  tmpDir: string,
): Promise<InstallResult> {
  const abs = path.resolve(filePath);
  // 不让 caller 用相对路径绕过 sandbox guard；也不让指到 baseDir 内部（自己安装自己）
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('mcpb file not found');
  if (stat.size > MAX_TOTAL_BYTES) {
    throw new Error(`mcpb file too large (${stat.size} bytes > ${MAX_TOTAL_BYTES})`);
  }
  const baseResolved = path.resolve(baseDir) + path.sep;
  if (abs.startsWith(baseResolved)) {
    throw new Error('mcpb filePath must not be inside the install base directory');
  }

  // 1) TOCTOU 防御：copy 到 tmp 区，所有后续解析都对副本做。
  //    名字用 epoch ms + 进程 pid + counter 防同进程并发（main 单例 + IPC 串行已经够，但便宜）
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmpName = `install-${process.pid}-${Date.now()}-${(installCounter++).toString(36)}.mcpb`;
  const tmpPath = path.join(tmpDir, tmpName);
  await fsp.copyFile(abs, tmpPath);

  try {
    // 2) 读 manifest（在副本上 — 没 TOCTOU 风险）
    const manifest = await readManifestOnly(tmpPath);

    const slug = `${manifest.name}@${manifest.version}`.replace(/[^A-Za-z0-9._@-]/g, '_');
    const installDir = path.join(baseDir, slug);

    // 3) 升级 / 重装 —— 旧目录先删
    await fsp.rm(installDir, { recursive: true, force: true });
    await fsp.mkdir(installDir, { recursive: true });

    // 4) 全量顺序解压（仍用副本 fd）
    const fileHandle = await fsp.open(tmpPath, 'r');
    let stats: ExtractAllResult;
    try {
      const zip = await openZipFromFd(fileHandle.fd);
      try {
        stats = await extractAllSequential({ zip, extractRoot: installDir });
      } finally {
        zip.close();
      }
    } finally {
      await fileHandle.close();
    }
    return { manifest, installDir, ...stats };
  } finally {
    // 5) 总是清理 tmp copy（即便后续 extract 失败也不留盘）
    await fsp.rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

let installCounter = 0;
