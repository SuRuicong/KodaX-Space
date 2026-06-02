// .mcpb installer — F021 (v0.1.3)
//
// 流程：
//   1) yauzl.open file path
//   2) 第一遍扫 entries 找 manifest.json，buffer 读出
//   3) parseManifest → 拿到 name + version + server
//   4) 第二遍扫 entries 解压到 ~/.kodax-space/mcpb/<name>-<version>/
//      - 每个 entry 都过 zip-slip guard
//      - 限制总文件数 + 总解压字节数（防 zip bomb）
//   5) 写 registry.json 记录这次安装
//
// 安全：
//   - zip-slip: 计算 destPath = path.resolve(extractRoot, entry.fileName) 后
//     必须以 extractRoot + sep 起始；否则 reject
//   - 拒绝 absolute path entry / Windows drive letter / '..' segment
//   - MAX_ENTRIES / MAX_BYTES 兜底防 zip bomb (1 GB extract 上限)
//   - manifest.json 大小上限 1MB（防恶意 manifest 撑爆 V8 string）
//   - 已存在同名 extension 目录 → 先递归删旧再解压新（升级）

import { promises as fsp, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { parseManifest, type ManifestT } from './manifest.js';

const MAX_ENTRIES = 4096;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // 1 GB extract cap
const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MB

function openZip(filePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error('yauzl.open returned no zipfile'));
        return;
      }
      resolve(zip);
    });
  });
}

function readEntryToBuffer(zip: yauzl.ZipFile, entry: yauzl.Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('openReadStream returned no stream'));
        return;
      }
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
  });
}

/** 找到 manifest.json 的 entry —— 严格在 archive root 下，不是 subfolder/manifest.json */
async function findManifestEntry(zip: yauzl.ZipFile): Promise<yauzl.Entry> {
  return new Promise((resolve, reject) => {
    let found: yauzl.Entry | null = null;
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName === 'manifest.json' && !entry.fileName.endsWith('/')) {
        found = entry;
        // don't continue reading; we have what we need
        // close will fire 'close' event; resolve from 'close' handler
        zip.close();
        return;
      }
      zip.readEntry();
    });
    zip.on('end', () => {
      if (found) resolve(found);
      else reject(new Error('manifest.json not found in archive root'));
    });
    zip.on('close', () => {
      if (found) resolve(found);
      else reject(new Error('archive closed before manifest.json found'));
    });
    zip.on('error', reject);
    zip.readEntry();
  });
}

interface ZipSlipCheck {
  ok: boolean;
  destPath?: string;
  reason?: string;
}

/** zip-slip guard：返回 ok+destPath 或 ok=false+reason */
function safeJoin(extractRoot: string, entryFileName: string): ZipSlipCheck {
  if (entryFileName.length === 0) return { ok: false, reason: 'empty entry name' };
  if (entryFileName.startsWith('/') || entryFileName.startsWith('\\')) {
    return { ok: false, reason: 'absolute path' };
  }
  if (/^[A-Za-z]:[\\/]/.test(entryFileName)) {
    return { ok: false, reason: 'windows drive letter' };
  }
  // 规范化分隔符做 segment 检查
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

interface ExtractAllOptions {
  filePath: string;
  extractRoot: string;
}

interface ExtractAllResult {
  fileCount: number;
  totalBytes: number;
}

/** 把 archive 所有 entry 解压到 extractRoot —— 完成后 stat、totalBytes 返回 */
async function extractAll(opts: ExtractAllOptions): Promise<ExtractAllResult> {
  const zip = await openZip(opts.filePath);
  let fileCount = 0;
  let totalBytes = 0;
  return new Promise<ExtractAllResult>((resolve, reject) => {
    const pending: Array<Promise<void>> = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      if (fileCount >= MAX_ENTRIES) {
        zip.close();
        reject(new Error(`archive has more than ${MAX_ENTRIES} entries (zip bomb guard)`));
        return;
      }
      const isDir = entry.fileName.endsWith('/');
      const slip = safeJoin(opts.extractRoot, isDir ? entry.fileName.slice(0, -1) : entry.fileName);
      if (!slip.ok) {
        zip.close();
        reject(new Error(`unsafe archive entry "${entry.fileName}": ${slip.reason}`));
        return;
      }
      const destPath = slip.destPath!;
      if (isDir) {
        pending.push(fsp.mkdir(destPath, { recursive: true }).then(() => undefined));
        zip.readEntry();
        return;
      }
      const remainingBudget = MAX_TOTAL_BYTES - totalBytes;
      const task = (async () => {
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        await new Promise<void>((res, rej) => {
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              rej(err ?? new Error('openReadStream returned no stream'));
              return;
            }
            let entryBytes = 0;
            stream.on('data', (chunk: Buffer) => {
              entryBytes += chunk.length;
              totalBytes += chunk.length;
              if (entryBytes > remainingBudget || totalBytes > MAX_TOTAL_BYTES) {
                stream.destroy(new Error('archive exceeds total byte budget'));
              }
            });
            void pipeline(stream as Readable, createWriteStream(destPath))
              .then(() => {
                fileCount++;
                res();
              })
              .catch((streamErr) => rej(streamErr));
          });
        });
      })();
      pending.push(task);
      zip.readEntry();
    });
    zip.on('end', () => {
      Promise.all(pending)
        .then(() => resolve({ fileCount, totalBytes }))
        .catch(reject);
    });
    zip.on('error', reject);
    zip.readEntry();
  });
}

