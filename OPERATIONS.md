# 公募ものさし 運用プラン（OPERATIONS.md）

> **この文書の位置づけ**: 2026-07-19 に Claude Code と Codex(gpt-5.6, xhigh) で壁打ちして作った運用設計。
> **まだ計画段階**であり、ここに出てくる新フィールド（`status` / `deadlineMachine` / `nextCheck` など）や
> `scripts/*.mjs`、GitHub Actions ワークフローは**未実装**。実装は 90 日プランの順序で進める。
> 現行データは `data/koubo.data.json`（409件）＋ `node build.mjs`＋GitHub Pages のみ。

---

## 最重要ルール5つ（毎日ここだけ見る）

1. **一次情報で確認できない事実は書かない。** 未確認なら `unknown` か「要再確認」に落とす。
2. **締切・受付状況・money を AI/CI だけで変えない。** 根拠URL付きの差分を人が承認してから公開する。
3. **`verified` は表示中の主要項目をすべて再確認したときだけ更新する。** URL到達確認や一括置換で触らない。
4. **21日以上未確認の「受付中」案件は受付中一覧から外し、詳細ページに「要再確認」と明示する。**
5. **P0 が残る／更新期限超過が10%を超えたら、新規追加を止めて既存の更新を先に終える。**

運用の背骨は「掲載数を増やすこと」ではなく、**409件を『次にいつ確認するか決まっているキュー』に変えること**。
迷ったら **fail closed**（未確認は新鮮に見せない・受付中扱いにしない）に倒す。

---

## 現状スナップショット（2026-07-19 時点）

- 総数 409件 / 受付中(`dlOpen:true`) 97件 / それ以外 312件
- money: `paid` 131 / `unknown` 113 / `reward` 85 / `free` 80
- 薄いジャンル: 美術 7 / 映像 0 / 文芸・戯曲 27（濃い: ダンス215 / 演劇182 / 音楽162）
- 必須フィールド充足・ID重複なし・不正money値なし・verified形式不正なし（＝いま導入する好機）

---

## 最初に直す表示バグ: グローバル `VERIFIED`

`build.mjs` の `const VERIFIED = '2026-07-18'` が、フッター・概要ページ・サイトマップで
**全409件が同一日に確認されたかのように**見せている（実際は各レコードの `verified` がバラバラ）。
グローバル日付を上げると未確認の全件まで新鮮に見えてしまうので**廃止**する。

- 詳細ページ: そのレコードの `verified` を表示（現状どおり）
- フッター: 「最終確認日は各詳細ページに表示しています」
- 概要ページ: 全件共通の確認日を出さない
- サイトマップ: 詳細は各 `verified`、一覧は更新時のみ変更
- 出典表記: 一律「主催者 公式ページ」ではなく「一次情報・公式発表」（`src` は配信PF上の主催者発表のこともあるため）

---

## 定期運用サイクル（CI が時計、人は事実判断だけ）

人の作業上限の目安 = **平日5〜10分 ＋ 週90分 ＋ 月2時間**。
「人がスクリプトを思い出して回す」運用は破綻するので、**GitHub Actions を運用時計にする**（後述）。

### 日次（AI/CI 主導、人は最小）
- CI: トリアージ上位を再計算し、運用Issueを更新。新規P0発生時だけ通知。
- 人: 運用Issueの **P0 と変更案だけ**確認（通常1〜3件・最大10分）。締切経過や明白な誤表示は即日修正・公開。
- 日次で見る対象: `dlOpen:true` なのに締切超過疑い / 7日以内締切 / 訂正フォームの具体的指摘 / 404 / 公式との矛盾。

### 週次
- AI: 期限到来順に25〜40件を一次情報で確認し、レコード単位の変更案を作る。
- 人: 週1回90分で差分レビュー。**1回の公開バッチは最大20件**（大量diffは見落としを生むので分割）。
  公式性・対象年度・締切時刻/TZ・money・応募条件を最終判断 → `node build.mjs` → 生成差分確認 → 公開。

### 月次
- CI: 409件のURL到達性を低速確認。鮮度・money・ジャンル・地域を集計。
- 人: ランダム10件を一次情報から再監査。新規は**月8件上限**（最初の90日は 美術4/映像2/文芸2 固定）。

### 四半期
- AI: open / reward・paid / unknown / 薄いジャンルから各10件=計40件の層化監査候補を作る。周期判定を再点検。
- 人: 40件を再監査（廃止・休止・URL移転を判断）。money/ジャンル分類の揺れ、地域偏りを見直し、確認頻度を調整。

---

## トリアージ設計

