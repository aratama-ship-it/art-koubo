import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(TEST_DIR, '..');
const SNAPSHOT_PATH = join(TEST_DIR, 'golden-build.sha256.json');
const REFERENCE_DATE = '2026-10-01T03:00:00+09:00';

function htmlFilesUnder(dir) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
    }
  };
  visit(dir);
  return files.sort();
}

function buildSnapshot(outputDir) {
  const files = Object.fromEntries(htmlFilesUnder(outputDir).map((path) => [
    relative(outputDir, path).split('\\').join('/'),
    createHash('sha256').update(readFileSync(path)).digest('hex'),
  ]));
  return { referenceDate: REFERENCE_DATE, htmlCount: Object.keys(files).length, files };
}

test('固定基準日の生成HTMLがgolden snapshotと一致する', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'art-koubo-golden-'));
  const outputDir = join(tempRoot, 'site');
  try {
    const result = spawnSync(process.execPath, ['build.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        BUILD_OUTPUT_DIR: outputDir,
        BUILD_REFERENCE_DATE: REFERENCE_DATE,
        BUILD_SHA: '',
      },
    });
    assert.equal(result.status, 0, `build failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

    const actual = buildSnapshot(outputDir);
    // 更新手順: UPDATE_GOLDEN_BUILD_SNAPSHOT=1 node --test tests/golden-build.test.mjs
    if (process.env.UPDATE_GOLDEN_BUILD_SNAPSHOT === '1') {
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
    assert.deepEqual(actual, expected);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
