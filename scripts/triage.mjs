#!/usr/bin/env node

// 身体芸術・公募ものさしの確認順を決める読み取り専用ツール。
// データは変更せず、優先度・理由・推奨確認日だけを標準出力へ返す。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_DATA = join(ROOT, 'data/koubo.data.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const THIN_GENRES = new Set(['美術', '映像', '文芸・戯曲']);

const REASONS = {
  'open-but-ended': '受付中フラグなのに締切・募集終了の表記がある',
  'closed-but-open': '受付終了フラグなのに受付中・募集中の表記がある',
  'open-after-deadline': '受付中フラグのまま明示締切を過ぎている',
  'mixed-open-ended': '一部受付中・一部締切済みが同じ欄に混在',
  'currently-open': '現在受付中',
  'deadline-within-7-days': '明示締切まで7日以内',
  'deadline-within-30-days': '明示締切まで30日以内',
  'open-stale-21-days': '受付中なのに最終確認から21日超',
  'open-stale-14-days': '受付中なのに最終確認から14日超',
  'verification-overdue': '想定確認間隔を超過',
  'annual-window-near': '例年の募集時期が近い',
  'rolling': '随時・通年募集',
  'money-reward': '報酬・賞金分類は誤表示時の影響が大きい',
  'money-paid': '参加費分類は誤表示時の影響が大きい',
  'money-unknown': '費用区分が未確認',
  'thin-genre': '掲載の薄いジャンル',
};

function todayInTokyo() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function parseDateOnly(value, label = 'date') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(`${label} must be YYYY-MM-DD: ${value}`);
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error(`invalid ${label}: ${value}`);
  }
  return ms;
}

function toDateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  return toDateOnly(parseDateOnly(dateText) + days * DAY_MS);
}

function daysBetween(fromText, toText) {
  return Math.floor((parseDateOnly(toText) - parseDateOnly(fromText)) / DAY_MS);
}

function normalizeDeadline(text) {
  return String(text || '').normalize('NFKC').replace(/令和(\d+)年/g, (_, year) => `${2018 + Number(year)}年`);
}

