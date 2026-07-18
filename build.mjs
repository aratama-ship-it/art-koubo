// アート公募メディア 静的サイトジェネレータ（依存なし・Node ESM）※助成ものさしの姉妹サイト
// data/koubo.data.json → 各ページのHTMLを生成する。使い方: node build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const VERIFIED = '2026-07-18';
const SITE_NAME = '公募ものさし';                                   // 仮ブランド（姉妹＝助成ものさし）
const BASE_URL = 'https://aratama-ship-it.github.io/art-koubo/';    // 公開後に確定
const SISTER_URL = 'https://aratama-ship-it.github.io/stage-grants/'; // 助成ものさし
const FORM_URL = 'https://forms.gle/sX3hTrCRdipxKsmCA';             // 情報訂正・お問い合わせ（当面 共通フォーム）
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
const activeBucketKeys = new Set(koubos.map((k) => bucketOf(k.region).key));
const BUCKETS = [
  { key: 'national', label: '全国' },
  ...PREF_ORDER.filter((s) => activeBucketKeys.has(PREF_KEY[s])).map((s) => ({ key: PREF_KEY[s], label: s })),
  ...(activeBucketKeys.has('overseas') ? [{ key: 'overseas', label: '海外' }] : []),
];
const openKoubos = koubos.filter((k) => k.dlOpen);

