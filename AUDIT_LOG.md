# 受付状況ファクトチェック記録

## 2026-07-21 — 第1バッチ（時系列リスクの即時是正）

### 対象と判定方法

- 調査開始時の `dlOpen: true` は97件。
- 現年度の主催者公式ページまたは公式PDFで、受付期間・締切・応募方法を確認したものだけを「受付中」とした。
- 公式の一次情報で現行募集を確認できないものは、終了と断定せず、`dlOpen: false` として「要再確認」に落とした。
- URLの到達可否や二次情報だけでは、受付中の根拠にしない。

### 受付中から外したレコード

| ID | 判断 | 一次情報で確認したこと |
| --- | --- | --- |
| `solamachi_daidogei` | 終了 | 2026年フェスティバル公式ページに「本イベントは終了いたしました」と明記。 |
| `matsuri_tsukuba_dance_festival` | 終了 | 追加募集の締切は2026-07-19 18:00。 |
| `session21_yobigoe` | 受付開始前 | vol.141の電話申込開始は2026-07-27 12:00。締切ではない。 |
| `wing_saien_hakurankai` | 要再確認 | 公開中の公式トップページで2026年度の当該募集を確認できなかった。 |
| `osaka_gakusei_engekisai` | 要再確認 | 2026年度の募集要項を一次情報で確認できなかった。 |
| `prix_de_kanazawa` | 要再確認 | 公開中の公式ページは第9回（2025年）で、第10回（2026年度）の要項を確認できなかった。 |

### 現年度の一次情報で更新したレコード

| ID | 更新した事実 |
| --- | --- |
| `session_house_dzone` | 申込期間は2026-07-13〜10-04。 |
| `nara_bunkamura_air` | 応募締切は2026-07-26必着。支援内容・応募条件も公式PDFで再確認。 |
| `e9_kyoto_riyoudantai` | 2026年度追加募集は先着順。固定締切は公式に明記なし。 |
| `nba_nagoya_ballet` | 受付終了日は2026-08-05。定員到達時は早期締切。 |
| `oji_startdash` | 条件を満たす団体は応募可能。年度単位で審査、年約10枠。 |

### 検証結果

- `node scripts/triage.mjs --date 2026-07-21` でP0（受付中なのに締切超過・終了表示）は **0件**。
- 受付中表示は97件から91件へ減少。
- この時点で残り91件すべてを再確認済みという意味ではない。次はP1の30件を、締切が近い順に公式一次情報と照合する。

### 次の確認キュー

1. 7日以内の締切: `nara_bunkamura_air`、`miyazaki_to_r_mansion_meros`
2. 7月末締切: `kac_air`、`kyoto_choreo_lab_2026`、`fukushima_bungakusho_drama` など
3. 随時・通年・ローリング表記: `raft_mochikomi`、`terpsichore_butoh_shinjin`、`pom_plaza_hall_riyoudantai` など

詳細な運用ルールは [OPERATIONS.md](OPERATIONS.md) を参照。