現行フィールドだけでスコア化する。**スコアだけでなく「なぜ上位か」の理由を必ず出力**する。

```js
function priority(k, today) {
  const text = k.deadline.normalize('NFKC');
  const ageDays = daysBetween(k.verified, today);

  const saysEnded = /終了|締切済|受付終了/.test(text);
  const saysOpen  = /受付中|募集中/.test(text);
  const rolling   = /随時|通年|常時/.test(text);
  const explicitDeadline = extractExplicitDeadline(text); // 曖昧ならnull
  const annualWindow = isNearExpectedWindow(text, today);

  // 内容矛盾は最優先（他の点数を無視）
  if (k.dlOpen && saysEnded) return { score: 999, reason: 'open-but-ended' };
  if (!k.dlOpen && saysOpen) return { score: 999, reason: 'closed-but-says-open' };
  if (k.dlOpen && explicitDeadline && explicitDeadline < today)
    return { score: 999, reason: 'open-after-deadline' };

  let score = 0; const reasons = [];
  if (k.dlOpen) { score += 50; reasons.push('currently-open'); }

  let expectedInterval;
  if (k.dlOpen && explicitDeadline && daysBetween(today, explicitDeadline) <= 30) expectedInterval = 7;
  else if (k.dlOpen)      expectedInterval = 14;
  else if (rolling)       expectedInterval = 30;
  else if (annualWindow)  expectedInterval = 14;
  else                    expectedInterval = 90;

  const overdueAge = Math.max(0, ageDays - expectedInterval);
  score += Math.min(40, Math.floor(overdueAge / 7) * 5);

  if (k.dlOpen && explicitDeadline) {
    const remaining = daysBetween(today, explicitDeadline);
    if (remaining <= 7) score += 30; else if (remaining <= 30) score += 15;
  }
  if (!k.dlOpen && annualWindow) score += 25;
  if (rolling) score += 8;

  // 誤分類時の利用者被害が大きい順
  if (k.money === 'reward')  score += 15;
  if (k.money === 'paid')    score += 12;
  if (k.money === 'unknown') score += 5;

  // 薄いジャンルは再調査・拡充の優先度を少し上げる
  if (k.genres.some(g => ['美術','映像','文芸・戯曲'].includes(g))) score += 8;

  return { score, reasons };
}
```

優先度バケツ:
- **P0**: 矛盾 / 締切超過の受付中 / 重大な訂正指摘 → 即日
- **P1**: 70点以上 → 48時間以内
- **P2**: 40〜69点 → 週次バッチ
- **P3**: 20〜39点 → 月次
- 保留: 20点未満 → 予定日まで触らない

> `deadline` の正規表現解析は**確認順を決めるためだけ**に使う。解析結果で `dlOpen`・締切を自動変更しない。

### 開催日フィールド（実装済み）

巡演候補の表示には、任意項目の `eventStart` / `eventEnd`（`YYYY-MM-DD`）を使う。

- 現年度の公式情報で開催日が明記された場合だけ入力する。締切文の曖昧な文章から自動推測しない。
- 1日開催は両方に同じ日を入れる。複数日程は最初の開催日と最後の開催日を入れる。
- 開催日を一次確認できないレコードでは未入力のままにし、巡演候補を表示しない。
- 詳細ページでは、開催期間の前後45日以内・共通ジャンルあり・別主催のレコードだけを候補にする。「同じ作品を巡演できる」とは断定しない。

### 追加するフィールド（優先順）

```json
{
  "status": "open | closed | expected | rolling | unknown | retired",
  "deadlineMachine": "2026-08-31 または 2026-08-31T17:00:00+09:00",
  "nextCheck": "2026-08-01",
  "recurrence": "annual | biennial | rolling | oneoff | irregular | unknown",
  "recurrenceBasis": "official | observed_history | unknown",
  "sourceType": "official_page | official_pdf | official_release"
}
```

ルール:
- `deadlineMachine` は**現在の募集**が公式に明記された場合だけ設定。時刻不明なら日付だけ（23:59等を勝手に補わない）。次回募集の推測には使わない。
- `nextCheck` は内部の作業予定日なので**推測で設定してよい**。
- `recurrence:annual` でも `recurrenceBasis:observed_history` なら表示は「過去2回は○月募集」。公式が毎年開催と明記していない限り「例年」と断定しない。
- `retired` は削除せず、通常の検索結果から外して記録を残す。
- `lastChecked` は**追加しない**（`verified` と重複し、リンクを見ただけで確認日が新しくなる事故を誘発）。URL到達確認日は `link-report.json` 側にだけ持つ。
- 最終的に `status` を正とし、`dlOpen` はビルド時に導出してデータから削除。移行期間は両者の矛盾をバリデーションで禁止。