// ---- 共通レイアウト ----
const WRITTEN = [];
function layout({ title, desc, rel, body, active }) {
  const nav = [
    ['index.html', 'ホーム', 'home'],
    ['koubo.html', '公募を探す', 'koubo'],
    ['calendar.html', '締切・募集状況', 'calendar'],
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
:root{--bg:#f2f3f7;--card:#fff;--ink:#1c1c22;--sub:#6a6d7a;--line:#e4e5ec;--accent:#3355e0;
--ok:#1a8f5a;--ok-bg:#e6f5ee;--chk:#b7791f;--chk-bg:#fbf3e2;--dl:#c05621;--dl-bg:#fff4f0;
--shadow:0 1px 3px rgba(20,20,40,.06),0 8px 24px rgba(20,20,40,.05)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);line-height:1.7;font-size:15px;
font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.nav{background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:10}
.nav-in{max-width:900px;margin:0 auto;display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:10px 14px}
.brand{font-weight:700;font-size:15px;margin-right:10px;color:var(--ink)}
.nav a{padding:6px 10px;border-radius:8px;font-size:13.5px;color:var(--sub)}
.nav a.on{background:#eaeeff;color:var(--accent);font-weight:600}
.nav .sister{margin-left:auto;background:#e6f5ee;color:#1a8f5a;font-weight:600}
main{max-width:900px;margin:0 auto;padding:18px 14px 60px}
h1{font-size:22px;margin:6px 0 6px}h2{font-size:17px;margin:26px 0 12px}
.lede{color:var(--sub);margin:0 0 6px}
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
</style>
</head>
<body>
<div class="nav"><div class="nav-in"><span class="brand">${SITE_NAME}</span>${nav}<a class="sister" href="${SISTER_URL}" target="_blank" rel="noopener">助成金は「助成ものさし」へ →</a></div></div>
<main>
${body}
</main>
<footer><div class="foot-in">
情報は${VERIFIED}に各公式サイト・募集要項で一次確認したものです（順次更新）。締切・条件は変動します。応募前に必ず各主催の最新の募集要項をご確認ください。<br>
<a href="${rel}about.html">このサイトについて</a> ・ <a href="${rel}privacy.html">プライバシー</a> ・ <a href="${rel}disclaimer.html">免責事項・情報訂正</a> ・ <a href="${SISTER_URL}" target="_blank" rel="noopener">姉妹サイト 助成ものさし</a>
</div></footer>
</body>
</html>`;
}

function statusTags(k) {
  const t = [];
  const m = moneyOf(k);
  t.push(`<span class="tag ${m.cls}">${m.label}</span>`);
  if (k.dlOpen) t.push(`<span class="tag dl">締切: ${esc(k.deadline)}</span>`);
  else t.push(`<span class="tag">${esc(k.deadline)}</span>`);
  t.push(`<span class="tag">${esc(k.type)}</span>`);
  return t.join('');
}
function gitem(k, rel) {
  return `<a class="gitem" href="${rel}koubo/${k.id}.html">
<div class="t">${esc(k.name)}</div>
<div class="m">${esc(k.organizer)} ・ ${esc(k.region)}</div>
<div class="tags">${statusTags(k)}</div></a>`;
}

function write(rel, html) {
  const url = BASE_URL + rel.replace(/^index\.html$/, '');
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || SITE_NAME;
  const desc = (html.match(/<meta name="description" content="([\s\S]*?)">/) || [])[1] || '';
  const head = `<link rel="canonical" href="${url}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:locale" content="ja_JP">
<meta name="twitter:card" content="summary">`;
  html = html.replace(/(<meta name="description" content="[\s\S]*?">)/, `$1\n${head}`);
  WRITTEN.push(rel);
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, html);
}

// ---- トップ ----
{
  const openList = openKoubos.map((k) => gitem(k, '')).join('') || '<p class="note">現在受付中の公募はありません。次回募集の目安は各カードでご確認ください。</p>';
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
<a class="pref" href="calendar.html" style="font-size:14px;padding:9px 16px">いま受付中（${openKoubos.length}件）</a>
<a class="pref" href="calendar.html" style="font-size:14px;padding:9px 16px">締切済み・次回待ち（${closedN}件）</a>
</div>
<p><a class="cta" href="calendar.html">締切・募集状況の一覧を見る →</a></p>`;
  const body = `
<h1>あなたが応募できるアートの公募を、お金の向きつきで。</h1>
<p class="lede">演劇祭・レジデンス・戯曲賞・コンペなど、舞台芸術の出演・出展・滞在制作の公募を「参加費がかかる／無償／報酬・賞金が出る」まで一目で。${koubos.length}件を収録（無料）。</p>
<div class="stat">
<div><div class="n">${koubos.length}</div><div class="l">収録公募</div></div>
<div><div class="n">${openKoubos.length}</div><div class="l">いま受付中</div></div>
<div><div class="n">${koubos.filter((k) => k.money === 'reward').length}</div><div class="l">報酬・賞金あり</div></div>
</div>
<p><a class="cta sister" href="${SISTER_URL}" target="_blank" rel="noopener">公募に通ったら、使える助成金を「助成ものさし」で探す →</a></p>

<div class="tabs" role="tablist">
<button class="tab on" data-tab="money" role="tab">お金の向きから探す</button>
<button class="tab" data-tab="region" role="tab">開催地から探す</button>
<button class="tab" data-tab="deadline" role="tab">締切から探す</button>
</div>
<div class="tabpane" id="tab-money"><div class="tiles">${moneyTiles}</div></div>
<div class="tabpane hidden" id="tab-region">${regionPane}</div>
<div class="tabpane hidden" id="tab-deadline">${deadlinePane}</div>

<h2>いま応募できる公募（${openKoubos.length}）</h2>
${openList}
<div class="discl">これは開発中のプロトタイプです。掲載は募集要項の事実項目に基づく参考情報で、採択・出演を保証するものではありません。応募前に必ず各主催の最新要項をご確認ください。「お金の向き」は主催が明示していない場合「費用は要確認」としています。</div>
<script>
document.querySelectorAll('.tab').forEach(function(b){b.onclick=function(){
document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('on');});
document.querySelectorAll('.tabpane').forEach(function(x){x.classList.add('hidden');});
b.classList.add('on');
document.getElementById('tab-'+b.dataset.tab).classList.remove('hidden');
};});
</script>`;
  write('index.html', layout({ title: `${SITE_NAME}｜アートの公募をお金の向きつきで探す`, desc: `舞台芸術の公募（演劇祭・レジデンス・戯曲賞・コンペ）を、締切・開催地・「参加費がかかる/無償/報酬・賞金が出る」つきで探せる無料サイト。${koubos.length}件を収録。`, rel: '', active: 'home', body }));
}

// ---- 公募一覧 ----
{
  let body = `<h1>公募を探す（${koubos.length}件）</h1>
<p class="lede">開催地別に全公募を掲載。各ページで締切・お金の向き・応募資格・出典を確認できます。</p>`;
  for (const b of BUCKETS) {
    const list = koubos.filter((k) => bucketOf(k.region).key === b.key);
    if (!list.length) continue;
    body += `<h2>${b.label}（${list.length}）</h2>` + list.map((k) => gitem(k, '')).join('');
  }
  write('koubo.html', layout({ title: `公募一覧（${koubos.length}件）｜${SITE_NAME}`, desc: `舞台芸術の公募${koubos.length}件を開催地別に一覧。締切・お金の向き・応募資格つき。`, rel: '', active: 'koubo', body }));
}

// ---- 締切・募集状況 ----
{
  const closed = koubos.filter((k) => !k.dlOpen);
  const body = `<h1>締切・募集状況</h1>
<p class="lede">「いま受付中」と「締切済み・次回募集の目安」を一覧。多くの公募は春〜初夏締切→秋〜翌冬本番のサイクルです。</p>
<h2>いま受付中（${openKoubos.length}）</h2>
${openKoubos.map((k) => gitem(k, '')).join('') || '<p class="note">現在受付中の公募はありません。</p>'}
<h2>締切済み・次回募集待ち（${closed.length}）</h2>
${closed.map((k) => gitem(k, '')).join('')}`;
  write('calendar.html', layout({ title: `締切・募集状況｜${SITE_NAME}`, desc: `舞台芸術公募の受付中・締切済み・次回募集の目安を一覧。`, rel: '', active: 'calendar', body }));
}

// ---- 地域別 ----
for (const b of BUCKETS) {
  const list = koubos.filter((k) => bucketOf(k.region).key === b.key);
  const open = list.filter((k) => k.dlOpen);
  const body = `<h1>${b.label}のアート公募（${list.length}件）</h1>
<p class="lede">${b.label}で応募できる舞台芸術の公募。締切・お金の向き・応募資格つき。</p>
${open.length ? `<h2>いま受付中（${open.length}）</h2>${open.map((k) => gitem(k, '../')).join('')}` : ''}
<h2>公募一覧</h2>
${list.map((k) => gitem(k, '../')).join('')}
<p class="note"><a href="../koubo.html">← 全地域の一覧に戻る</a></p>`;
  write(`regions/${b.key}.html`, layout({ title: `${b.label}のアート公募一覧｜${SITE_NAME}`, desc: `${b.label}で応募できる舞台芸術の公募${list.length}件。締切・お金の向きつき。`, rel: '../', active: 'koubo', body }));
}

// ---- お金の向き別 ----
for (const key of ['reward', 'free', 'paid', 'unknown']) {
  const list = koubos.filter((k) => (k.money || 'unknown') === key);
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
  const body = `<p class="note"><a href="../koubo.html">公募一覧</a> ／ <a href="../regions/${bucketOf(k.region).key}.html">${esc(bucketOf(k.region).label)}</a> ／ <a href="../money/${k.money || 'unknown'}.html">${m.label}</a></p>
<h1>${esc(k.name)}</h1>
<p class="lede">${esc(k.organizer)} ・ ${esc(k.region)}</p>
<div class="tags">${statusTags(k)}</div>
<div class="card">
<div class="kv"><div class="k">お金の向き</div><div class="v"><span class="tag ${m.cls}">${m.label}</span> ${esc(k.moneyLabel)}</div></div>
<div class="kv"><div class="k">締切・募集状況</div><div class="v">${esc(k.deadline)}</div></div>
<div class="kv"><div class="k">種別・ジャンル</div><div class="v">${esc(k.type)}／${(k.genres || []).map(esc).join('・')}</div></div>
<div class="kv"><div class="k">主な応募条件</div><ul class="cond">${(k.conditions || []).map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
${k.note ? `<p class="note">ℹ️ ${esc(k.note)}</p>` : ''}
<div class="src">📄 出典: <a href="${esc(k.src)}" target="_blank" rel="noopener">${esc(k.organizer)} 公式ページ</a></div>
<p class="verified">最終確認: ${esc(k.verified)}（公式ページで一次確認）</p>
</div>
<p><a class="cta sister" href="${SISTER_URL}" target="_blank" rel="noopener">この活動に使える助成金を「助成ものさし」で探す →</a></p>
${related.length ? `<h2>${esc(bucketOf(k.region).label)}の他の公募</h2>${related.map((q) => gitem(q, '../')).join('')}` : ''}
<div class="discl">掲載情報は募集要項の明示内容に基づく参考情報で、採択・出演を保証するものではありません。応募前に必ず公式の最新要項をご確認ください。締切・条件・金額は変動します。</div>`;
  write(`koubo/${k.id}.html`, layout({ title: `${esc(k.name)}｜${esc(k.organizer)}の公募｜${SITE_NAME}`, desc: `${esc(k.organizer)}「${esc(k.name)}」。${esc(k.region)}／${m.label}／${esc(k.type)}。締切・応募資格・出典を掲載。`, rel: '../', active: 'koubo', body }));
}

// ---- ポリシー ----
write('about.html', layout({
  title: `このサイトについて｜${SITE_NAME}`, desc: `${SITE_NAME}の目的・情報源・更新方針。`, rel: '', active: 'about',
  body: `<h1>このサイトについて</h1>
<div class="card">
<p>${SITE_NAME}は、舞台芸術・アートの「公募」——演劇祭・フェスティバル・アーティスト・イン・レジデンス・戯曲賞・コンペ・オーディションなど、出演・出展・滞在制作に応募できる機会を、締切・開催地・応募資格つきで探せる無料サイトです。助成金メディア「<a href="${SISTER_URL}" target="_blank" rel="noopener">助成ものさし</a>」の姉妹サイトです。</p>
<h2>特徴</h2>
<ul>
<li>「参加費がかかる／無償・施設提供／報酬・賞金が出る」という<strong>お金の向き</strong>を、各公募の第一級情報として掲載します。「出せるようになった、でもお金が厳しい」に直結する情報です。</li>
<li>公募に通ったあとの資金は、姉妹サイト「助成ものさし」の助成金検索に繋げられます。</li>
<li>各公募に出典（公式ページ）と最終確認日を明記し、募集要項の全文転載はせず事実項目のみを掲載します。</li>
</ul>
<h2>情報源と更新</h2>
<p>掲載情報は各主催の公式サイト・募集要項を一次確認したものです（最終確認: ${VERIFIED}）。多くの公募は毎年募集時期が変わるため順次更新しますが、応募前には必ず各主催の最新要項をご確認ください。</p>
<p>掲載内容の誤り・更新・新しい公募のご連絡は <a href="disclaimer.html">情報訂正の窓口</a> へ。</p>
</div>`,
}));

write('privacy.html', layout({
  title: `プライバシーポリシー｜${SITE_NAME}`, desc: `${SITE_NAME}のプライバシーポリシー。`, rel: '', active: 'about',
  body: `<h1>プライバシーポリシー</h1>
<div class="card">
<h2>アクセス解析・広告</h2>
<p>本サイトは現時点で解析・広告を導入しておらず、Cookieによる追跡は行っていません。将来導入する際は、初回アクセス時に同意バナーを表示し、同意した場合にのみ読み込みます。</p>
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
<p>掲載内容の誤り・古い情報、新しい公募のご連絡は、下記フォームからお寄せください（当面は姉妹サイトと共通の窓口です）。確認のうえ速やかに修正します。匿名で送信できます。</p>
<p><a class="cta" href="${FORM_URL}" target="_blank" rel="noopener">情報訂正・お問い合わせフォームを開く →</a></p>
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
