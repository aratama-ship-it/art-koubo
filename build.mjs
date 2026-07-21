// アート公募メディア 静的サイトジェネレータ（依存なし・Node ESM）※助成ものさしの姉妹サイト
// data/koubo.data.json → 各ページのHTMLを生成する。使い方: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERIFIED = '2026-07-18';
const SITE_NAME = '身体芸術・公募ものさし';                         // 姉妹＝助成ものさし
const BASE_URL = 'https://koubo.art-monosashi.com/';
const SISTER_URL = 'https://joseikin.art-monosashi.com/'; // 助成ものさし
const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSc1pPGdqvVjMyocYNT7q-4JcVkn-c7c__ef1cveCDZ1Jf6hAQ/viewform'; // ご意見・情報訂正 共通フォーム
const SAVED_KEY = 'monosashi-koubo-saved-v1';
const koubos = JSON.parse(readFileSync(join(ROOT, 'data/koubo.data.json'), 'utf8'));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- お金の向き（差別化の核）----
const MONEY = {
  reward: { label: '報酬・賞金あり', cls: 'm-reward', hero: '出演料・賞金・制作費などが出る公募' },
  free: { label: '無償・施設提供', cls: 'm-free', hero: '金銭の授受はなく、会場や滞在の場が提供される公募' },
  paid: { label: '参加費あり', cls: 'm-paid', hero: '出演・出展に参加費がかかる公募' },
  unknown: { label: '費用は要確認', cls: 'm-unknown', hero: 'お金の向きが公式に明記されていない公募' },
};
const moneyOf = (k) => MONEY[k.money] || MONEY.unknown;

// ---- 47都道府県（regionから自動判定）----
const PREF_KEY = {
  '北海道': 'hokkaido', '青森': 'aomori', '岩手': 'iwate', '宮城': 'miyagi', '秋田': 'akita', '山形': 'yamagata', '福島': 'fukushima',
  '茨城': 'ibaraki', '栃木': 'tochigi', '群馬': 'gunma', '埼玉': 'saitama', '千葉': 'chiba', '東京': 'tokyo', '神奈川': 'kanagawa',
  '新潟': 'niigata', '富山': 'toyama', '石川': 'ishikawa', '福井': 'fukui', '山梨': 'yamanashi', '長野': 'nagano', '岐阜': 'gifu', '静岡': 'shizuoka', '愛知': 'aichi',
  '三重': 'mie', '滋賀': 'shiga', '京都': 'kyoto', '大阪': 'osaka', '兵庫': 'hyogo', '奈良': 'nara', '和歌山': 'wakayama',
  '鳥取': 'tottori', '島根': 'shimane', '岡山': 'okayama', '広島': 'hiroshima', '山口': 'yamaguchi',
  '徳島': 'tokushima', '香川': 'kagawa', '愛媛': 'ehime', '高知': 'kochi',
  '福岡': 'fukuoka', '佐賀': 'saga', '長崎': 'nagasaki', '熊本': 'kumamoto', '大分': 'oita', '宮崎': 'miyazaki', '鹿児島': 'kagoshima', '沖縄': 'okinawa',
};
const PREF_ORDER = Object.keys(PREF_KEY);
function bucketOf(region) {
  if (region.includes('海外')) return { key: 'overseas', label: '海外' };
  if (region.includes('全国')) return { key: 'national', label: '全国' };
  for (const s of PREF_ORDER) if (region.includes(s)) return { key: PREF_KEY[s], label: s };
  return { key: 'national', label: '全国' };
}

// 受付中の公募は、表示用の締切文から確認できる最終日を読み取り、近い順に並べる。
// 随時募集・締切未確認・「利用日の○日前」のような相対期限は、固定日案件の後ろへ置く。
const sourceOrder = new Map(koubos.map((k, i) => [k.id, i]));
const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
}).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
const { year: sortYear, month: sortMonth, day: sortDay } = todayParts;
const sortBaseTime = Date.UTC(sortYear, sortMonth - 1, sortDay);
const dateTokenSource = '(?:\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{4}\\/\\d{1,2}\\/\\d{1,2}|\\d{1,2}月\\d{1,2}日|\\d{1,2}\\/\\d{1,2})';

function deadlineTimeOf(k) {
  if (!k.dlOpen) return Number.POSITIVE_INFINITY;
  const text = String(k.deadline || '').replace(/令和(\d+)年/g, (_, year) => `${2018 + Number(year)}年`);
  // 開催日や二次情報しかない案件は、日付を締切として扱わない。
  if (/(?:とみられる|二次情報|正確な締切|締切日.*要確認|詳細締切.*未確認|締切明記なし|チケット販売中|種目により異なる|事前申込不要|開催直前まで|使用日の|使用希望日の|公演日の|利用希望日の|本番\d+週間前|順次開始)/.test(text)) {
    return Number.POSITIVE_INFINITY;
  }
  if (/(?:ローリング|ほぼ毎月).*(?:例:|例：)/.test(text)) return Number.POSITIVE_INFINITY;

  const candidates = [];
  const tokenRe = new RegExp(dateTokenSource, 'g');
  let match;
  while ((match = tokenRe.exec(text))) {
    const token = match[0];
    let year = sortYear;
    let month;
    let day;
    let parts = token.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日$/);
    if (parts) {
      year = Number(parts[1] || sortYear);
      month = Number(parts[2]);
      day = Number(parts[3]);
    } else {
      parts = token.match(/^(?:(\d{4})\/)?(\d{1,2})\/(\d{1,2})$/);
      if (!parts) continue;
      year = Number(parts[1] || sortYear);
      month = Number(parts[2]);
      day = Number(parts[3]);
    }

    const time = Date.UTC(year, month - 1, day);
    if (time < sortBaseTime) continue;
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    const after = text.slice(match.index + token.length, match.index + token.length + 24);
    let score = 0;
    if (/(?:締切|必着|消印|期限|エントリー期間|作品受付|申込)[^。、（）()]{0,16}$/.test(before)) score += 100;
    const closeAt = after.search(/締切|必着|消印|まで/);
    const anotherDateAt = after.search(new RegExp(dateTokenSource));
    if (closeAt >= 0 && (anotherDateAt < 0 || closeAt < anotherDateAt)) score += 100;
    if (/〜\s*$/.test(before)) score += 160;
    if (!candidates.length && /^★?(?:受付中|募集中|次回募集)/.test(text)) score += 60;
    if (/^[^。、（）()]{0,6}(?:開催分|実施分|対象)/.test(after)) score -= 200;
    candidates.push({ time, score });
  }

  if (!candidates.length) return Number.POSITIVE_INFINITY;
  const maxScore = Math.max(...candidates.map((candidate) => candidate.score));
  if (maxScore < 50) return Number.POSITIVE_INFINITY;
  return Math.min(...candidates.filter((candidate) => candidate.score === maxScore).map((candidate) => candidate.time));
}

const orderedKoubos = [...koubos].sort((a, b) => {
  const openFirst = Number(Boolean(b.dlOpen)) - Number(Boolean(a.dlOpen));
  if (openFirst) return openFirst;
  if (a.dlOpen && b.dlOpen) {
    const byDeadline = deadlineTimeOf(a) - deadlineTimeOf(b);
    if (byDeadline) return byDeadline;
  }
  return (sourceOrder.get(a.id) ?? 0) - (sourceOrder.get(b.id) ?? 0);
});

const activeBucketKeys = new Set(koubos.map((k) => bucketOf(k.region).key));
const BUCKETS = [
  { key: 'national', label: '全国' },
  ...PREF_ORDER.filter((s) => activeBucketKeys.has(PREF_KEY[s])).map((s) => ({ key: PREF_KEY[s], label: s })),
  ...(activeBucketKeys.has('overseas') ? [{ key: 'overseas', label: '海外' }] : []),
];
const openKoubos = orderedKoubos.filter((k) => k.dlOpen);