### `nextCheck` の決め方
- 受付中・締切31日以上先 → 14日後 / 8〜30日 → 7日後 / 7日以内 → 締切翌日
- 随時募集 → 30日後 / 年次で次回未発表 → 過去締切月の90日前 / 隔年 → 想定年の120日前
- URL不通・状態不明 → 7日後 / 単発終了・廃止確認済み → `null`

---

## 表示の fail-closed（21日ルール）※ ビルドは止めない

締切鮮度の問題で**ビルドをハードfailさせない**（無関係な修正のデプロイまで止まり、`verified` だけ触って通す不正を誘発するため）。
代わりに**表示レベルで受付中扱いを止める**。

```js
function effectiveStatus(k, today) {
  const age = daysBetween(k.verified, today);
  if (k.dlOpen && k.deadlineMachine && new Date(k.deadlineMachine) < today) return 'needs-review';
  if (k.dlOpen && age > 21) return 'needs-review';
  return k.dlOpen ? 'open' : 'closed';
}
```

`needs-review` のレコードは JSON を変えずに、ビルド時の表示だけ:
- 「受付中」一覧から外す / トップの受付中件数に含めない / 一覧では確認済みの後ろに並べる
- 詳細ページは残し、黄色の「受付状況 要再確認」バッジ＋「掲載上は受付中でしたが最終確認から21日超。公式情報をご確認ください」
- 元の締切文字列・`verified`・`src` はそのまま表示
- 15〜21日目は降格せず「最終確認から○日」の軽い警告のみ。22日目から受付中扱いを止める。

**ハードfailは構造エラーだけに限定**: JSON構文 / ID重複 / 必須欠落 / 不正enum / 不正日付 / 出力先衝突 / `src` がURLとして不成立。
例外: PR で**そのレコード自身に新しい矛盾**を持ち込んだ場合だけ、そのPRのチェックをfailさせてよい（既存の更新負債と新規混入エラーを分ける）。

---

## 自動化と人手の線引き

### 自動化してよい（CI/スクリプト/AI）
JSON・enum・日付・URL形式の検査 / トリアージ計算 / 締切文字列と `dlOpen` の矛盾検出 / HTTP状態確認 /
Gitのレコード単位diff要約 / 静的HTML生成 / **公式ページを読んだ上での変更"案"作成** / 根拠・未確認・確信度の整理 / 集計。

### 人が必ず最終判断
そのページが本当に主催者の一次情報か / 現在年度・現在回の要項か / 応募期間と締切時刻・TZ / `money` 分類 /
応募資格の要約 / 旧イベントと新イベントが同一事業か / 404移転先が公式後継か / AI差分を公開するか。

### AI 提案フォーマット（固定）

```json
{
  "id": "対象ID", "checkedAt": "2026-07-19", "sourceUrl": "一次情報URL",
  "sourceType": "official_pdf", "edition": "2027",
  "proposedChanges": { "deadline": "変更案", "status": "open" },
  "evidence": [{ "field": "deadline", "locator": "募集要項2ページ「応募期間」",
                 "excerpt": "必要最小限の短い引用", "confidence": "high" }],
  "unchanged": ["organizer", "conditions"], "unresolved": ["money"]
}
```

確信度: `high`=現年度の公式ページ/PDFに明記 / `medium`=公式だが年度・表現が曖昧 / `low`=検索結果・二次記事・過去回推測。
**公開データに反映してよいのは `high` だけ。** `medium`/`low` は確認キューに残し、`dlOpen:true` や `money:reward` の根拠にしない。

### money 判定順（利用者保護優先）
1. 必須の応募料・参加費がある → `paid`
2. 必須費用なし＋現金・賞金・出演料・制作費が明記 → `reward`
3. 現金授受なし＋施設・滞在の無償提供が明記 → `free`
4. それ以外・曖昧 → `unknown`

「応募無料だが制作・渡航・会場費は自己負担」は自動で `free` にしない（`moneyLabel` に自己負担を明記、合わなければ `unknown`）。
有料コンクールで賞金もある場合は安全側に `paid`、`moneyLabel` に賞金を併記。混合案件が多ければ90日後に `moneyFlags` 複数タグ化を検討。

---

## GitHub Actions 構成（データのWrite権限を与えない）

CI は「何を見るべきか」を決める。人が「何が事実か」を決める。**CI に `contents:write` を与えない。**

```yaml
permissions:
  contents: read
  issues: write
```