// 締切の自動更新には使わない。トリアージ専用の保守的な抽出。
// 「締切・必着・消印・申込」等が同じ短い文節にある、年が明示された日付だけを採用する。
function extractExplicitDeadline(text) {
  const normalized = normalizeDeadline(text);
  const tokens = [];
  let carriedYear = null;
  const re = /(?:(20\d{2})年)?(\d{1,2})(?:月|\/)(\d{1,2})日?/g;
  for (const match of normalized.matchAll(re)) {
    if (match[1]) carriedYear = Number(match[1]);
    if (!carriedYear) continue;
    const before = normalized.slice(Math.max(0, match.index - 24), match.index);
    const after = normalized.slice(match.index + match[0].length, match.index + match[0].length + 28);
    const deadlineMarkerAfter = /締切|必着|消印|申込|応募期限|エントリー/.test(after);
    const rangeMarkerBefore = /公募期間|応募期間|申込期間|エントリー期間|★受付中|★募集中/.test(before);
    // 範囲の先頭や告知・受付開始日は、後方に「締切」があっても締切日として扱わない。
    if (/^\s*(?:〜|～|-|から)/.test(after)) continue;
    if (!deadlineMarkerAfter && /^\s*(?:告知|発表|掲載|募集開始|受付開始)/.test(after)) continue;
    if (!deadlineMarkerAfter && !rangeMarkerBefore) continue;
    if (/^(?:[^。]{0,8})(?:開催|本番|公演|大会)/.test(after) && !deadlineMarkerAfter) continue;
    const month = Number(match[2]);
    const day = Number(match[3]);
    const value = `${carriedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).getUTCMonth() + 1 !== month || new Date(ms).getUTCDate() !== day) continue;
    tokens.push(value);
  }
  return tokens.sort().at(-1) || null;
}

function isNearExpectedWindow(text, todayText) {
  const normalized = normalizeDeadline(text);
  const match = normalized.match(/(?:例年|次回[^。]{0,20})(\d{1,2})月/);
  if (!match) return false;
  const expectedMonth = Number(match[1]);
  const todayMonth = Number(todayText.slice(5, 7));
  const monthDistance = Math.min((expectedMonth - todayMonth + 12) % 12, (todayMonth - expectedMonth + 12) % 12);
  return monthDistance <= 1;
}

function bucketFor(score) {
  if (score >= 900) return 'P0';
  if (score >= 70) return 'P1';
  if (score >= 40) return 'P2';
  if (score >= 20) return 'P3';
  return 'hold';
}

function priority(k, todayText) {
  const text = normalizeDeadline(k.deadline);
  const reasons = [];
  const saysEnded = /終了済|募集終了|締切済|受付終了|終了しました/.test(text);
  const saysOpen = /★(?:受付中|募集中)|^(?:受付中|募集中)/.test(text);
  const rolling = /随時|通年|常時/.test(text);
  const explicitDeadline = extractExplicitDeadline(text);
  const annualWindow = isNearExpectedWindow(text, todayText);
  const ageDays = /^\d{4}-\d{2}-\d{2}$/.test(k.verified || '') ? daysBetween(k.verified, todayText) : null;

  if (k.dlOpen && saysEnded && !saysOpen) {
    return result(999, ['open-but-ended'], explicitDeadline, ageDays, todayText);
  }
  if (!k.dlOpen && saysOpen) {
    return result(999, ['closed-but-open'], explicitDeadline, ageDays, todayText);
  }
  if (k.dlOpen && explicitDeadline && daysBetween(todayText, explicitDeadline) < 0) {
    return result(999, ['open-after-deadline'], explicitDeadline, ageDays, todayText);
  }

  let score = 0;
  if (k.dlOpen) { score += 50; reasons.push('currently-open'); }
  if (k.dlOpen && saysEnded && saysOpen) reasons.push('mixed-open-ended');

  let expectedInterval = 90;
  if (k.dlOpen && explicitDeadline && daysBetween(todayText, explicitDeadline) <= 30) expectedInterval = 7;
  else if (k.dlOpen) expectedInterval = 14;
  else if (rolling) expectedInterval = 30;
  else if (annualWindow) expectedInterval = 14;

  if (ageDays !== null) {
    const overdueAge = Math.max(0, ageDays - expectedInterval);
    if (overdueAge > 0) reasons.push('verification-overdue');
    score += Math.min(40, Math.floor(overdueAge / 7) * 5);
    if (k.dlOpen && ageDays > 21) { score += 50; reasons.push('open-stale-21-days'); }
    else if (k.dlOpen && ageDays > 14) { score += 20; reasons.push('open-stale-14-days'); }
  }

  if (k.dlOpen && explicitDeadline) {
    const remaining = daysBetween(todayText, explicitDeadline);
    if (remaining <= 7) { score += 30; reasons.push('deadline-within-7-days'); }
    else if (remaining <= 30) { score += 15; reasons.push('deadline-within-30-days'); }
  }
  if (!k.dlOpen && annualWindow) { score += 25; reasons.push('annual-window-near'); }
  if (rolling) { score += 8; reasons.push('rolling'); }
  if (k.money === 'reward') { score += 15; reasons.push('money-reward'); }
  if (k.money === 'paid') { score += 12; reasons.push('money-paid'); }
  if (k.money === 'unknown') { score += 5; reasons.push('money-unknown'); }
  if ((k.genres || []).some((g) => THIN_GENRES.has(g))) { score += 8; reasons.push('thin-genre'); }

  return result(score, reasons, explicitDeadline, ageDays, todayText, { rolling, annualWindow });
}

function result(score, reasons, explicitDeadline, ageDays, todayText, flags = {}) {
  let nextCheck;
  if (score >= 900) nextCheck = todayText;
  else if (explicitDeadline) {
    const remaining = daysBetween(todayText, explicitDeadline);
    if (remaining <= 7) nextCheck = addDays(explicitDeadline, 1);
    else if (remaining <= 30) nextCheck = addDays(todayText, 7);
    else nextCheck = addDays(todayText, 14);
  } else if (flags.rolling) nextCheck = addDays(todayText, 30);
  else if (flags.annualWindow) nextCheck = addDays(todayText, 14);
  else nextCheck = addDays(todayText, 90);
  return { score, bucket: bucketFor(score), reasons, explicitDeadline, ageDays, nextCheck };
}

function triage(records, todayText) {
  parseDateOnly(todayText, 'today');
  const items = records.map((k) => ({
    id: k.id,
    name: k.name,
    region: k.region,
    deadline: k.deadline,
    dlOpen: Boolean(k.dlOpen),
    verified: k.verified,
    src: k.src,
    ...priority(k, todayText),
  })).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0, hold: 0 };
  for (const item of items) counts[item.bucket] += 1;
  return { generatedAt: todayText, total: records.length, counts, items };
}

function parseArgs(argv) {
  const args = { date: todayInTokyo(), limit: 30, format: 'text', data: DEFAULT_DATA, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') args.date = argv[++i];
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--format') args.format = argv[++i];
    else if (arg === '--data') args.data = argv[++i];
    else if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--help') args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) throw new Error('--limit must be a positive integer');
  if (!['text', 'json'].includes(args.format)) throw new Error('--format must be text or json');
  return args;
}

function printText(report, limit) {
  console.log(`身体芸術・公募ものさし トリアージ基準日: ${report.generatedAt}`);
  console.log(`総数 ${report.total} / P0 ${report.counts.P0} / P1 ${report.counts.P1} / P2 ${report.counts.P2} / P3 ${report.counts.P3} / 保留 ${report.counts.hold}`);
  console.log(`上位 ${Math.min(limit, report.items.length)} 件（データは変更していません）`);
  for (const [index, item] of report.items.slice(0, limit).entries()) {
    const why = item.reasons.map((reason) => REASONS[reason] || reason).join(' / ');
    console.log(`${String(index + 1).padStart(2, '0')}. [${item.bucket}] ${item.id} | ${item.score}点 | 次回確認 ${item.nextCheck}`);
    console.log(`    ${item.name}`);
    console.log(`    理由: ${why || '定期確認'}`);
    if (item.explicitDeadline) console.log(`    機械抽出した締切候補: ${item.explicitDeadline}（確認順の計算専用）`);
  }
}

function runSelfTest() {
  const base = {
    id: 'x', name: 'test', region: '東京都', money: 'unknown', genres: ['演劇'],
    verified: '2026-07-18', src: 'https://example.com/', conditions: ['test'], type: 'test', moneyLabel: '要確認',
  };
  assert.equal(extractExplicitDeadline('★受付中（2026年7月1日〜7月31日必着）'), '2026-07-31');
  assert.equal(extractExplicitDeadline('本番は2026年9月13日開催'), null);
  assert.equal(extractExplicitDeadline('★受付中（2026年6月15日〜定員になり次第締切）'), null);
  assert.equal(extractExplicitDeadline('★受付中（2026年6月25日告知の追加募集）'), null);
  assert.throws(() => parseDateOnly('2026-02-31'));
  assert.equal(priority({ ...base, dlOpen: true, deadline: '2026年7月18日締切（終了済み）' }, '2026-07-19').bucket, 'P0');
  assert.equal(priority({ ...base, dlOpen: false, deadline: '★受付中（2026年8月1日締切）' }, '2026-07-19').bucket, 'P0');
  assert.notEqual(priority({ ...base, dlOpen: true, deadline: '★受付中（2026年7月31日必着、一部は締切済み）' }, '2026-07-19').bucket, 'P0');
  assert.equal(priority({ ...base, dlOpen: true, deadline: '★受付中（2026年7月18日締切）' }, '2026-07-19').reasons[0], 'open-after-deadline');
  console.log('triage self-test: 9 checks passed');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/triage.mjs [--date YYYY-MM-DD] [--limit N] [--format text|json] [--data PATH] [--self-test]');
    return;
  }
  if (args.selfTest) { runSelfTest(); return; }
  const records = JSON.parse(readFileSync(args.data, 'utf8'));
  const report = triage(records, args.date);
  if (args.format === 'json') console.log(JSON.stringify(report, null, 2));
  else printText(report, args.limit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

export { extractExplicitDeadline, priority, triage };