// ---- 検索用の募集形式タグ ----
// 元データの詳細な「種別」は情報として保持し、一覧・検索では共通語彙へまとめる。
// タグは既存の名称・種別だけから判定する。応募条件や注記を推測で分類しない。
const searchTagTextOf = (k) => `${k.name || ''} ${k.type || ''}`.normalize('NFKC').toLowerCase();
const SEARCH_TAGS = [
  {
    key: 'festival-performance',
    label: 'フェス・イベント出演',
    description: '演劇祭・文化祭・地域イベントなどへの出演や参加を探す',
    matches: (text) => /演劇祭|芸術祭|文化祭|音楽祭|フェス|まつり|祭り|祭典|カーニバル|コンベンション|イベント|オンステージ|ショーケース|ステージ|舞台発表|発表会|公演出演|出演者|出演団体|出演チーム|パフォーマー|参加団体|参加者募集|市民参加型/.test(text),
  },
  {
    key: 'audition',
    label: 'オーディション',
    description: '出演者・演奏家などを審査で選ぶ募集を探す',
    matches: (text) => /オーディション|audition|キャスト選考|出演者選考/.test(text),
  },
  {
    key: 'competition',
    label: 'コンクール・コンペ',
    description: '上演・演奏・ダンスなどの競技会や賞を探す',
    matches: (text) => /コンクール|コンペ|コンテスト|競技会|競演|大会|アワード|賞(?:（|\(|$|・)|選考会|審査型/.test(text),
  },
  {
    key: 'scripts-works',
    label: '戯曲・脚本・作品募集',
    description: '戯曲・脚本・台本や上演作品そのものの募集を探す',
    matches: (text) => /戯曲|脚本|台本|シナリオ|作品公募|作品募集|創作作品|文学賞/.test(text),
  },
  {
    key: 'residency',
    label: 'AIR・滞在制作',
    description: 'アーティスト・イン・レジデンスや滞在制作を探す',
    matches: (text) => /\bair\b|アーティスト・イン・レジデンス|滞在制作|レジデンス|residen/.test(text),
  },
  {
    key: 'development',
    label: '育成・研修',
    description: '育成プログラム・研修・講座・ワークショップを探す',
    matches: (text) => /育成|養成|研修|ワークショップ|講座|アカデミー|研究所|スクール|インテンシブ|フェローシップ/.test(text),
  },
  {
    key: 'choreographer',
    label: '振付家向け',
    description: '振付家・振付作品を対象とする育成や発表機会を探す',
    matches: (text) => /振付家|振付|振り付け|コレオグラファ|choreograph/.test(text),
  },
  {
    key: 'venue-support',
    label: '会場・創作支援',
    description: '劇場・稽古場の提供や、公演・制作の支援枠を探す',
    matches: (text) => /施設利用|利用団体|貸館|会場提供|稽古場|スタジオ|創造支援|創作支援|制作支援|公演支援|利用支援|施設提供|利用料割引|団体支援|共催事業|提携公演|共同製作|連携事業/.test(text),
  },
  {
    key: 'member-recruitment',
    label: '団員・メンバー募集',
    description: '劇団・楽団・カンパニーなどの継続メンバー募集を探す',
    matches: (text) => /団員募集|劇団員|楽団員|合唱団員|メンバー募集|会員募集|団体加入|カンパニー・メンバー/.test(text),
  },
  {
    key: 'registration-license',
    label: '登録・ライセンス',
    description: '出演者登録・アーティストバンク・認定制度を探す',
    matches: (text) => /登録制|参加事業登録|人材登録|人材バンク|アーティストバンク|パフォーマーバンク|ライセンス|認定制度|出演者登録/.test(text),
  },
  {
    key: 'project-open-call',
    label: '企画・プロジェクト公募',
    description: '公演企画・自主企画・共同創作などの提案募集を探す',
    matches: (text) => /企画公募|企画募集|公演企画|企画提案|自主企画|持ち込み企画|自主上演枠|新人公募|公募プログラム|共同創作|共同制作|プロジェクト公募|芸術監督|ディレクター公募/.test(text),
  },
  {
    key: 'other',
    label: 'その他',
    description: '上の共通タグに当てはまらない公募を探す',
    matches: () => false,
  },
];
const SEARCH_TAG_BY_KEY = new Map(SEARCH_TAGS.map((tag) => [tag.key, tag]));
const searchTagsOf = (k) => {
  const text = searchTagTextOf(k);
  const keys = SEARCH_TAGS.filter((tag) => tag.key !== 'other' && tag.matches(text)).map((tag) => tag.key);
  return keys.length ? keys : ['other'];
};
const SEARCH_TAG_COUNTS = new Map(SEARCH_TAGS.map((tag) => [
  tag.key,
  koubos.filter((k) => searchTagsOf(k).includes(tag.key)).length,
]));
const PRIMARY_TAG_PRIORITY = ['residency', 'scripts-works', 'audition', 'competition', 'development', 'venue-support', 'member-recruitment', 'registration-license', 'project-open-call', 'festival-performance', 'choreographer', 'other'];
function primarySearchTagOf(k) {
  const keys = searchTagsOf(k);
  const key = PRIMARY_TAG_PRIORITY.find((candidate) => keys.includes(candidate)) || 'other';
  return SEARCH_TAG_BY_KEY.get(key);
}

// フリーワード検索用。表示カードには、見えている項目だけでなく応募条件・注記も検索語として持たせる。
function searchTextOf(k) {
  const tagLabels = searchTagsOf(k).map((key) => SEARCH_TAG_BY_KEY.get(key).label);
  const raw = [
    k.name, k.organizer, k.region, k.deadline, k.type, k.moneyLabel,
    ...(k.genres || []), ...(k.conditions || []), k.note, ...tagLabels,
  ].filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
  // 「9/18」と「9月18日」のどちらで入力しても拾えるよう、検索専用の別表記を加える。
  const dateAliases = [...raw.matchAll(/(\d{1,2})\/(\d{1,2})/g)].map((m) => `${m[1]}月${m[2]}日`).join(' ');
  return `${raw} ${dateAliases}`;
}

// ---- 姉妹サイト「助成ものさし」の助成データ（ビルド時にローカルで読み込み、候補を各公募ページへ焼き込む）----
// 配信は純静的のまま。両リポジトリはローカルで隣接（app-dev/stage-grants-site）している前提。
// データが見つからなければこの機能は静かに無効化し、従来のリンクにフォールバックする（ビルドは壊さない）。
// ※助成データを更新したら、公募側も node build.mjs で再生成して反映する必要がある。
let GRANTS = [];
try {
  const graw = readFileSync(join(ROOT, '../stage-grants-site/data/programs.data.json'), 'utf8');
  GRANTS = JSON.parse(graw).map((g) => {
    const region = g.region || '';
    const isNational = /全国|46道府県/.test(region);
    let prefSlug = null;
    if (!/以外/.test(region)) for (const s of PREF_ORDER) if (region.includes(s)) { prefSlug = PREF_KEY[s]; break; }
    // 国際的な活動に対応しうるか（海外公募向けの優先判定に使う）
    const intl = /海外|国際|アジア|欧|グローバル/.test(region + (g.amount || '') + (g.note || ''));
    return { id: g.id, name: g.name, funder: g.funder, region, deadline: g.deadline,
             dlUrgent: !!g.dlUrgent, amount: g.amount || '', genres: g.genres || [], isNational, prefSlug, intl };
  });
} catch { GRANTS = []; }

// 公募の細かいジャンル → 助成側の大分類（並べ替えのソフトな一致判定にのみ使用。ジャンルは絞り込みには使わない）
const GENRE_BROAD = {
  '演劇': '舞台', 'ダンス': '舞台', 'バレエ': '舞台', 'コンテンポラリーダンス': '舞台', 'ストリートダンス': '舞台',
  'サーカス・ジャグリング': '舞台', '大道芸': '舞台', 'パフォーマンス': '舞台', '人形劇': '舞台', 'ミュージカル': '舞台',
  '日本舞踊': '文芸・伝統芸能', '伝統芸能': '文芸・伝統芸能', '伝統文化': '文芸・伝統芸能', '文芸・戯曲': '文芸・伝統芸能',
  '音楽': '音楽', 'オペラ': '音楽', '美術': '美術',
};
const broadGenresOf = (k) => [...new Set((k.genres || []).map((g) => GENRE_BROAD[g]).filter(Boolean))];

// ---- 巡演候補（開催日が明示された公募だけを使う）----
// deadline の文章を推測で解析せず、eventStart / eventEnd が入力済みのレコードだけを対象にする。
const DAY_MS = 24 * 60 * 60 * 1000;
function eventWindowOf(k) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k.eventStart || '')) return null;
  const endText = k.eventEnd || k.eventStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endText)) return null;
  const start = Date.parse(`${k.eventStart}T00:00:00Z`);
  const end = Date.parse(`${endText}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end, startText: k.eventStart, endText };
}
function eventLabel(k) {
  const w = eventWindowOf(k);
  if (!w) return '';
  const [sy, sm, sd] = w.startText.split('-').map(Number);
  const [ey, em, ed] = w.endText.split('-').map(Number);
  if (w.startText === w.endText) return `${sy}年${sm}月${sd}日`;
  if (sy === ey && sm === em) return `${sy}年${sm}月${sd}〜${ed}日`;
  if (sy === ey) return `${sy}年${sm}月${sd}日〜${em}月${ed}日`;
  return `${sy}年${sm}月${sd}日〜${ey}年${em}月${ed}日`;
}
function intervalGapDays(a, b) {
  if (a.end < b.start) return Math.round((b.start - a.end) / DAY_MS);
  if (b.end < a.start) return Math.round((a.start - b.end) / DAY_MS);
  return 0;
}
function tourCandidates(k) {
  const current = eventWindowOf(k);
  if (!current) return [];
  return koubos.map((q) => {
    if (q.id === k.id || q.organizer === k.organizer) return null;
    const other = eventWindowOf(q);
    if (!other) return null;
    const sharedGenres = (k.genres || []).filter((g) => (q.genres || []).includes(g));
    if (!sharedGenres.length) return null;
    const gapDays = intervalGapDays(current, other);
    if (gapDays > 45) return null;
    const samePref = bucketOf(q.region).key === bucketOf(k.region).key;
    const score = (45 - gapDays) + sharedGenres.length * 12 + (samePref ? 10 : 0) + (q.dlOpen ? 2 : 0);
    return { q, sharedGenres, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.q.name.localeCompare(b.q.name, 'ja')).slice(0, 4);
}

function tourBlock(k) {
  const candidates = tourCandidates(k);
  if (!candidates.length) return '';
  const cards = candidates.map(({ q, sharedGenres }) => `<a class="tcard" href="../koubo/${esc(q.id)}.html">
<div class="when">開催 ${esc(eventLabel(q))}</div>
<div class="t">${esc(q.name)}</div>
<div class="m">${esc(q.region)}</div>
<div class="tags"><span class="tag">共通: ${sharedGenres.map(esc).join('・')}</span><span class="tag ${moneyOf(q).cls}">${moneyOf(q).label}</span></div></a>`).join('');
  return `<section class="tourbox" aria-labelledby="tour-${esc(k.id)}">
<div class="tour-eyebrow">TOUR FINDER</div>
<h2 id="tour-${esc(k.id)}">同じ作品を、次の土地へ</h2>
<p class="tour-intro">${esc(eventLabel(k))}の前後45日以内に開催され、ジャンルが重なる別主催の公募です。開催日が明記された案件だけを掲載しています。作品をそのまま巡演できるとは限らないため、応募資格・上演時間・会場条件は各詳細でご確認ください。</p>
<div class="tourrow">${cards}</div>
</section>`;
}

const SEARCH_CSS = `
.searchbox{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 16px;margin:16px 0;box-shadow:var(--shadow)}
.searchbox label{display:block;font-size:13px;font-weight:700;margin-bottom:7px}
.searchline{display:flex;gap:8px}
.searchline input{min-width:0;flex:1;border:1px solid #cfd2de;border-radius:10px;padding:11px 12px;font:inherit;color:var(--ink);background:#fff}
.searchline input:focus{outline:3px solid #dbe2ff;border-color:var(--accent)}
.searchline button{border:0;border-radius:10px;padding:0 17px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}
.search-help,.search-status{font-size:12px;color:var(--sub);margin:7px 0 0}
.search-status{font-weight:600;color:var(--accent)}
.search-tags{border:0;margin:14px 0 0;padding:0}
.search-tags legend{padding:0;font-size:12px;font-weight:700;color:var(--sub)}
.search-tag-list{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.search-tag{display:inline-flex;align-items:center;gap:6px;border:1px solid #cfd5eb;border-radius:8px;padding:7px 9px;background:#f7f8ff;color:#405078;font:inherit;font-size:12.5px;font-weight:650;line-height:1.25;cursor:pointer}
a.search-tag{color:#405078}
.search-tag:hover{border-color:var(--accent);color:var(--accent);background:#f0f3ff;text-decoration:none}
.search-tag[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:#fff;box-shadow:0 1px 0 rgba(51,85,224,.2)}
.search-tag-count{font-size:11px;font-variant-numeric:tabular-nums;opacity:.82}
.search-empty{background:#fff;border:1px dashed var(--line);border-radius:12px;padding:18px;margin:14px 0;color:var(--sub)}
.search-group[hidden],.gitem-wrap[hidden],.search-empty[hidden]{display:none!important}
@media(max-width:520px){.searchline{flex-direction:column}.searchline button{min-height:42px}.search-tag{font-size:12px;padding:7px 8px}}`;

const HOME_CSS = `
.home-hero{display:grid;grid-template-columns:minmax(0,1fr) 188px;grid-template-rows:auto auto auto;align-items:center;column-gap:24px;min-height:190px;padding:4px 4px 8px 0}
.home-site-name{grid-column:1;grid-row:1;align-self:end;display:flex;align-items:center;gap:9px;margin:4px 0 0;color:var(--accent);font-size:17px;font-weight:800;letter-spacing:.045em}
.home-site-name::before{content:"";width:25px;height:3px;border-radius:2px;background:var(--accent);flex:0 0 auto}
.home-hero h1{grid-column:1;grid-row:2;align-self:end;font-size:clamp(25px,3.4vw,32px);line-height:1.45;letter-spacing:-.015em;margin:3px 0 5px}
.home-hero .home-lede{grid-column:1;grid-row:3;align-self:start;max-width:650px}
.home-mascot{grid-column:2;grid-row:1/4;justify-self:end;width:188px;aspect-ratio:1;display:grid;place-items:center;margin:-4px 0 -8px}
.home-mascot img{display:block;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 8px 12px rgba(28,28,34,.09))}
.home-stat{display:grid;grid-template-columns:repeat(3,minmax(100px,1fr)) minmax(220px,1.55fr);gap:10px;align-items:stretch}
.home-stat>div{display:flex;flex-direction:column;justify-content:center}
.home-stat .stat-sister{display:flex;flex-direction:column;justify-content:center;background:#e6f5ee;border:2px solid #8fc9a6;border-radius:10px;padding:9px 13px;color:#1a8f5a;box-shadow:0 2px 0 rgba(26,143,90,.12),var(--shadow);line-height:1.45;transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}
.home-stat .stat-sister:hover{border-color:#1a8f5a;box-shadow:0 3px 0 rgba(26,143,90,.18),var(--shadow);transform:translateY(-1px);text-decoration:none}
.stat-sister-kicker{font-size:11px;font-weight:700;letter-spacing:.06em}
.stat-sister-name{font-size:13px;font-weight:800}
@media(max-width:640px){
  .home-hero{grid-template-columns:minmax(0,1fr) 108px;grid-template-rows:auto auto auto;column-gap:8px;min-height:0;padding:2px 0 7px}
  .home-site-name{grid-column:1/3;grid-row:1;font-size:14px;gap:7px;margin-top:4px}
  .home-site-name::before{width:18px;height:2px}
  .home-hero h1{grid-column:1;grid-row:2;font-size:22px;line-height:1.48;margin:3px 0 4px}
  .home-hero .home-lede{grid-column:1/3;grid-row:3;margin-top:3px}
  .home-mascot{grid-column:2;grid-row:2;width:108px;margin:-4px 0 -5px}
  .home-stat{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}
  .home-stat>div{padding:9px 7px;text-align:center}
  .home-stat .n{font-size:20px}
  .home-stat .l{white-space:nowrap}
  .home-stat .stat-sister{grid-column:1/-1;display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;padding:10px 12px}
  .home-stat .stat-sister-name{text-align:right}
}
@media(max-width:380px){.home-hero{grid-template-columns:minmax(0,1fr) 92px}.home-hero h1{font-size:20px}.home-mascot{width:92px}}`;

const TOUR_CSS = `
.tourbox{background:#fffdf8;border:1px solid #e8dfca;border-left:4px solid #b7791f;border-radius:14px;padding:16px 18px;margin:18px 0}
.tourbox h2{margin:1px 0 4px}
.tour-eyebrow{font-size:10px;letter-spacing:.15em;color:#8a641d;font-weight:800}
.tour-intro{font-size:12.5px;color:var(--sub);margin:4px 0 12px}
.tourrow{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.tcard{display:block;flex:0 0 220px;width:220px;background:#fff;border:1px solid #e8dfca;border-radius:11px;padding:11px 13px;scroll-snap-align:start}
.tcard:hover{border-color:#b7791f;text-decoration:none}
.tcard .when{font-size:11.5px;color:#8a641d;font-weight:700;margin-bottom:4px}
.tcard .t{font-weight:600;color:var(--ink);font-size:13.5px}
.tcard .m{color:var(--sub);font-size:12px;margin-top:3px}`;

// ある公募に対して「資金の当て」候補となる助成金を返す（最大4件）。
// 正直さの要: 地域助成は「開催地」ではなく「応募者の活動拠点」条件なので、全国／地域を明示的に分けて出す。
function relatedGrants(k) {
  if (!GRANTS.length) return null;
  const bk = bucketOf(k.region);
  const isOverseas = bk.key === 'overseas';
  const prefSlug = (bk.key !== 'national' && bk.key !== 'overseas') ? bk.key : null;
  const wantBroad = broadGenresOf(k);
  const gMatch = (g) => !wantBroad.length || g.genres.some((x) => wantBroad.includes(x));
  const score = (g) => (g.dlUrgent ? 2 : 0) + (gMatch(g) ? 1 : 0);

  let local = [];
  if (prefSlug) local = GRANTS.filter((g) => g.prefSlug === prefSlug && !g.isNational).sort((a, b) => score(b) - score(a)).slice(0, 2);
  let national = GRANTS.filter((g) => g.isNational)
    .sort((a, b) => (isOverseas ? (Number(b.intl) - Number(a.intl)) : 0) || (score(b) - score(a)));
  const localIds = new Set(local.map((g) => g.id));
  const nationalPick = national.filter((g) => !localIds.has(g.id)).slice(0, isOverseas ? 4 : (local.length ? 2 : 4));
  if (!local.length && !nationalPick.length) return null;
  return { bk, prefSlug, isOverseas, local, national: nationalPick };
}

// 助成金候補ブロック（公募詳細ページに焼き込む）
function grantBlock(k) {
  const gcard = (g, note) => `<a class="gcard" href="${SISTER_URL}grants/${esc(g.id)}.html" target="_blank" rel="noopener">
<div class="t">${esc(g.name)}</div>
<div class="m">${esc(g.funder)}</div>
${g.amount ? `<div class="a">${esc(g.amount)}</div>` : ''}
<div class="gtags">${g.dlUrgent ? '<span class="tag dl">受付中</span>' : ''}<span class="tag">${esc(g.region)}</span>${note ? `<span class="tag glabel">${note}</span>` : ''}</div></a>`;

  const r = relatedGrants(k);
  if (!r) {
    return `<div class="grantbox"><div class="grantbox-h">公募に通ったあとの<strong>資金の当て</strong>を探す</div>
<p style="margin:8px 0 0"><a class="cta sister" href="${SISTER_URL}" target="_blank" rel="noopener">この活動に使える助成金を「助成ものさし」で探す →</a></p></div>`;
  }
  const deep = r.prefSlug ? `${SISTER_URL}regions/${r.prefSlug}.html` : `${SISTER_URL}regions/national.html`;
  const deepLabel = r.prefSlug ? `${esc(r.bk.label)}で使える助成金をすべて見る` : (r.isOverseas ? '海外・国際に使える助成金を見る' : '全国の助成金をすべて見る');
  const intro = r.isOverseas
    ? 'この公募は海外での活動です。渡航・滞在・制作費の当てとして、次のような助成金があります。'
    : '出演・制作にかかる費用の当てとして、次のような助成金があります。';
  let groups = '';
  if (r.isOverseas) {
    groups = `<div class="gh">💰 海外での活動に使える可能性のある助成金</div><div class="grow">${r.national.map((g) => gcard(g, '国際枠あり')).join('')}</div>`;
  } else {
    if (r.local.length) groups += `<div class="gh">📍 ${esc(r.bk.label)}を拠点に活動する方向け</div><div class="grow">${r.local.map((g) => gcard(g, `${esc(r.bk.label)}拠点`)).join('')}</div>`;
    if (r.national.length) groups += `<div class="gh">🗾 全国どこからでも応募できる助成金</div><div class="grow">${r.national.map((g) => gcard(g, '全国')).join('')}</div>`;
  }
  return `<div class="grantbox">
<div class="grantbox-h">公募に通ったあとの<strong>資金の当て</strong>を探す</div>
<p class="gnote">${intro} <b>応募資格は助成金ごとに異なります</b>——地域助成の多くは「その地域を拠点に活動していること」が条件です。各詳細で必ずご確認ください。</p>
${groups}
<p style="margin:12px 0 0"><a class="cta sister" href="${deep}" target="_blank" rel="noopener">${deepLabel}（助成ものさし）→</a></p>
</div>`;
}

// ---- 共通レイアウト ----
const WRITTEN = [];
function layout({ title, desc, rel, body, active, extraCss = '' }) {
  const nav = [
    ['index.html', 'ホーム', 'home'],
    ['koubo.html', '公募を探す', 'koubo'],
    ['calendar.html', '締切・募集状況', 'calendar'],
    ['saved.html', 'あとで見る <span class="saved-count" aria-label="保存件数">0</span>', 'saved'],
    ['about.html', 'このサイトについて', 'about'],
  ].map(([href, label, key]) => `<a href="${rel}${href}"${key === active ? ' class="on"' : ''}>${label}</a>`).join('');
  const url = BASE_URL + rel.replace(/^\.\.\//, '').replace(/^index\.html$/, '') === BASE_URL + rel ? BASE_URL + rel : BASE_URL; // 下でcanonicalは個別算出
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<style>
:root{--bg:#f2f3f7;--card:#fff;--ink:#1c1c22;--sub:#6a6d7a;--line:#e4e5ec;--accent:#3355e0;--accent-soft:#eaeeff;--accent-line:#d7ddf6;
--ok:#1a8f5a;--ok-bg:#e6f5ee;--chk:#b7791f;--chk-bg:#fbf3e2;--dl:#c05621;--dl-bg:#fff4f0;
--shadow:0 1px 3px rgba(20,20,40,.06),0 8px 24px rgba(20,20,40,.05)}
*{box-sizing:border-box}
html{scrollbar-gutter:stable}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.7;font-size:15px;
font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.nav{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}
.nav-in{max-width:900px;margin:0 auto;display:flex;gap:4px;align-items:center;padding:10px 14px}
.brand{font-weight:800;font-size:17px;margin-right:10px;color:var(--ink);flex:0 0 auto;letter-spacing:.015em}
.nav-links{display:flex;align-items:center;gap:4px;flex:1;min-width:0;flex-wrap:nowrap}
.menu-toggle{display:none;width:44px;height:44px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);padding:0;align-items:center;justify-content:center;flex-direction:column;gap:4px;cursor:pointer}
.menu-toggle .bar{display:block;width:20px;height:2px;border-radius:2px;background:currentColor;transition:transform .18s ease,opacity .18s ease}
.menu-toggle[aria-expanded="true"] .bar:nth-child(1){transform:translateY(6px) rotate(45deg)}
.menu-toggle[aria-expanded="true"] .bar:nth-child(2){opacity:0}
.menu-toggle[aria-expanded="true"] .bar:nth-child(3){transform:translateY(-6px) rotate(-45deg)}
.menu-toggle:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.nav a{padding:6px 10px;border-radius:8px;font-size:13.5px;color:var(--sub);white-space:nowrap}
.nav a.on{background:#eaeeff;color:var(--accent)}
@media(max-width:900px){
  .nav-in{padding:7px 12px;gap:8px;flex-wrap:wrap}
  .brand{margin-right:auto;max-width:calc(100% - 56px);font-size:15px;line-height:1.4}
  .menu-toggle{display:flex;flex:0 0 44px}
  .nav-links{display:none;flex:0 0 100%;width:100%;flex-direction:column;align-items:stretch;gap:2px;padding:8px 0 3px;border-top:1px solid var(--line)}
  .nav-links.is-open{display:flex}
  .nav .nav-links a{display:block;width:100%;padding:11px 12px;font-size:14px}
}
@media(prefers-reduced-motion:reduce){.menu-toggle .bar,.home-stat .stat-sister{transition:none}.home-stat .stat-sister:hover{transform:none}}
main{max-width:900px;margin:0 auto;padding:18px 14px 60px}
h1{font-size:22px;margin:6px 0 6px}h2{font-size:17px;margin:26px 0 12px}
.lede{color:var(--sub);margin:0 0 6px}
.source-notice{display:grid;grid-template-columns:132px minmax(0,1fr);gap:7px 16px;align-items:start;margin:0 0 18px;padding:12px 14px;border:1px solid var(--accent-line);border-left:4px solid var(--accent);border-radius:11px;background:var(--accent-soft);color:var(--sub);font-size:13px;line-height:1.65}
.source-notice strong{color:var(--accent);font-size:13px;letter-spacing:.04em}
.beta-notice{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 12px;align-items:baseline;margin:0 0 18px;padding:10px 14px;border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:10px;background:var(--card);color:var(--sub);font-size:13px;line-height:1.65}
.beta-notice__label{color:var(--accent);font-size:11px;font-weight:800;letter-spacing:.1em}.beta-notice p{margin:0}.beta-notice a{color:var(--accent);font-weight:800;text-decoration-thickness:1.5px;text-underline-offset:2px}
@media(max-width:640px){.source-notice{grid-template-columns:1fr;gap:2px;padding:11px 12px}.beta-notice{grid-template-columns:1fr;gap:1px;padding:10px 12px}}
.card{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:16px 18px;margin:12px 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px;display:block}
.tile b{font-size:15px}.tile .c{color:var(--sub);font-size:12px}
.stat{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.stat div{background:#fff;border-radius:10px;padding:10px 14px;box-shadow:var(--shadow)}
.stat .n{font-size:22px;font-weight:700}.stat .l{font-size:12px;color:var(--sub)}
.gitem{display:block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:13px 15px;margin:9px 0}
.gitem:hover{border-color:var(--accent);text-decoration:none}
.gitem .t{font-weight:600;color:var(--ink)}
.gitem .m{color:var(--sub);font-size:12.5px;margin-top:2px}
.gitem-wrap{position:relative;margin:9px 0}
.gitem-wrap .gitem{margin:0;padding-right:58px;min-height:62px}
.save-toggle{min-width:44px;height:44px;border:1px solid var(--accent-line);border-radius:10px;background:#fff;color:var(--accent);font:inherit;font-weight:800;cursor:pointer;line-height:1}
.save-toggle:hover{background:var(--accent-soft)}
.save-toggle:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.save-toggle[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
.save-toggle:disabled{opacity:.45;cursor:not-allowed}
.save-card{position:absolute;top:8px;right:8px;z-index:1;font-size:21px}
.save-inline{width:auto;padding:0 15px;margin:10px 0 2px;line-height:1.4}
.saved-count{display:inline-grid;place-items:center;min-width:19px;height:19px;margin-left:3px;padding:0 5px;border-radius:10px;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:800;vertical-align:middle}
.nav a.on .saved-count{background:#fff}
.saved-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}
.saved-card{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px;box-shadow:var(--shadow)}
.saved-card h2{font-size:15px;margin:0 0 4px;line-height:1.55}
.saved-card .saved-meta{font-size:12.5px;color:var(--sub);margin:0 0 10px}
.saved-card .saved-fields{display:grid;grid-template-columns:78px 1fr;gap:5px 9px;margin:0 0 14px;font-size:13px}
.saved-card .saved-fields dt{color:var(--sub)}
.saved-card .saved-fields dd{margin:0}
.saved-actions{display:flex;gap:8px;align-items:center;margin-top:auto}
.saved-actions a{flex:1;text-align:center;padding:8px 10px;border-radius:9px;background:var(--accent-soft);font-size:13px;font-weight:700}
.saved-actions .save-toggle{flex:0 0 44px;padding:0}
.saved-tools{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:14px 0}
.quiet-button{min-height:42px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--sub);font:inherit;padding:8px 13px;cursor:pointer}
.quiet-button:hover{border-color:var(--accent);color:var(--accent)}
.saved-empty{background:#fff;border:1px dashed var(--line);border-radius:14px;padding:24px 18px;text-align:center;color:var(--sub)}
@media(max-width:640px){.saved-grid{grid-template-columns:1fr}}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.tag{font-size:11.5px;background:#f4f5fa;color:var(--sub);border-radius:6px;padding:3px 8px}
.tag.dl{background:var(--dl-bg);color:var(--dl);font-weight:600}
.tag.m-reward{background:#e6f5ee;color:#1a8f5a;font-weight:700}
.tag.m-free{background:#eef3ff;color:#3355e0;font-weight:700}
.tag.m-paid{background:#fff4f0;color:#c05621;font-weight:700}
.tag.m-unknown{background:#f4f5fa;color:#6a6d7a;font-weight:600}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:11px 18px;border-radius:11px;font-weight:700}
.cta:hover{text-decoration:none;opacity:.94}
.cta.sister{background:#1a8f5a}
.grantbox{background:#f1faf4;border:1px solid #cfe9d9;border-radius:14px;padding:16px 18px;margin:18px 0}
.grantbox-h{font-weight:700;font-size:16px;color:#147a4a}
.grantbox-h strong{color:#0f6b40}
.grantbox .gnote{color:var(--sub);font-size:12.5px;margin:6px 0 4px}
.grantbox .gh{font-size:12.5px;color:#3d6b53;font-weight:700;margin:14px 0 6px}
.grow{display:flex;gap:10px;overflow-x:auto;margin:0 0 4px;padding:2px 2px 10px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.grow::-webkit-scrollbar{height:6px}
.grow::-webkit-scrollbar-thumb{background:#cfe9d9;border-radius:3px}
.gcard{display:block;flex:0 0 200px;width:200px;background:#fff;border:1px solid var(--line);border-radius:11px;padding:11px 13px;scroll-snap-align:start}
.gcard:hover{border-color:#1a8f5a;text-decoration:none}
.gcard .t{font-weight:600;color:var(--ink);font-size:13.5px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gcard .m{color:var(--sub);font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gcard .a{color:#147a4a;font-size:12px;font-weight:600;margin-top:3px}
.gtags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.tag.glabel{background:#e6f5ee;color:#1a8f5a;font-weight:600}
.kv{margin:10px 0}.kv .k{font-size:12px;color:var(--sub)}.kv .v{font-size:15px}
ul.cond{margin:8px 0 0;padding-left:0;list-style:none}
ul.cond li{padding:7px 0;border-top:1px dashed var(--line);font-size:14px}
ul.cond li:first-child{border-top:none}
.note{color:var(--sub);font-size:13px;margin-top:8px}
.src{margin-top:12px;font-size:13px}
.verified{color:var(--sub);font-size:12px;margin-top:6px}
.discl{font-size:12px;color:var(--sub);background:#fff;border:1px dashed var(--line);border-radius:10px;padding:11px 13px;margin:16px 0}
footer{border-top:1px solid var(--line);background:#fff;margin-top:30px}
.foot-in{max-width:900px;margin:0 auto;padding:18px 14px;font-size:12px;color:var(--sub)}
.foot-in a{color:var(--sub)}
.hidden{display:none}
.tabs{display:flex;gap:6px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px;margin:8px 0 6px}
.tab{flex:1;padding:10px 6px;border:none;background:transparent;border-radius:9px;font-size:13.5px;font-weight:600;color:var(--sub);cursor:pointer;font-family:inherit}
.tab.on{background:var(--accent);color:#fff}
.tabpane{padding:6px 0 2px}
.regionbar{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}
.prefgroup{margin:12px 0}
.prefgroup .gh{font-size:12px;color:var(--sub);margin:0 0 6px}
.prefs{display:flex;flex-wrap:wrap;gap:7px}
.pref{font-size:13px;border:1px solid var(--line);border-radius:8px;padding:6px 11px;background:#fafafb;color:#b4b6c0}
a.pref{color:var(--accent);border-color:#d7ddf6;background:#eef0fa;font-weight:600}
a.pref:hover{text-decoration:none;border-color:var(--accent)}
${extraCss}</style>
</head>
<body>
<div class="nav"><div class="nav-in"><span class="brand">${SITE_NAME}</span><button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu" aria-label="メニューを開く"><span class="bar"></span><span class="bar"></span><span class="bar"></span></button><div class="nav-links" id="site-menu">${nav}</div></div></div>
<script>
(()=>{const button=document.querySelector('.menu-toggle');const menu=document.getElementById('site-menu');if(!button||!menu)return;const close=(focus=false)=>{button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','メニューを開く');menu.classList.remove('is-open');if(focus)button.focus()};button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')==='true';if(open){close()}else{button.setAttribute('aria-expanded','true');button.setAttribute('aria-label','メニューを閉じる');menu.classList.add('is-open')}});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&button.getAttribute('aria-expanded')==='true')close(true)});window.addEventListener('resize',()=>{if(window.innerWidth>900)close()})})();
</script>
<script>
(()=>{const key=${JSON.stringify(SAVED_KEY)};let available=true;
const read=()=>{try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.map(String):[]}catch(error){available=false;return[]}};
const write=(ids)=>{try{localStorage.setItem(key,JSON.stringify(Array.from(new Set(ids.map(String)))))}catch(error){available=false}sync()};
const sync=()=>{const ids=read();document.querySelectorAll('.saved-count').forEach((node)=>{node.textContent=String(ids.length)});document.querySelectorAll('[data-save-id]').forEach((button)=>{const saved=ids.includes(String(button.dataset.saveId));const name=button.dataset.saveName||'この項目';button.disabled=!available;button.setAttribute('aria-pressed',String(saved));button.setAttribute('aria-label',saved?name+'をあとで見るから外す':name+'をあとで見るに追加');button.textContent=button.classList.contains('save-inline')?(saved?'★ 保存済み':'☆ あとで見る'):(saved?'★':'☆')})};
const toggle=(id)=>{const ids=read();const value=String(id);write(ids.includes(value)?ids.filter((x)=>x!==value):[...ids,value]);window.dispatchEvent(new CustomEvent('monosashi:saved'))};
document.addEventListener('click',(event)=>{const button=event.target.closest('[data-save-id]');if(!button||button.disabled)return;event.preventDefault();toggle(button.dataset.saveId)});
window.addEventListener('storage',(event)=>{if(event.key===key)sync()});window.addEventListener('monosashi:saved',sync);window.MonosashiSaved={get:read,set:write,toggle,sync};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync()})();
</script>
<main>
<aside class="source-notice" aria-label="掲載情報について"><strong>掲載情報について</strong><span>掲載情報は、主催者等の一次情報をもとに収集・整理しています。更新のタイミングにより、最新の情報と異なる場合があります。詳細・最新情報は、必ず各公式サイトでご確認ください。</span></aside>
<aside class="beta-notice" aria-label="ベータ版について"><span class="beta-notice__label">BETA</span><p><strong>このウェブサイトは現在ベータ版です。</strong> ご要望・ご意見、掲載情報の訂正などがありましたら、<a href="${FORM_URL}" target="_blank" rel="noopener">フォーム</a>よりご連絡いただけると幸いです。</p></aside>
${body}
</main>
<footer><div class="foot-in">
掲載情報の更新には時間差があります。締切・条件は変動するため、応募前に必ず各主催の最新の募集要項をご確認ください。<br>
<a href="${rel}about.html">このサイトについて</a> ・ <a href="${rel}saved.html">あとで見る</a> ・ <a href="${rel}privacy.html">プライバシー</a> ・ <a href="${rel}disclaimer.html">免責事項・情報訂正</a> ・ <a href="${SISTER_URL}" target="_blank" rel="noopener">姉妹サイト 助成ものさし</a>
</div></footer>
</body>
</html>`;
}

function statusTags(k) {
  const t = [];
  const m = moneyOf(k);
  const primaryTag = primarySearchTagOf(k);
  t.push(`<span class="tag ${m.cls}">${m.label}</span>`);
  if (k.dlOpen) t.push(`<span class="tag dl">締切: ${esc(k.deadline)}</span>`);
  else t.push(`<span class="tag">${esc(k.deadline)}</span>`);
  t.push(`<span class="tag">${esc(primaryTag.label)}</span>`);
  return t.join('');
}
function gitem(k, rel, searchable = false) {
  const searchAttrs = searchable
    ? ` data-search="${esc(searchTextOf(k))}" data-search-tags="${esc(searchTagsOf(k).join(' '))}"`
    : '';
  return `<div class="gitem-wrap"${searchAttrs}><a class="gitem" href="${rel}koubo/${k.id}.html">
<div class="t">${esc(k.name)}</div>
<div class="m">${esc(k.organizer)} ・ ${esc(k.region)}</div>
<div class="tags">${statusTags(k)}</div></a>
<button class="save-toggle save-card" type="button" data-save-id="${esc(k.id)}" data-save-name="${esc(k.name)}" aria-pressed="false">☆</button></div>`;
}

function searchTagControls({ action, live }) {
  const controls = SEARCH_TAGS.filter((tag) => SEARCH_TAG_COUNTS.get(tag.key) > 0).map((tag) => {
    const count = SEARCH_TAG_COUNTS.get(tag.key);
    const label = `${tag.label}（${count}件）。${tag.description}`;
    if (live) {
      return `<button class="search-tag" type="button" data-search-tag="${esc(tag.key)}" aria-pressed="false" aria-label="${esc(label)}" title="${esc(tag.description)}">${esc(tag.label)} <span class="search-tag-count" aria-hidden="true">${count}</span></button>`;
    }
    return `<a class="search-tag" href="${esc(action)}?tag=${encodeURIComponent(tag.key)}" aria-label="${esc(label)}" title="${esc(tag.description)}">${esc(tag.label)} <span class="search-tag-count" aria-hidden="true">${count}</span></a>`;
  }).join('');
  return `<fieldset class="search-tags"><legend>公募の種類で絞り込む（全タグ・複数選択可）</legend><div class="search-tag-list">${controls}</div></fieldset>`;
}

function searchForm({ action = 'koubo.html', live = false } = {}) {
  return `<form class="searchbox"${live ? ' id="koubo-search"' : ''} action="${action}" method="get" role="search">
<label for="koubo-q${live ? '-live' : ''}">名前・地域・ジャンル・応募条件からフリーワード検索</label>
<div class="searchline"><input id="koubo-q${live ? '-live' : ''}" name="q" type="search" autocomplete="off" placeholder="例：兵庫 9月 演劇" aria-describedby="koubo-search-help${live ? '-live' : ''}"><button type="submit">探す</button></div>
<p class="search-help" id="koubo-search-help${live ? '-live' : ''}">スペースで区切ると、すべての言葉を含む公募に絞れます。</p>
${searchTagControls({ action, live })}
${live ? '<p class="search-status" id="koubo-search-status" aria-live="polite"></p>' : ''}
</form>`;
}

function write(rel, html) {
  const url = BASE_URL + rel.replace(/^index\.html$/, '');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || SITE_NAME;
  const desc = (html.match(/<meta name="description" content="([\s\S]*?)">/) || [])[1] || '';
  const head = `<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" href="${BASE_URL}assets/mascot-body-art.png">
<link rel="apple-touch-icon" href="${BASE_URL}assets/mascot-body-art.png">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${BASE_URL}assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="身体芸術・公募ものさし — あなたの表現を、待っている場所へ。">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${BASE_URL}assets/og-card.png">`;
  html = html.replace(/(<meta name="description" content="[\s\S]*?">)/, `$1\n${head}`);
  WRITTEN.push(rel);
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html);
}

// ---- トップ ----
{
  const homeOpenKoubos = openKoubos.slice(0, 12);
  const openList = homeOpenKoubos.map((k) => gitem(k, '')).join('') || '<p class="note">現在受付中の公募はありません。次回募集の目安は各カードでご確認ください。</p>';
  const moneyTiles = ['reward', 'free', 'paid', 'unknown'].map((key) => {
    const n = koubos.filter((k) => (k.money || 'unknown') === key).length;
    if (!n) return '';
    return `<a class="tile" href="money/${key}.html"><b>${MONEY[key].label}</b><div class="c">${n}件</div></a>`;
  }).join('');
  const CHIHO = [
    ['北海道・東北', ['北海道', '青森', '岩手', '宮城', '秋田', '山形', '福島']],
    ['関東', ['茨城', '栃木', '群馬', '埼玉', '千葉', '東京', '神奈川']],
    ['中部', ['新潟', '富山', '石川', '福井', '山梨', '長野', '岐阜', '静岡', '愛知']],
    ['近畿', ['三重', '滋賀', '京都', '大阪', '兵庫', '奈良', '和歌山']],
    ['中国', ['鳥取', '島根', '岡山', '広島', '山口']],
    ['四国', ['徳島', '香川', '愛媛', '高知']],
    ['九州・沖縄', ['福岡', '佐賀', '長崎', '熊本', '大分', '宮崎', '鹿児島', '沖縄']],
  ];
  const prefChip = (name) => activeBucketKeys.has(PREF_KEY[name])
    ? `<a class="pref" href="regions/${PREF_KEY[name]}.html">${name}</a>`
    : `<span class="pref" title="収録準備中">${name}</span>`;
  const nationalN = koubos.filter((k) => bucketOf(k.region).key === 'national').length;
  const overseasN = koubos.filter((k) => bucketOf(k.region).key === 'overseas').length;
  const regionPane = `
<div class="regionbar">
<a class="pref" href="regions/national.html" style="font-size:14px;padding:9px 16px">全国（${nationalN}件）</a>
${overseasN ? `<a class="pref" href="regions/overseas.html" style="font-size:14px;padding:9px 16px">海外（${overseasN}件）</a>` : ''}
</div>
<p class="note" style="margin:0 0 6px">開催地から探す（掲載のある地域が青。順次拡充します）</p>
${CHIHO.map(([label, prefs]) => `<div class="prefgroup"><div class="gh">${label}</div><div class="prefs">${prefs.map(prefChip).join('')}</div></div>`).join('')}`;
  const closedN = koubos.length - openKoubos.length;
  const deadlinePane = `
<p class="note" style="margin:2px 0 12px">締切・募集状況から探す。締切済みも「次回募集の目安」として掲載しています。</p>
<div class="regionbar">
<a class="pref" href="calendar.html" style="font-size:14px;padding:9px 16px">受付中（${openKoubos.length}件）</a>
<a class="pref" href="calendar.html" style="font-size:14px;padding:9px 16px">締切済み・次回待ち（${closedN}件）</a>
</div>
<p><a class="cta" href="calendar.html">締切・募集状況の一覧を見る →</a></p>`;
  const body = `
<div class="home-hero">
<p class="home-site-name">${SITE_NAME}</p>
<h1>あなたの表現を、待っている場所へ。</h1>
<p class="lede home-lede">演劇祭・レジデンス・戯曲賞・コンペなど、舞台芸術の出演・出展・滞在制作の公募を「参加費がかかる／無償／報酬・賞金が出る」まで一目で。${koubos.length}件を収録（無料）。</p>
<div class="home-mascot"><img src="assets/mascot-body-art.png" width="512" height="512" alt="踊るものさしのキャラクター" fetchpriority="high" decoding="async"></div>
</div>
<div class="stat home-stat">
<div><div class="n">${koubos.length}</div><div class="l">収録公募</div></div>
<div><div class="n">${openKoubos.length}</div><div class="l">受付中</div></div>
<div><div class="n">${koubos.filter((k) => k.money === 'reward').length}</div><div class="l">報酬・賞金あり</div></div>
<a class="stat-sister" href="${SISTER_URL}" target="_blank" rel="noopener"><span class="stat-sister-kicker">姉妹サイト</span><span class="stat-sister-name">助成ものさしへ →</span></a>
</div>
${searchForm()}

<div class="tabs" role="tablist">
<button class="tab on" data-tab="money" role="tab">お金の向きから探す</button>
<button class="tab" data-tab="region" role="tab">開催地から探す</button>
<button class="tab" data-tab="deadline" role="tab">締切から探す</button>
</div>
<div class="tabpane" id="tab-money"><div class="tiles">${moneyTiles}</div></div>
<div class="tabpane hidden" id="tab-region">${regionPane}</div>
<div class="tabpane hidden" id="tab-deadline">${deadlinePane}</div>

<h2>受付中の公募（締切が近い${homeOpenKoubos.length}件）</h2>
<p class="note" style="margin-top:-7px">トップでは締切が近い順に一部を掲載しています。</p>
${openList}
${openKoubos.length > homeOpenKoubos.length ? `<p><a class="cta" href="calendar.html">受付中の公募をすべて見る（${openKoubos.length}件）→</a></p>` : ''}
<div class="discl">これは開発中のプロトタイプです。掲載は募集要項の事実項目に基づく参考情報で、採択・出演を保証するものではありません。応募前に必ず各主催の最新要項をご確認ください。「お金の向き」は主催が明示していない場合「費用は要確認」としています。</div>
<script>
document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){
document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on');});
document.querySelectorAll('.tabpane').forEach(function(x){x.classList.add('hidden');});
b.classList.add('on');
document.getElementById('tab-'+b.dataset.tab).classList.remove('hidden');
};});
</script>`;
  write('index.html', layout({ title: `${SITE_NAME}｜アートの公募をお金の向きつきで探す`, desc: `舞台芸術の公募（演劇祭・レジデンス・戯曲賞・コンペ）を、締切・開催地・「参加費がかかる/無償/報酬・賞金が出る」つきで探せる無料サイト。${koubos.length}件を収録。`, rel: '', active: 'home', body, extraCss: SEARCH_CSS + HOME_CSS }));
}

// ---- 公募一覧 ----
{
  let body = `<h1>公募を探す（${koubos.length}件）</h1>
<p class="lede">開催地別に全公募を掲載。地域内では受付中・締切が近い順に並び、各ページで締切・お金の向き・応募資格・出典を確認できます。</p>
${searchForm({ live: true })}
<div class="search-empty" id="koubo-search-empty" hidden>該当する公募がありません。タグを外すか、地域名・月・ジャンルなど、言葉を短くしてお試しください。</div>`;
  for (const b of BUCKETS) {
    const list = orderedKoubos.filter((k) => bucketOf(k.region).key === b.key);
    if (!list.length) continue;
    body += `<section class="search-group"><h2>${b.label}（${list.length}）</h2>${list.map((k) => gitem(k, '', true)).join('')}</section>`;
  }
  body += `<script>
(function(){
var form=document.getElementById('koubo-search');
var input=document.getElementById('koubo-q-live');
var status=document.getElementById('koubo-search-status');
var empty=document.getElementById('koubo-search-empty');
var items=Array.prototype.slice.call(document.querySelectorAll('.search-group .gitem-wrap'));
var groups=Array.prototype.slice.call(document.querySelectorAll('.search-group'));
var tagButtons=Array.prototype.slice.call(document.querySelectorAll('[data-search-tag]'));
var knownTags=${JSON.stringify(SEARCH_TAGS.map((tag) => tag.key))};
var activeTags=(new URLSearchParams(location.search).get('tag')||'').split(',').filter(function(tag){return knownTags.indexOf(tag)!==-1;});
function norm(s){return String(s||'').normalize('NFKC').toLowerCase().trim();}
function syncTagButtons(){tagButtons.forEach(function(button){button.setAttribute('aria-pressed',String(activeTags.indexOf(button.getAttribute('data-search-tag'))!==-1));});}
function updateUrl(){
  var url=new URL(location.href);var q=input.value.trim();
  if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');
  if(activeTags.length)url.searchParams.set('tag',activeTags.join(','));else url.searchParams.delete('tag');
  history.replaceState(null,'',url.pathname+url.search+url.hash);
}
function apply(){
  var terms=norm(input.value).split(/\\s+/).filter(Boolean);
  var shown=0;
  items.forEach(function(item){
    var hay=norm(item.getAttribute('data-search'));
    var itemTags=(item.getAttribute('data-search-tags')||'').split(/\\s+/).filter(Boolean);
    var textMatch=terms.every(function(term){return hay.indexOf(term)!==-1;});
    var tagMatch=!activeTags.length||activeTags.some(function(tag){return itemTags.indexOf(tag)!==-1;});
    var match=textMatch&&tagMatch;
    item.hidden=!match;if(match)shown++;
  });
  groups.forEach(function(group){group.hidden=!group.querySelector('.gitem-wrap:not([hidden])');});
  empty.hidden=shown!==0;
  status.textContent=(terms.length||activeTags.length) ? shown+'件見つかりました' : '${koubos.length}件すべて表示しています';
}
var initial=new URLSearchParams(location.search).get('q')||'';
input.value=initial;
input.addEventListener('input',apply);
tagButtons.forEach(function(button){button.addEventListener('click',function(){
  var tag=button.getAttribute('data-search-tag');
  activeTags=activeTags.indexOf(tag)!==-1 ? activeTags.filter(function(value){return value!==tag;}) : activeTags.concat(tag);
  syncTagButtons();updateUrl();apply();
});});
form.addEventListener('submit',function(e){
  e.preventDefault();
  updateUrl();apply();
});
syncTagButtons();
apply();
})();
</script>`;
  write('koubo.html', layout({ title: `公募一覧（${koubos.length}件）｜${SITE_NAME}`, desc: `舞台芸術の公募${koubos.length}件を開催地別に一覧。締切・お金の向き・応募資格つき。`, rel: '', active: 'koubo', body, extraCss: SEARCH_CSS }));
}

// ---- 締切・募集状況 ----
{
  const closed = koubos.filter((k) => !k.dlOpen);
  const body = `<h1>締切・募集状況</h1>
<p class="lede">「受付中」と「締切済み・次回募集の目安」を一覧。受付中は締切が近い順で、日付を特定できない随時募集などはその後に表示します。</p>
<h2>受付中（${openKoubos.length}）</h2>
${openKoubos.map((k) => gitem(k, '')).join('') || '<p class="note">現在受付中の公募はありません。</p>'}
<h2>締切済み・次回募集待ち（${closed.length}）</h2>
${closed.map((k) => gitem(k, '')).join('')}`;
  write('calendar.html', layout({ title: `締切・募集状況｜${SITE_NAME}`, desc: `舞台芸術公募の受付中・締切済み・次回募集の目安を一覧。`, rel: '', active: 'calendar', body }));
}

// ---- 地域別 ----
for (const b of BUCKETS) {
  const list = orderedKoubos.filter((k) => bucketOf(k.region).key === b.key);
  const open = list.filter((k) => k.dlOpen);
  const body = `<h1>${b.label}のアート公募（${list.length}件）</h1>
<p class="lede">${b.label}で応募できる舞台芸術の公募。受付中・締切が近い順で、締切・お金の向き・応募資格を掲載しています。</p>
${open.length ? `<h2>受付中（${open.length}）</h2>${open.map((k) => gitem(k, '../')).join('')}` : ''}
<h2>公募一覧</h2>
${list.map((k) => gitem(k, '../')).join('')}
<p class="note"><a href="../koubo.html">← 全地域の一覧に戻る</a></p>`;
  write(`regions/${b.key}.html`, layout({ title: `${b.label}のアート公募一覧｜${SITE_NAME}`, desc: `${b.label}で応募できる舞台芸術の公募${list.length}件。締切・お金の向きつき。`, rel: '../', active: 'koubo', body }));
}

// ---- お金の向き別 ----
for (const key of ['reward', 'free', 'paid', 'unknown']) {
  const list = orderedKoubos.filter((k) => (k.money || 'unknown') === key);
  if (!list.length) continue;
  const m = MONEY[key];
  const body = `<h1>${m.label}の公募（${list.length}件）</h1>
<p class="lede">${m.hero}。</p>
${list.map((k) => gitem(k, '../')).join('')}
<p class="note"><a href="../koubo.html">← 全公募の一覧に戻る</a></p>`;
  write(`money/${key}.html`, layout({ title: `${m.label}の公募一覧｜${SITE_NAME}`, desc: `${m.hero}を一覧。${list.length}件。`, rel: '../', active: 'koubo', body }));
}

// ---- 公募別ページ ----
for (const k of koubos) {
  const related = koubos.filter((q) => bucketOf(q.region).key === bucketOf(k.region).key && q.id !== k.id).slice(0, 5);
  const m = moneyOf(k);
  const tour = tourBlock(k);
  const body = `<p class="note"><a href="../koubo.html">公募一覧</a> ／ <a href="../regions/${bucketOf(k.region).key}.html">${esc(bucketOf(k.region).label)}</a> ／ <a href="../money/${k.money || 'unknown'}.html">${m.label}</a></p>
<h1>${esc(k.name)}</h1>
<p class="lede">${esc(k.organizer)} ・ ${esc(k.region)}</p>
<div class="tags">${statusTags(k)}</div>
<button class="save-toggle save-inline" type="button" data-save-id="${esc(k.id)}" data-save-name="${esc(k.name)}" aria-pressed="false">☆ あとで見る</button>
<div class="card">
<div class="kv"><div class="k">お金の向き</div><div class="v"><span class="tag ${m.cls}">${m.label}</span> ${esc(k.moneyLabel)}</div></div>
<div class="kv"><div class="k">締切・募集状況</div><div class="v">${esc(k.deadline)}</div></div>
<div class="kv"><div class="k">種別・ジャンル</div><div class="v">${esc(k.type)}／${(k.genres || []).map(esc).join('・')}</div></div>
<div class="kv"><div class="k">主な応募条件</div><ul class="cond">${(k.conditions || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
${k.note ? `<p class="note">ℹ️ ${esc(k.note)}</p>` : ''}
<div class="src">📄 出典: <a href="${esc(k.src)}" target="_blank" rel="noopener">${esc(k.organizer)} 公式ページ</a></div>
<p class="verified">最終確認: ${esc(k.verified)}（公式ページで一次確認）</p>
</div>
${grantBlock(k)}${tour ? `\n${tour}` : ''}
${related.length ? `<h2>${esc(bucketOf(k.region).label)}の他の公募</h2>${related.map((q) => gitem(q, '../')).join('')}` : ''}
<div class="discl">掲載情報は募集要項の明示内容に基づく参考情報で、採択・出演を保証するものではありません。応募前に必ず公式の最新要項をご確認ください。締切・条件・金額は変動します。</div>`;
  write(`koubo/${k.id}.html`, layout({ title: `${esc(k.name)}｜${esc(k.organizer)}の公募｜${SITE_NAME}`, desc: `${esc(k.organizer)}「${esc(k.name)}」。${esc(k.region)}／${m.label}／${esc(k.type)}。締切・応募資格・出典を掲載。`, rel: '../', active: 'koubo', body, extraCss: tour ? TOUR_CSS : '' }));
}

// ---- あとで見る・比較 ----
{
  const savedData = JSON.stringify(koubos.map((k) => ({
    id: String(k.id), name: k.name, organizer: k.organizer, region: k.region,
    deadline: k.deadline, money: moneyOf(k).label, type: k.type,
  }))).replace(/</g, '\\u003c');
  const body = `<h1>あとで見る・比較</h1>
<p class="lede">気になる公募を一時保存し、開催地・締切・お金の向き・種別を横に並べて比べられます。</p>
<div class="discl">保存先はこの端末のブラウザ内だけです。内容は本サイトのサーバーへ送信されません。ブラウザのサイトデータを削除すると保存も消えます。</div>
<div class="saved-tools"><p class="note" id="saved-summary" aria-live="polite">保存した公募を読み込んでいます。</p><button class="quiet-button" id="saved-clear" type="button">すべて外す</button></div>
<div class="saved-empty" id="saved-empty" hidden>まだ保存した公募はありません。<br><a href="koubo.html">公募一覧</a>の☆を押すと、ここで比較できます。</div>
<div class="saved-grid" id="saved-list"></div>
<script type="application/json" id="saved-data">${savedData}</script>
<script>
(()=>{const records=JSON.parse(document.getElementById('saved-data').textContent);const byId=new Map(records.map((item)=>[String(item.id),item]));const list=document.getElementById('saved-list');const empty=document.getElementById('saved-empty');const summary=document.getElementById('saved-summary');const clear=document.getElementById('saved-clear');
const escapeHtml=(value)=>String(value??'').replace(/[&<>\"]/g,(char)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
function render(){const ids=window.MonosashiSaved.get();const items=ids.map((id)=>byId.get(String(id))).filter(Boolean);summary.textContent=items.length?items.length+'件を保存しています':'保存は0件です';empty.hidden=items.length!==0;clear.hidden=items.length===0;list.innerHTML=items.map((item)=>'<article class="saved-card"><h2><a href="koubo/'+escapeHtml(item.id)+'.html">'+escapeHtml(item.name)+'</a></h2><p class="saved-meta">'+escapeHtml(item.organizer)+' ・ '+escapeHtml(item.region)+'</p><dl class="saved-fields"><dt>締切</dt><dd>'+escapeHtml(item.deadline)+'</dd><dt>お金の向き</dt><dd>'+escapeHtml(item.money)+'</dd><dt>種別</dt><dd>'+escapeHtml(item.type)+'</dd></dl><div class="saved-actions"><a href="koubo/'+escapeHtml(item.id)+'.html">詳細を見る</a><button class="save-toggle" type="button" data-save-id="'+escapeHtml(item.id)+'" data-save-name="'+escapeHtml(item.name)+'" aria-pressed="true">★</button></div></article>').join('');window.MonosashiSaved.sync()}
clear.addEventListener('click',()=>{window.MonosashiSaved.set([]);window.dispatchEvent(new CustomEvent('monosashi:saved'))});window.addEventListener('monosashi:saved',render);render()})();
</script>`;
  write('saved.html', layout({ title: `あとで見る・比較｜${SITE_NAME}`, desc: `気になる身体芸術の公募を端末内に保存し、開催地・締切・お金の向き・種別を比較できます。`, rel: '', active: 'saved', body }));
}

// ---- ポリシー ----
write('about.html', layout({
  title: `このサイトについて｜${SITE_NAME}`, desc: `${SITE_NAME}の目的・情報源・更新方針。`, rel: '', active: 'about',
  body: `<h1>このサイトについて</h1>
<section class="mission" aria-labelledby="mission-title">
<div class="mission-copy">
<h2 id="mission-title">あなたの表現を、待っている場所へ。</h2>
<p>作品をつくること。稽古を重ねること。人と出会い、観客へ届けること。舞台芸術や身体表現に関わる人の時間と力が、できるだけそうした営みに使われてほしい——それが、このプロジェクトで最も大切にしている思いです。</p>
<p>一方で、出演や発表の機会を探し、数多くの公募情報をめぐり、募集要項を読み、自分が対象かを確かめ、締切・開催地・費用を整理する作業には、多くの時間と体力が必要です。作品を届ける場所を探すために、作品をつくる力が削られてしまう。身体芸術・公募ものさしは、その負担を少しでも小さくするために生まれました。</p>
<p>応募そのものをなくすことはできません。それでも、散らばった機会を、場所・時期・ジャンル・お金の向きから見つけやすくし、「探す・比べる・確かめる」時間を短くすることはできます。あなたの表現が、次の土地、次の観客、次の出会いへ届くことを目指しています。</p>
</div>
<div class="mission-character"><img src="assets/mascot-body-art-front.png" width="1254" height="1254" alt="正面を向いた、身体芸術・公募ものさしのキャラクター" loading="lazy" decoding="async"></div>
</section>
<div class="card">
<h2>身体芸術・公募ものさしについて</h2>
<p>${SITE_NAME}は、舞台芸術・アートの「公募」——演劇祭・フェスティバル・アーティスト・イン・レジデンス・戯曲賞・コンペ・オーディションなど、出演・出展・滞在制作に応募できる機会を、締切・開催地・応募資格つきで探せる無料サイトです。助成金メディア「<a href="${SISTER_URL}" target="_blank" rel="noopener">助成ものさし</a>」の姉妹サイトです。</p>
<h2>特徴</h2>
<ul>
<li>「参加費がかかる／無償・施設提供／報酬・賞金が出る」という<strong>お金の向き</strong>を、各公募の第一級情報として掲載します。「出せるようになった、でもお金が厳しい」に直結する情報です。</li>
<li>公募に通ったあとの資金は、姉妹サイト「助成ものさし」の助成金検索に繋げられます。</li>
<li>名前・地域・ジャンル・応募条件をフリーワードで横断検索できます。開催日が明記された公募では、同時期・同ジャンルの別主催案件も巡演候補として案内します。</li>
<li>各公募に出典（公式ページ）と最終確認日を明記し、募集要項の全文転載はせず事実項目のみを掲載します。</li>
</ul>
<h2>情報源と更新</h2>
<p>掲載情報は各主催の公式サイト・募集要項をもとに収集・整理しています。最終確認日は各公募の詳細ページに表示していますが、更新には時間差があります。応募前には必ず各主催の最新要項をご確認ください。</p>
<p>掲載内容の誤り・更新・新しい公募のご連絡は <a href="disclaimer.html">情報訂正の窓口</a> へ。</p>
</div>`,
  extraCss: `.mission{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:14px;align-items:end;overflow:hidden;background:#eef3ff;border-left:4px solid var(--accent);border-radius:12px;padding:16px 18px;margin:12px 0 24px}
.mission-copy{min-width:0}
.mission h2{margin:0 0 8px;font-size:20px;line-height:1.5;color:var(--accent)}
.mission p{margin:9px 0}
.mission-character{width:180px;height:310px;justify-self:end;overflow:hidden;display:grid;place-items:center}
.mission-character img{display:block;width:310px;height:310px;max-width:none;object-fit:contain;transform:translateX(-12px);filter:drop-shadow(0 8px 12px rgba(28,28,34,.08))}
@media(max-width:680px){.mission{grid-template-columns:1fr}.mission-character{width:175px;height:275px;justify-self:center;margin-top:-4px}.mission-character img{width:290px;height:290px}}`,
}));

write('privacy.html', layout({
  title: `プライバシーポリシー｜${SITE_NAME}`, desc: `${SITE_NAME}のプライバシーポリシー。`, rel: '', active: 'about',
  body: `<h1>プライバシーポリシー</h1>
<div class="card">
<h2>アクセス解析・広告</h2>
<p>本サイトは現時点で解析・広告を導入しておらず、Cookieによる追跡は行っていません。将来導入する際は、初回アクセス時に同意バナーを表示し、同意した場合にのみ読み込みます。</p>
<h2>「あとで見る」の保存内容について</h2>
<p>「あとで見る」で選んだ公募の識別情報は、お使いのブラウザのlocalStorageにのみ保存され、本サイトのサーバーや第三者には送信されません。ブラウザのサイトデータを削除すると保存内容も消去されます。</p>
<h2>個人情報</h2>
<p>お問い合わせ等でいただいた個人情報は、対応の目的以外に利用しません。第三者への提供は法令に基づく場合を除き行いません。</p>
<p>お問い合わせ・訂正のご連絡は <a href="disclaimer.html">情報訂正の窓口</a> へ。</p>
</div>`,
}));

write('disclaimer.html', layout({
  title: `免責事項・情報訂正の窓口｜${SITE_NAME}`, desc: `${SITE_NAME}の免責事項と情報訂正の連絡先。`, rel: '', active: 'about',
  body: `<h1>免責事項・情報訂正の窓口</h1>
<div class="card">
<h2>免責</h2>
<p>本サイトの掲載情報は、募集要項の明示内容に基づく参考情報です。採択・出演・受賞を保証するものではありません。応募の最終判断は必ず各主催の最新の募集要項でご確認ください。締切・金額・条件は変動します。「お金の向き」は主催が明示していない場合「費用は要確認」としています。</p>
<h2>情報訂正の窓口</h2>
<p>掲載内容の誤り・古い情報、新しい公募のご連絡のほか、ご要望・ご意見も下記フォームからお寄せください（姉妹サイトと共通の窓口です）。確認のうえ速やかに修正します。匿名で送信できます。</p>
<p><a class="cta" href="${FORM_URL}" target="_blank" rel="noopener">ご意見・情報訂正フォームを開く →</a></p>
<h2>更新履歴</h2>
<ul><li>${VERIFIED}: 舞台芸術の公募${koubos.length}件でプロトタイプ公開（助成ものさしの姉妹サイト）。</li></ul>
</div>`,
}));

// ---- sitemap / robots ----
{
  const urls = WRITTEN.map((rel) => BASE_URL + rel.replace(/^index\.html$/, ''));
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc><lastmod>${VERIFIED}</lastmod></url>`).join('\n')}
</urlset>`;
  writeFileSync(join(ROOT, 'sitemap.xml'), sitemap);
  writeFileSync(join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}sitemap.xml\n`);
}

console.log(`Generated: index, koubo, calendar, ${BUCKETS.length} regions, money pages, ${koubos.length} koubo pages, 3 policy pages, sitemap(${WRITTEN.length} urls), robots.txt.`);
