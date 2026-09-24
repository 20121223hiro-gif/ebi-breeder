# エビ色ブリーダー — 開発メモ（別PCで続けるときはまずここを読む）

ミナミヌマエビの繁殖×経営の携帯ゲーム。依存ライブラリなし（HTML5 Canvas + ES Modules）。通信なし、保存は端末内。
オーナーは 20121223hiro-gif。第1作「ほしキャッチ！」（https://20121223hiro-gif.github.io/hoshi-catch/）と同じ方針。

## 起動・テスト・公開
- `node serve.cjs` → http://localhost:15310（Windowsは `start.cmd` でも可。デスクトップにショートカットあり）
- `npm test`（node --test、純粋関数のテスト）。ルール変更時は必ず通す
- PWA: manifest.webmanifest / sw.js / icon-192,512。localhost では SW を登録しない（キャッシュ事故防止）
- 公開先: GitHub Pages https://20121223hiro-gif.github.io/ebi-breeder/ （リポジトリは PUBLIC）。2台のPCで編集するので作業前に git pull、作業後に git push

## 構成（ルールはDOMに触らない純粋関数、画面は ui.js）
| ファイル | 役割 |
|---|---|
| js/genetics.js | 遺伝（色相・発色・模様の3対、輝の突然変異、隠し色）、図鑑キー、名前候補 |
| js/sim.js | 時間進行（汚れ・餌・水温・寿命・孵化）、繁殖、見守り、遠征の出発/帰還、素材、バケツ、初期状態、定数 T |
| js/visitors.js | 買い付け客（1〜2hおき、40分滞在、相場×1.5〜3.3、評判Lv） |
| js/river.js | 遠征（行き先3つ、色の得意、カード生成、ワイルド個体、素材定義） |
| js/economy.js | 価格・出荷 |
| js/state.js | IndexedDB→localStorage 保存、セーブ版管理(migrate)、エラー記録 |
| js/render.js | 水槽Canvas（位置Mapは全水槽で共有。他水槽の個体を消さないこと） |
| js/ui.js | 全画面・演出（新色発見 .reveal / 遠征記録 .record / 出発帰還 .depart は render() で退避して残す） |
| js/main.js | 起動、ループ（裏では停止）、遷移（同一画面内は履歴を増やさない）、演出の待ち行列、`__ebi` デバッグ |

## 決まっている数値（オーナー承認済み）
- 孵化 4h（最初の1回だけ2分）、成体 12h、寿命 10日 —「1日1世代」。8h/24h/14日から短縮した
- 汚れ: 満員で48hで100%、60%黄・80%赤・90%で死亡判定。換水で−70。餌: 24hで0、20未満は繁殖不可
- 水温は月で固定（7〜9月28℃、12〜2月18℃、他24℃）。30℃以上で死亡判定（今は到達しない）
- プラケース定員8（800コイン）、30cm 20（3,000コイン）、60cm 60（12,000コイン・評判Lv5）
- 価格: 基本120コイン×★倍率(1,2,4,8,20)。透明60コイン、隠し色×6、ワイルド×0.7、川帰り(遠征5回)×1.2、ヌシ×3
- 最初の孵化は3匹固定（満員で失う体験を避ける）
- 遠征: 用水路(1匹〜,30分,間隔1h) / 小川(2匹〜,2h,4h,評判Lv2) / 源流(3匹,6h,12h,評判Lv3)。帰還率100%。★4縞・★5輝は川で出ない（縞は保因者まで）
- 満員時の仲間は「バケツ」(3匹、大きいバケツ+1)で待機し、プレイヤーが入れる/入れ替える/返すを選ぶ。勝手に「川に残った」にしない
- エビの移動は画面幅の2.5%/秒、向きは0.4秒かけて反転。「速い」と言われた履歴あり

## オーナーの好み（重要）
- 文字よりイラスト。ボタン・商品・素材はすべて絵（assets/icons）。新要素も絵を付ける
- 個体はIDでなく名前（色ごとの候補から自動命名、✎で変更）
- 演出は3秒程度の短いもの（出発・帰還の歩き、宝箱の開封）
- 提案は複数案を出して選んでもらう。数値は表で示す

