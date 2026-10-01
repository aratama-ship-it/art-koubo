const DATE_TOKEN_SOURCE = '(?:\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{4}\\/\\d{1,2}\\/\\d{1,2}|\\d{1,2}月\\d{1,2}日|\\d{1,2}\\/\\d{1,2})';
const NEVER_EXPIRE_DEADLINE = /(?:とみられる|二次情報|正確な締切|締切日.*要確認|詳細締切.*未確認|締切明記なし|チケット販売中|種目により異なる|事前申込不要|開催直前まで|使用日の|使用希望日の|公演日の|利用希望日の|本番\d+週間前|順次開始|随時|通年|記載なし|明記なし|締切設定なし|締切なし|特定の締切)/;
const ROLLING_EXAMPLE_DEADLINE = /(?:ローリング|ほぼ毎月).*(?:例:|例：)/;
const NON_DEADLINE_CONTEXT = /(?:演奏会|本審査|開催|公演|上演|審査|発表|実施|大会|フェス|本番|コンサート)[^。、（）()]{0,8}$/;

function referenceParts(referenceDate) {
  const match = String(referenceDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new TypeError('referenceDate must be YYYY-MM-DD');
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function expiryCandidatesOf(deadline, referenceDate) {
  const { year: referenceYear } = referenceParts(referenceDate);
  const text = String(deadline || '').replace(/令和(\d+)年/g, (_, year) => `${2018 + Number(year)}年`);
  if (NEVER_EXPIRE_DEADLINE.test(text) || ROLLING_EXAMPLE_DEADLINE.test(text)) return [];

  const candidates = [];
  const tokenRe = new RegExp(DATE_TOKEN_SOURCE, 'g');
  let match;
  while ((match = tokenRe.exec(text))) {
    const token = match[0];
    let year = referenceYear;
    let month;
    let day;
    let parts = token.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/);
    if (parts) {
      year = Number(parts[1] || referenceYear);
      month = Number(parts[2]);
      day = Number(parts[3]);
    } else {
      parts = token.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/);
      if (!parts) continue;
      year = Number(parts[1] || referenceYear);
      month = Number(parts[2]);
      day = Number(parts[3]);
    }

    const time = Date.UTC(year, month - 1, day);
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const after = text.slice(match.index + token.length, match.index + token.length + 24);
    let score = 0;
    if (/(?:締切|必着|消印|期限|エントリー期間|作品受付|申込)[^。、（）()]{0,16}$/.test(before)) score += 100;
    const closeAt = after.search(/締切|必着|消印|まで/);
    const anotherDateAt = after.search(new RegExp(DATE_TOKEN_SOURCE));
    if (closeAt >= 0 && (anotherDateAt < 0 || closeAt < anotherDateAt)) score += 100;
    if (/〜\s*$/.test(before)) score += 160;
    if (!candidates.length && /^★?(?:受付中|募集中|次回募集)/.test(text)) score += 60;
    if (/^[^。、（）()]{0,6}(?:開催分|実施分|対象)/.test(after)) score -= 200;
    if (NON_DEADLINE_CONTEXT.test(before)) score -= 200;
    if (/^\s*〜/.test(after)) score -= 200;
    candidates.push({ time, score });
  }
  return candidates;
}

export function expiredDeadlineTimeOf(item, referenceDate) {
  const { year, month, day } = referenceParts(referenceDate);
  const referenceTime = Date.UTC(year, month - 1, day);
  const candidates = expiryCandidatesOf(item?.deadline, referenceDate);
  if (!candidates.length) return null;
  const maxScore = Math.max(...candidates.map((candidate) => candidate.score));
  if (maxScore < 50) return null;
  if (candidates.some((candidate) => candidate.score >= 0 && candidate.time >= referenceTime)) return null;
  const deadlineTime = Math.max(...candidates.filter((candidate) => candidate.score === maxScore).map((candidate) => candidate.time));
  return deadlineTime < referenceTime ? deadlineTime : null;
}