- **`validate.yml`**（PR / main push / 手動）: JSON・enum・ID重複・締切と`dlOpen`の矛盾・`deadlineMachine`超過・`verified`未来日・**変更レコードへの新規矛盾混入**・ビルド完走を検査。既存の鮮度警告ではfailさせない。
- **`ops-triage.yml`**（毎日09:17 JST目安）: P0〜P3再計算・`nextCheck`超過・21日超過open・7日以内締切を抽出し、上位30件を**単一の運用Issue**に更新。新規P0のときだけコメントで通知。完全な `worklist.json` は artifact 保存。
- **`ops-link-check.yml`**（毎週月曜朝）: 409件の `src` をHEAD中心で低速確認（ホスト同時1・全体2〜3）。404/410/timeout抽出、301/302は移転候補として記録のみ、403/429はリンク切れ扱いしない。`link-report.json` を artifact 保存。**URL確認で `verified` を更新しない。**
- **`ops-monthly.yml`**（毎月）: 鮮度・`nextCheck`超過率・money/ジャンル/地域内訳・URL確認率・前月差分を job summary と運用Issueに出す。

**CI に絶対させない**: `dlOpen`/`money`/`deadline`/`verified` の変更、`src` の自動リダイレクト追従、404レコード削除、新規追加、main への自動コミット。

---

## 作るべきスクリプト（依存なし Node ESM）

| ファイル | 入出力 |
|---|---|
| **`scripts/triage.mjs`** ★1本目 | `koubo.data.json`＋基準日 → 優先度・理由・推奨確認日を出力。データは変えない |
| `scripts/validate-data.mjs` | 必須項目・enum・重複・日付・URL・status矛盾を検査。重大エラーで exit 1（ビルド前提） |
| `scripts/check-links.mjs` | `src` を低速HEAD確認 → `ok/redirected/blocked/missing/timeout` をJSON出力 |
| `scripts/diff-records.mjs` | Git HEAD版と現在版をID単位で比較し、変更フィールドだけ表示 |
| `scripts/metrics.mjs` | 鮮度・期限超過・money・ジャンル・地域・整合性を集計出力 |
| `scripts/make-proposal.mjs` | 対象IDから AI提案テンプレ（URL・根拠・確信度・変更案・未確認）を生成 |

**1本目は `scripts/triage.mjs`。** 理由: データが新鮮な今のうちに「次に見るべき10件」を機械的に決めないと、
数週間後に409件が再び無秩序な更新対象に戻る。リンクチェッカーやメトリクスより、毎日の作業対象を絞る仕組みが先。

`validate-data.mjs` でエラーにする例: `dlOpen:true`＋「終了」同居 / `status:open` なのに機械可読締切超過 / `verified` 未来日 /
`status`と`dlOpen`不一致 / reward・free・paid なのに `moneyLabel` 空 / 必須配列空 / ID重複 / 不正URL。
受付中は14日超過で警告・21日超過で（表示降格＋）強い警告。確認できないなら日付を触らず `status:unknown` に落とす。

---

## discovery（新規発見）のランプ

最初90日は鮮度優先で**月8件**（美術4/映像2/文芸2）。90日後、再確認キューが**2か月連続で安定**したら**月12件上限**へ。
（安定条件: P0滞留0・`nextCheck`超過率5%未満・受付中21日超過0・URL月次確認率100%・人手が週2時間程度）。
条件を外れた月は月8件へ戻す。超過率10%以上なら新規停止。

### 供給源の優先順（必ず一次情報まで遡る）
1. **既知主催者の公式募集ハブ**（最安定）: 公立文化施設・劇場/ホール・芸術文化財団・アーツカウンシル・美術館/アートセンター・映像文化施設・文学館・国際芸術祭・AIR運営・戯曲賞/コンクール主催。公募単位でなく主催者の「公募/募集/ニュース」ページを監視登録。最初は**約100主催者の watchlist**（月25主催者ずつ確認＝四半期で一巡）。
2. **公式の年間スケジュール**（次回募集の予測材料）: 名称が出ただけでは掲載せず、正式な募集要項公開後に追加。
3. **公式RSS・メルマガ・許諾フィード**: タイトル・URL・公開日だけ候補キューに保存。本文は転載しない。
4. **主催者からの持ち込み**: 訂正フォームとは別に「掲載依頼フォーム」を用意。送信内容は事実採用せず**公式URL確認のためのリード**として扱う。「掲載無料・公式募集要項が確認できるものに限る」と明記。
5. **二次情報/検索/ニュース**: 発見の入口としてのみ。見つけたURLを直接 `src` にせず、必ず主催者の公式ページ/PDF/公式発表まで遡る。遡れなければ掲載しない。

watchlist と候補は公開JSONに入れず別ファイルに持つ:

```json
// ops/watchlist.json（監視する主催者ハブ）
{ "name": "主催者名", "url": "公式の募集一覧URL", "genres": ["美術"], "region": "○○県",
  "cadence": "monthly", "nextCheck": "2026-11-01", "lastSeen": "2026-10-01" }

// ops/candidates.jsonl（発見した公募リード。1行1件）
{ "discoveredAt": "2026-11-05", "leadUrl": "発見元", "officialUrl": null,
  "channel": "official-newsletter", "status": "new" }
```

月12件の配分（ジャンル偏在が解消するまで固定）: 美術4 / 映像3 / 文芸2 / 薄い都道府県2 / 海外・大規模1。
候補は月30件集める想定（公式URL到達18〜20 → 条件完全確認12 → 公開最大12、残りは保留/翌月）。

---

## 健全性の数値目安（この JSON から node で自前集計）

**鮮度**: 受付中14日鮮度 ≥95%（現97/97=100%） / 受付中21日超過 常時0 / 全体90日超過率 <10% / `nextCheck`超過率 <5% / P0の24h超過 0。
**カバレッジ**: 薄いジャンルを90日で 美術≥19 / 映像≥6 / 文芸・戯曲≥33。地域は「1件以上」でなく**3件未満の都道府県数**を減らす。
**信頼性**: 必須充足100% / ID重複0 / 不正money0 / deadline-status矛盾0 / reward・paidの30日鮮度 ≥90% / URL月次確認率100% / 正常or正当リダイレクト率 ≥97%。
※ `money:unknown`（現113件=27.6%）の削減はKPIにしない（根拠なき分類を誘発するため）。件数は観察のみ。

---

## 最大の失敗モード3つ

1. **締切済みなのに「受付中」表示が残る**（最も即効の信用毀損）→ 受付中を最優先スコア化・7日以内は毎週確認・`deadlineMachine`導入・締切超過とopenの同居をビルド警告(P0)・21日確認不能で表示降格・締切翌日に自動で確認対象化（ただし自動で事実を書き換えない）。
2. **AIが二次情報・過去回から money/条件を補完する**（特に `reward` 誤表示・参加費見落とし・資格省略）→ フィールド別に根拠URL/箇所を必須化・現年度一次情報のみ `high`・`medium`/`low` は非反映・money は必ず人が判断・過去回金額は「前回実績」明記・確認不能なら惰性維持せず `unknown` へ・人がレコード単位diffを確認して公開。
3. **新規掲載を増やしすぎ、既存409件が静かに腐る**（グローバル確認日更新でこの劣化が隠れる）→ グローバル`VERIFIED`廃止・全件 `nextCheck` 保持・期限超過10%で新規停止・月上限順守・月次で全URL確認・四半期40件再監査・休止/廃止は `retired`・1変更20件以内。

---

## 90日立ち上げステップ

- **1〜7日**: グローバル`VERIFIED`廃止・出典表記変更・事実/前回実績/未確認の文言ルール確定・money判定順固定・**`scripts/triage.mjs` 作成**・P0を洗い出して即修正・「受付中は21日以上未確認にしない」をルール化。
- **8〜21日**: `validate-data.mjs`・`diff-records.mjs` 作成（validateはビルド前提化）・`status`/`deadlineMachine`/`nextCheck` 仕様確定・受付中97件に機械的な `nextCheck` 案・AI提案の根拠フォーマット固定。
- **22〜45日**: 409件全部に `nextCheck` 割当・明白な随時/通年/年次だけ `recurrence`＋`recurrenceBasis`・`check-links.mjs` 作成・初回の全URL確認（404/移転/不明を処理）・新規8件（美術4/映像2/文芸2）。
- **46〜60日**: `status` をビルド側の正規状態に・`dlOpen` 不一致をエラー化・`metrics.mjs` 作成・週次バッチを2回以上・人のレビュー件数と所要時間を記録・ランダム10件再監査。
- **61〜90日**: 週次/月次サイクル固定・薄いジャンル追加を継続（合計24件増目標）・全URL2回目確認・40件層化監査・`status`移行が安定なら `dlOpen` 廃止判断・money混合案件を数えて複数タグ化の要否判断・人手が週2時間に収まるよう頻度調整。

### 90日後の合格条件
P0滞留0 / 受付中21日超過0 / `nextCheck`超過率<5% / 全件（`retired`除く）に次回確認予定あり / 必須・enum違反0 /
URL月次確認率100% / **人がレビューしていないAI由来の事実変更0** / 美術≥19・映像≥6・文芸≥33 / 通常週の人手が約2時間以内。