## 素材の作り方
- Higgsfield gpt_image_2 で「Cute kawaii anime-style ... plain solid white background, no text」→ remove_background → PIL でトリム。エビは r2（赤★2）を参照画像に渡して色違いを作る
- エビ32枚: assets/shrimp/{r,b,y,k,g}{1..5}.png、h_{clear,choco,white,purple,gold}.png、s_berried/s_baby
- アイコン: assets/icons/{feed,water,river,breed,pla,s30,s60,bucket,leaf,wood,stone,snail,molt,chest_closed,chest_open,upgrade}.png
- 注意: 生成プロンプトに「no animals」を入れないと勝手にウーパールーパー等が描かれる（upgrade.png で発生）

## 水槽の見方（2026-09-20 追加）
- 'side'(横から・従来の画像) / 'top'(上から・エビは底を這う)。水槽詳細の右上ボタン（assets/icons/view_top / view_side）で切替。店舗のミニ水槽にも効く
- 設定は localStorage `ebi-breeder-view` に保存（セーブデータとは別。セーブ版は変えていない）
- 上からのエビは画像ではなく Canvas で描く（render.js drawShrimpTop）。色は横向き画像の代表色を tintOf() で拾う（32枚の上向き画像は作っていない）。絵にしたくなったら上向きの画像を Higgsfield で作って差し替える
- 位置 motion は両方の見方で共有。横向き y 0.3〜0.82 → 上から y 0.1〜0.9 に引き伸ばす（topPos）。進行方向 m.ang は移動方向からゆっくり旋回
- 横から見た表示でもエビは底を這う（2026-09-20）。motion.y は「奥行き」として使い、奥ほど小さく高い位置・手前ほど大きく低い位置（foot 0.87〜0.98h、大きさ 0.8〜1.08倍）。上から見た流木の上にいる個体は横からも流木の上面に乗せる（onWood）。上下のふわふわ(bob)はやめた
- 横向き画面（landscape, 高さ560px以下）は #app を 900px まで広げ、水槽 canvas を min(62dvh,420px) に。manifest の orientation は any
- 理由: オーナーから「エビは泳がず底を這う」「横向きにすれば広がる」と指摘

## 通貨（2026-09-21）
- 表示は「コイン」（メダルの絵 assets/icons/coin.png）。数値・レートは円のときのまま。画面は economy.coinHtml()、confirm/toast/log は fmtCoin()。内部の変数名(money, yen)はそのまま

## コインの増減演出（2026-09-21）
- ui.coinFx(delta): 3秒のオーバーレイ .coinfx（増=メダルの雨 assets/fx/coin_get.png、減=回って吸い込まれる coin_spend.png）+ coin.png の粒子 + 増減の数字。操作は邪魔しない(pointer-events:none)。render() で退避して残す
- 呼び出し: 個体カード出荷 / 出荷画面(客に渡す・自由出荷) / 脱皮殻売却 / 大きいバケツ購入 / 水槽購入。遠征の帰還は記録画面を「閉じる」でまとめて表示（見返しでは出さない）
- 元絵は Desktop\エビ色ブリーダー_コイン演出案（gpt_image_2_5 で4案生成→白背景を Pillow で透過。オーナーは両方とも案2を選択）

## 水槽のアップグレード（2026-09-24）
- sim.js `UPGRADE_PATH`（pla→s30→s60）、`upgradeInfo`、`upgradeTank`。価格は新品と同額（C案: 3,000 / 12,000、60cmは評判Lv5）— オーナーがA(差額)/B(差額+手間賃)/C から C を選んだ
- 中のエビ・設備・落ち葉効果・名前の記号はそのまま。定員だけ変わり、汚れは半減（水が増えて薄まる）。元には戻せない
- 入口は2つ: 水槽詳細のヘッダー右の絵ボタン（assets/icons/upgrade.png）と、ショップの「いまの水槽を大きくする」一覧。確認モーダル→ confirm → coinFx(−価格) → 水槽が一瞬ふくらむ .tank-pop

## デバッグ
```js
__ebi.hours(4)     // 時間を進める
__ebi.reset()      // セーブ消去
__ebi.demoChest()  // 宝箱の演出を見本表示
```

## 未実装・保留
注文ボード、親個体の購入、孵化の通知、スポイト掃除ミニゲーム、週末品評会、季節ごとの遠征の変化
