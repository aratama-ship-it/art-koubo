import test from 'node:test';
import assert from 'node:assert/strict';

import { expiredDeadlineTimeOf } from '../lib/deadline-expiry.mjs';

const REFERENCE_DATE = '2026-10-01';

test('明示された過去の締切を降格対象にする', () => {
  const actual = expiredDeadlineTimeOf({ deadline: '★受付中（応募締切2026年9月20日）' }, REFERENCE_DATE);
  assert.equal(actual, Date.UTC(2026, 8, 20));
});

test('有効な未来の締切候補があれば降格しない', () => {
  const actual = expiredDeadlineTimeOf({ deadline: '★受付中（一次締切2026年9月20日、最終締切2027年4月1日）' }, REFERENCE_DATE);
  assert.equal(actual, null);
});

test('未来の公演日は過去の締切による降格を妨げない', () => {
  const actual = expiredDeadlineTimeOf({ deadline: '★受付中（2026年9月20日必着。公演2027年4月1日）' }, REFERENCE_DATE);
  assert.equal(actual, Date.UTC(2026, 8, 20));
});

test('募集開始日だけの範囲表記を締切とみなさない', () => {
  const actual = expiredDeadlineTimeOf({ deadline: '★受付中（2026年6月15日〜定員になり次第締切）' }, REFERENCE_DATE);
  assert.equal(actual, null);
});

test('随時募集は日付があっても降格しない', () => {
  const actual = expiredDeadlineTimeOf({ deadline: '★随時参加可（月1回開催、直近は2026年8月15日）' }, REFERENCE_DATE);
  assert.equal(actual, null);
});

const NON_DEADLINE_CONTEXTS = [
  '採用開始', '採用', '着任', '活動開始', '任期', '研修', '合宿',
  '会期', '開催期間', '展示', '発表会', '受賞発表', '結果発表',
];

for (const context of NON_DEADLINE_CONTEXTS) {
  test(`${context}の未来日が過去の締切による降格を妨げない`, () => {
    const actual = expiredDeadlineTimeOf(
      { deadline: `★受付中（応募締切2026年9月20日。${context}2027年4月1日）` },
      REFERENCE_DATE,
    );
    assert.equal(actual, Date.UTC(2026, 8, 20));
  });

  test(`${context}を含んでも明示された未来の応募締切があれば降格しない`, () => {
    const actual = expiredDeadlineTimeOf(
      { deadline: `★受付中（応募締切2026年9月20日。${context}後の応募締切2027年4月1日）` },
      REFERENCE_DATE,
    );
    assert.equal(actual, null);
  });
}