/** 读 manifest 不解压全部 archive —— 安装前 dry-run / 验证用 */
export async function readManifestOnly(filePath: string): Promise<ManifestT> {
  const zip = await openZip(filePath);
  const entry = await findManifestEntry(zip);
  // findManifestEntry 内部已 close —— 但 openReadStream 必须在 readEntry 流上调
  // 重新 open 一次拿 stream
  const zip2 = await openZip(filePath);
  const buf = await new Promise<Buffer>((resolve, reject) => {
    let found = false;
    zip2.on('entry', (e: yauzl.Entry) => {
      if (e.fileName === entry.fileName) {
        found = true;
        readEntryToBuffer(zip2, e, MAX_MANIFEST_BYTES)
          .then((b) => {
            zip2.close();
            resolve(b);
          })
          .catch((err) => {
            zip2.close();
            reject(err);
          });
        return;
      }
      zip2.readEntry();
    });
    zip2.on('end', () => {
      if (!found) reject(new Error('manifest.json not found on second scan'));
    });
    zip2.on('error', reject);
    zip2.readEntry();
  });
  const parsed = parseManifest(buf);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.manifest;
}

export interface InstallResult {
  manifest: ManifestT;
  installDir: string;
  fileCount: number;
  totalBytes: number;
}

/**
 * 完整安装：解压 archive → 验 manifest → 返回安装目录 + 文件统计。
 * 失败时 installDir 已 mkdir 但 partial 状态 —— caller 负责 cleanup (rm -rf)。
 */
export async function installMcpb(filePath: string, baseDir: string): Promise<InstallResult> {
  const abs = path.resolve(filePath);
  // 不让 caller 用相对路径绕过 sandbox guard
  const stat = await fsp.stat(abs).catch(() => null);
  if (!stat || !stat.isFile()) throw new Error('mcpb file not found');
  if (stat.size > MAX_TOTAL_BYTES) {
    throw new Error(`mcpb file too large (${stat.size} bytes > ${MAX_TOTAL_BYTES})`);
  }

  // 1) 先 dry-run 拿 manifest，决定 install dir
  const manifest = await readManifestOnly(abs);
  const slug = `${manifest.name}@${manifest.version}`.replace(/[^A-Za-z0-9._@\-]/g, '_');
  const installDir = path.join(baseDir, slug);

  // 2) 升级 / 重装 —— 旧目录先删
  await fsp.rm(installDir, { recursive: true, force: true });
  await fsp.mkdir(installDir, { recursive: true });

  // 3) 全量解压
  const stats = await extractAll({ filePath: abs, extractRoot: installDir });
  return { manifest, installDir, ...stats };
}
