# DICT_PONG — AWSコンソールでの設置手順

GitやGitHubは使いません。PCにAWS CLIやプログラミング環境を入れる必要もありません。アプリZIPをS3へ、YAMLをCloudFormationへアップロードすると、必要なサーバー一式を自動作成します。

## 最初に：どのファイルを、どこへ送るか

**まず `PONG-AWS-kit.zip` を右クリック →「すべて展開」。中にあるファイルを次のように使います。**

| PC上のファイル | AWSで開く画面 | すること |
| --- | --- | --- |
| `pong-app.zip` | S3 → 自分のバケット → アップロード | ZIPのまま送る。バケット直下に `pong-app.zip` が1個見えればOK |
| `pong-stack.yaml` | CloudFormation → スタックの作成 → テンプレートファイルのアップロード | YAMLだけを選ぶ。S3に送ったZIPはここでは選ばない |
| `AWS_SETUP.html` | PCのブラウザ | この手順書。AWSに送らない |
| `ARCHITECTURE.svg` | PCのブラウザ | 構成図。AWSに送らない |

例：S3画面上部に `my-dict-pong-20261028-example`、オブジェクト一覧に `pong-app.zip` が表示されている場合、CloudFormationの **ArtifactBucket は `my-dict-pong-20261028-example`、ArtifactKey は `pong-app.zip`** です。

`PONG-AWS-kit.zip` をそのままS3に送ると起動できません。`pong-app.zip` を展開して中身を送るのも別の操作です。更新時は同じバケット・同じキーに新しい `pong-app.zip` を上書きします。

すでに公開済みなら「8. ゲームを更新する」と「8-A. 既存AWS環境への反映」を使います。新しいスタックを重複作成する必要はありません。

## 1. 用意するもの

- AWSアカウントと、CloudFormation・EC2・VPC・IAM・S3・CloudFront・Secrets Manager・Systems Manager・EventBridge Scheduler・CloudWatchを作成・管理できるAWS操作権限。
- 配布ZIP `PONG-AWS-kit.zip` をPCで展開したフォルダ。
- 中の `pong-app.zip` と `pong-stack.yaml`。**`pong-app.zip` はAWS用には展開しません。**
- 初回の作成が完了するまで待てる時間。サーバー初期設定やCloudFrontの準備に時間がかかります。

AWSサービスは課金対象です。EC2を起動している時間、EBS、パブリックIPv4、S3、CloudFront、Secrets Managerなどに利用料が発生します。無料で運用できることは保証しません。料金はリージョンや使用量に依存するため、AWS Pricing Calculatorで確認してください。AWS Budgetsで予算通知を設定してから始めると把握しやすくなります。

この手順は東京リージョン `ap-northeast-1` を例にしています。中国・GovCloudリージョンは対象外です。

## 2. S3バケットを作成する

1. AWSマネジメントコンソールにサインインします。
2. 右上のリージョンを **アジアパシフィック（東京）** にします。
3. 上の検索欄で **S3** を検索して開きます。
4. **バケットを作成** を押します。
5. バケット名に、例えば `my-dict-pong-20261028-任意の英数字` を指定します。実際には英小文字・数字・ハイフンだけにしてください。全世界で重複しない名前が必要です。
6. リージョンは東京、バケットタイプは汎用、オブジェクト所有者は推奨のACL無効を選びます。
7. **パブリックアクセスをすべてブロックはオンのまま** にします。静的ウェブサイトホスティングも有効にしません。
8. 暗号化は既定の **SSE-S3** を使います。独自のKMSキーを指定すると、追加の権限設定が必要になります。
9. 作成を完了し、決めたバケット名をメモします。

このS3は配布ZIPとバックアップの保存場所です。プレイヤーがS3のURLへアクセスする構成ではありません。

## 3. アプリZIPを手動アップロードする

1. 作成したバケットを開きます。
2. **アップロード → ファイルを追加** を選びます。
3. `pong-app.zip` を選択します。`PONG-AWS-kit.zip` や展開済みフォルダを選ばないでください。
4. バケットの一番上の階層にアップロードします。ファイル名は `pong-app.zip` のままにします。
5. 成功したことを確認します。

バケット名とオブジェクトキーは別物です。キーには `pong-app.zip` とだけ入力します。`s3://...` やURL全体は入力しません。

## 4. CloudFormationでサーバーを作る

1. AWSコンソールで **CloudFormation** を検索して開きます。リージョンは東京のままです。
2. **スタックの作成 → 新しいリソースを使用（標準）** を選択します。
3. テンプレートの準備は既存のテンプレート、指定方法は **テンプレートファイルのアップロード** を選びます。
4. PC上の **`pong-stack.yaml`** を選び、次へ進みます。
5. スタック名は、例えば **`dict-pong`** にします。
6. パラメータを次のように指定します。

| 項目 | 入力する内容 |
| --- | --- |
| ArtifactBucket | 手順2で作成したバケット名 |
| ArtifactKey | `pong-app.zip` |
| InstanceType | 最初は既定の `t3.small`。小規模な試運転なら `t3.micro` も選択可能 |
| DataVolumeSize | 既定の `8` のまま（データ用ディスク8GiB） |
| CpuCredits | `standard`：CPUクレジット超過による追加料金を抑制。残量ゼロでは処理速度が制限される |
| EnableNightSchedule | `true`：毎日、日本時間0時にEC2停止・8時に起動 |
| LogRetentionDays | `7`：CloudWatchログを7日保存した後、自動削除 |
| LatestAmiId | 既定値を変更しません |

7. 次の画面のタグや追加設定は、必要がなければ既定のまま進めます。
8. 確認画面で、**CloudFormationがIAMリソースを作成することの承認** にチェックを入れます。
9. **送信／スタックの作成** を押します。
10. イベントを確認し、スタック全体が **`CREATE_COMPLETE`** になるまで待ちます。

自動で専用VPC、EC2サーバー、固定IP、データ用ディスク、HTTPS配信用CloudFront、バックアップ、更新用コマンドを作成します。SSH用の鍵や独自ドメインの取得は不要です。プレイヤーや管理者用のパスワードも作成しません。

加えて夜間停止・朝の起動スケジュール、CloudWatchログ、利用状況ダッシュボードを自動作成します。

**`GameServer` だけが完了していても、初期設定が終わったとは限りません。** `ServerReady` とCloudFrontを含むスタック全体の完了を確認してください。初期設定に失敗した場合は正常完了にせず、待機リソースを失敗させる構成です。

## 5. ゲームを開く

1. 完了したスタックの **出力** タブを開きます。
2. **`GameURL`** の値をコピーします。`https://xxxxxxxx.cloudfront.net` のようなURLです。
3. ブラウザでそのURLを開きます。EC2のIPやS3のURLではありません。
4. 名前を入力して参加し、CPU戦を1回試します。
5. 同じGameURLを友だちに伝えます。各自が異なる名前で参加してください。

名前は同じであれば記録を引き継ぎます。大文字・小文字は区別します。ログイン情報は通常30日間ブラウザに保持されます。同じ名前を同時に2画面で接続できません。

## 6. オンライン対戦と管理画面を確認する

### オンライン対戦

- 別の端末またはシークレットウィンドウで、異なる名前を使います。
- 2人とも **対戦相手を探す** を押すと、自動で対戦が始まります。
- 友だちだけと遊ぶ場合は **友だちタブ** で片方がルームを作り、表示された6文字のコードを相手に伝えます。相手も友だちタブでコードを入力して **参加** を押します。
- どちらのプレイヤーにも自分が左側に見えます。
- 対戦中はコート上部の **降参する** から、確認後に試合を終了できます。現在の得点で自分の負け・相手の勝ちを記録します。
- ダークモードのホームで名前と対戦モードを選びます。ホームにはゲーム画面を表示せず、対戦開始時にコートへ自動で切り替えます。試合後は **ホームに戻る** で戻れます。戦績は **マイ戦績** にまとめています。

### 管理者

1. ログアウトして、名前を **`chun`** にして参加します。
2. サイドメニューまたは下部メニューに **管理** が表示されます。
3. 管理キーやパスワードの入力はありません。
4. 接続中プレイヤー、進行中の相手と対戦モード、各プレイヤーの戦績を確認できます。
5. 停止設定を編集したら **設定を保存する** を押します。

指定された仕様どおり、`chun` と名乗る人は誰でも管理者です。`Chun` と `CHUN` は管理者ではありません。

### 停止設定

- **すべてのゲームを停止**：進行中のオンライン戦とCPU戦を中断し、新規対戦とマッチングも止めます。
- **毎日のプレイ制限**：日本時間固定です。例えば `23:00 → 07:00` なら、毎日23時から翌朝7時まで停止します。
- **日時を指定して停止**：端末の現地時間で入力します。内部ではUTCに変換して保存します。日本にいる場合は通常そのまま日本時間です。20件まで登録できます。
- 複数の停止条件のうち1つでも該当すれば停止します。全体停止のチェックを外しても、予約時間帯に該当していれば再開しません。
- 中断は勝ち負けに含めません。中断までのプレイ時間は記録します。再開後は新しい試合を開始します。

## 7. データと自動バックアップ

ゲームデータはEC2とは別の暗号化EBSディスクに、SQLite形式で保存します。通常のアプリ再起動では消えません。

- データ本体：サーバーの `/var/lib/pong/pong.sqlite`。
- 初回起動時と、その後およそ1時間ごとに、整合性を保ったSQLiteバックアップをS3に保存します。
- スタック出力の **`BackupLocation`** が保存先です。
- S3でバケットを開き、`backups → スタック名` と進むと `pong-日時.sqlite.gz` が並びます。
- バックアップはUTCの日時で命名します。戦績、名前、セッション情報、停止設定を含みます。
- S3のパブリックアクセスはブロックしたまま使います。

バックアップは自動削除しません。S3の **管理 → ライフサイクルルール** で `backups/` を対象に、例えば30日後の期限切れを設定すると保管量を制御できます。復旧したい期間を考えて日数を決めてください。バージョニングを有効にした場合は、古いバージョンにも別途期限の設定が必要です。

## 8. ゲームを更新する（Git不要）

初回と同じバケット・同じキーに新しいアプリZIPを上書きしてから、AWSコンソールのコマンドを実行します。CloudFormationスタックを作り直す必要はありません。

1. ゲーム内で `chun` として全体停止を保存します。停止理由に更新作業中と書いておきます。
2. S3を開き、新しい **`pong-app.zip`** を、最初と同じ場所・同じ名前でアップロードします。
3. CloudFormationの出力で **`UpdateCommandDocument`** と **`ServerInstanceId`** を確認します。
4. AWSコンソールで **Systems Manager → Run Command → コマンドの実行** を開きます。
5. コマンドドキュメントに、出力の `UpdateCommandDocument` と同じ名前のものを指定します。必要なら所有者を「自分が所有」に絞ります。
6. ターゲットは **手動でインスタンスを選択** にして、`ServerInstanceId` と一致する1台だけを選びます。
7. 実行し、ステータスが **Success** になるまで待ちます。
8. GameURLを再読み込みし、CPU戦などを確認します。必要に応じて停止設定を解除します。

更新前にバックアップし、戦績や設定を保存したデータディスクはそのまま使用します。更新後の起動確認に失敗した場合は前のコードへ戻します。データベースを変更する大型更新の移行や、Node.jsのバージョン変更は、この簡易更新の対象外です。更新後も停止設定は保存されています。

更新を繰り返してもURLは変わりません。CloudFrontのキャッシュは無効化しているので、通常はキャッシュ削除操作は不要です。

## 8-A. 既存AWS環境への反映（夜間停止・ログ）

**アプリZIPの更新だけでは、AWSの夜間停止やログ用リソースは増えません。今回のYAMLへのスタック更新も必要です。** 作業は日本時間8時以降に行います。

1. `chun` で全体停止を保存し、S3に最新バックアップがあることと、現在の `ServerInstanceId`・`PersistentDataVolume` を控えます。
2. 新しい `pong-app.zip` をS3の同じ場所に上書きします。
3. CloudFormation → 既存のスタック → **更新 → 既存のスタックに直接更新 → 現在のテンプレートを置き換える → テンプレートファイルのアップロード** で、新しい `pong-stack.yaml` を選びます。画面の文言が異なる場合も「既存スタックのテンプレート置換」を選びます。
4. **ArtifactBucket / ArtifactKey / InstanceType / DataVolumeSize は現在の値を維持**。新設の `CpuCredits=standard`、`EnableNightSchedule=true`、`LogRetentionDays=7` を確認します。サーバーサイズ変更は後日、別の更新で行います。
5. 変更セットでScheduler・ロググループ・ダッシュボード・IAM・SSMドキュメントの追加を確認します。UserData変更によりEC2が停止・再起動することがあります。**GameServerやDataVolumeに「置換」が表示されたら実行せず、AMI等の変更原因を確認**してください。今回の追加のためにデータディスクを作り直す必要はありません。
6. IAMリソース作成の承認にチェックを入れて更新し、`UPDATE_COMPLETE` を待ちます。
7. **更新後の出力** にある `UpdateCommandDocument` と `ServerInstanceId` で、手順8のRun Commandを実行します。古いサーバーには古い更新スクリプトが残っているため、この1回では監視設定がまだ入らない場合があります。
8. 続いて出力の **`MonitoringCommandDocument`** をRun Commandで同じ1台に実行し、`Success` を確認します。新しいアプリ内の監視設定を適用し、ゲームを再起動します。何度実行しても同じ設定になります。
9. 出力の `DashboardURL` を開き、1〜2分後にログと利用状況を確認します。GameURLで操作を試し、ゲーム内の全体停止を解除します。

初回新規作成時には監視設定も自動実行されるので、この追加作業は不要です。スタック更新で設定したスケジュールは次の指定時刻から動きます。午前1時に設定しても直ちに停止するわけではありません。

## 8-B. 夜間停止と費用を確認する

- 毎日 **00:00に停止、08:00に起動**。タイムゾーンは `Asia/Tokyo` 固定です。8時の起動指示後、OS・ゲームが使えるまで数分かかります。停止中はゲーム画面もCPU戦も利用できず、CloudFrontの接続エラーが表示されることがあります。
- 正常停止時は進行中の試合を勝敗なしの中断として保存します。朝は新しい試合を始めます。ディスク上の戦績・設定、Elastic IP、GameURLは維持します。
- 24時間稼働と比べ、EC2の稼働時間は24時間から約16時間になり、**オンデマンドのEC2稼働時間に対する費用を約33%削減**できます。請求総額が33%下がるという意味ではありません。
- **EBS（OS用12GiB＋データ用8GiB）と固定パブリックIPv4は停止中も課金対象**です。S3・CloudFront・Secrets Manager・CloudWatch・Scheduler等の利用料は別です。予約やSavings Plans等の契約がある場合、停止しても契約料金は減りません。
- `t3.small` を既定のままにし、少人数で使うならバックアップ後に `t3.micro` を試します。CloudWatchでCPU・CPUクレジット・メモリと実際のラグを見て判断します。`standard` はクレジット不足時にCPU性能を制限します。人数の保証値はありません。
- まずログを7日保存、ダッシュボード表示期間を3時間にします。自動更新はオフまたは長めにします。Logs Insightsはスキャン量で課金されるため、長期間のクエリを何度も更新しないようにします。追加のカスタムメトリクスは発行しません。ダッシュボード・ログ自体にも料金がかかる場合があります。
- S3のバックアップに30日などのライフサイクルを設定し、AWS Budgetsで自分の上限額を通知するようにします。Budgetsは料金を自動で止める機能ではありません。

設定場所：CloudFormation出力の `ScheduleGroup` → **Amazon EventBridge → スケジューラ → スケジュールグループ**。2件のターゲットが出力の `ServerInstanceId` と一致し、タイムゾーンがAsia/Tokyoになっていることを確認します。動作失敗はSchedulerのモニタリングで呼び出し・ターゲットエラーを確認します。EC2の開始失敗時は、同じ1台を手動で開始できます。

夜間に作業する日は、CloudFormation更新で `EnableNightSchedule=false` にしてから必要に応じてEC2を手動起動します。翌日の起動も無効になるので、作業後は `true` に戻してください。ゲーム内のプレイ制限はAWSスケジュールとは別の設定です。

## 8-C. AWSコンソールで利用ログを見る

1. CloudFormation → 自分のスタック → 出力 → **`DashboardURL`** を開きます。CloudWatchで `スタック名-operations` を探しても同じです。
2. 「Online players / active matches」で接続人数と試合数、「Finished / interrupted matches」でCPU・オンライン別の終了数と中断理由を確認します。CPU・通信量・CPUクレジットはEC2標準メトリクスです。
3. 「Recent usage and memory」で直近の人数・待機数・Node.jsプロセスのRSSメモリ（MB）を確認します。これはOS全体のメモリ使用率ではありません。ゲームの値は起動中に1分ごと、EC2の値は通常5分間隔で届きます。
4. 個別のログは **CloudWatch → ロググループ → 出力の `ApplicationLogs`** を開きます。`インスタンスID/application` はゲーム、`インスタンスID/nginx-error` はnginxのエラーです。ゲームは試合ID・モード・終了理由・得点を記録し、名前・Cookie・セッション・IPはアプリイベントに記録しません。nginxエラーにはリクエスト情報が含まれる場合があります。
5. 日付範囲を絞り、必要ならタイムゾーンをローカル時刻にします。アプリ内の `timestamp` はUTCです。Logs Insightsでは次を使えます。

```text
fields @timestamp, event, mode, reason, durationSeconds, score
| filter event = "match_finished"
| sort @timestamp desc
| limit 50
```

起動直後や無人の時間は試合一覧が空で正常です。夜間停止中は新しいログが届きません。8時以降も利用ログが出なければEC2の稼働状態と、`MonitoringCommandDocument` の実行結果を確認します。対戦の全履歴はSQLiteに残り、CloudWatchは設定した日数分だけを保存します。

ダッシュボードの試合数は選択期間内の終了イベント数で、切断・途中終了・中断も含めて理由別に表示します。ゲーム内の勝率集計とは定義が異なります。

## 9. 調子が悪いとき

### スタック作成が失敗した

- CloudFormationの **イベント** で、最初に `CREATE_FAILED` になった項目と理由を確認します。
- S3のバケット名・キー・リージョンが正しいか、`pong-app.zip` をアップロードしたか確認します。
- S3をSSE-KMSで暗号化した場合、既定構成では読めないことがあります。初回はSSE-S3を使ってください。
- EC2・Elastic IP・CloudFront・IAM等の作成権限や、アカウントの上限を確認します。
- `ServerReady` が時間切れなら、EC2のログで初期設定の失敗を調べます。
- 失敗したスタックを削除してやり直すと、新しいデータディスクが作られます。失敗時でも保護のためディスクが残る場合があるので、後述の終了手順で確認します。

### サーバーログを見る

1. **EC2 → インスタンス** でスタック出力と一致するサーバーを選びます。
2. **接続 → セッションマネージャー → 接続** を選びます。SSHの鍵は不要です。
3. 表示されたサーバー上の画面で、必要なものを貼り付けて実行します。以下は確認用です。

```bash
sudo systemctl status pong nginx
sudo tail -n 100 /var/log/pong/application.log
sudo systemctl status amazon-cloudwatch-agent
sudo tail -n 100 /var/log/cloud-init-output.log
sudo journalctl -u pong-backup -n 50 --no-pager
sudo systemctl list-timers pong-backup.timer
```

ログに書かれた内容は状況確認に使い、公開の場所へ載せる際はURLやアカウント情報などを確認してください。Session Managerに接続できない場合は、インスタンスが起動中か、SSMの管理ノードとして認識されているかを確認します。

### ゲームを再起動する

ゲーム内で全体停止した後、Session Managerで次を実行します。進行中の試合は中断します。

```bash
sudo systemctl restart pong
```

OSの再起動も固定IPを維持します。EC2の「停止→開始」を使った場合もElastic IPは維持しますが、その間はゲームを利用できず、CPU戦も停止します。停止中でもディスクや固定IPの料金は発生し得ます。

### 接続できない／同じ名前が使用中になる

- `https://...cloudfront.net` のGameURLを使っているか確認します。
- 同じ名前を開いている別タブや端末を閉じます。通常ウィンドウと別タブはCookieを共有します。
- 強制切断した接続は検知まで最大およそ30秒かかる場合があります。少し待って上部の再接続ボタンを押します。
- インターネットが切れた場合の試合は負けになります。元の試合へ途中復帰する機能はありません。
- 画面には接続人数の上限を設けています。200接続が実際に快適に動くことを保証する値ではありません。負荷に応じてサーバーサイズを見直してください。

## 10. バックアップからの復旧

復旧は通常の設置では不要です。間違って上書きしないよう、先に現在のバックアップを確保します。

1. ゲーム内で全体停止し、最新のバックアップがS3にあることを確認します。
2. 復元したいS3オブジェクトの **S3 URI** をコピーします。
3. Session Managerで接続して、以下の `s3://...` を実際のURIへ置き換えます。
4. データ本体はサーバー側に置きます。自分のPCへのSQLツールのインストールは不要です。

```bash
sudo systemctl stop pong-backup.timer
sudo systemctl start pong-backup.service
sudo systemctl stop pong
sudo mkdir -p /var/lib/pong/before-restore
sudo cp -a /var/lib/pong/pong.sqlite* /var/lib/pong/before-restore/
sudo aws s3 cp 's3://実際のバケット/backups/スタック名/実際のバックアップ.sqlite.gz' /tmp/pong-restore.sqlite.gz
sudo gzip -dc /tmp/pong-restore.sqlite.gz | sudo tee /tmp/pong-restore.sqlite > /dev/null
sudo python3 -c "import sqlite3; c=sqlite3.connect('/tmp/pong-restore.sqlite'); assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'; c.close()"
sudo rm -f /var/lib/pong/pong.sqlite-wal /var/lib/pong/pong.sqlite-shm
sudo install -o pong -g pong -m 640 /tmp/pong-restore.sqlite /var/lib/pong/pong.sqlite
sudo systemctl start pong
sudo systemctl start pong-backup.timer
```

復旧ではバックアップ時点の名前・戦績・停止設定に戻ります。停止設定も戻るため、GameURLで `chun` として確認してから再開してください。`before-restore` に残したコピーは復旧確認後に整理できます。

サーバーのIAM権限は、指定したアプリZIPと自分のスタックのバックアップの読み取り、およびそのバックアップ先への書き込みに限定しています。別スタックのバックアップを読む場合は、そのバックアップを新しいスタックの保存先へS3コンソールでコピーしてから復元します。

EC2自体を作り直す場合は、まず新しいスタックを作成し、その新しいサーバーでバックアップを復元する方法がわかりやすいです。元の暗号化データディスクも、スタック削除時に保持する設定です。

## 11. 運用を終了して課金対象を整理する

**ゲーム内の停止はAWSの停止ではありません。** メンテナンスのままでもサーバー費用は発生します。

1. 必要なバックアップをS3コンソールからPCにダウンロードします。
2. EC2コンソールで対象インスタンスを「停止」し、停止済みになるまで待ちます（ここでは「終了」は選びません）。その後、CloudFormationで対象のスタックを削除します。CloudFrontの削除には時間がかかる場合があります。
3. **データ保護のためEBSデータディスクは残ります。** 出力の `PersistentDataVolume` または `スタック名-PERSISTENT-DATA` タグで特定します。
4. データが不要になったと判断したら、EC2コンソールの **ボリューム** で、対象ディスクだけを削除します。失敗した作成の残りも確認します。
5. 手動作成したS3バケットも残ります。不要なZIP・バックアップ・古いバージョンを整理し、不要ならバケットも削除します。
6. EC2、Elastic IP、CloudFront、EBS、S3、Secrets Managerの残存リソースを確認し、請求画面で利用状況を確認します。

S3バージョニングやSecrets Managerの削除待機期間などにより、削除操作後すぐに全データがなくなるとは限りません。他の用途のリソースは削除しないでください。

## 12. 構成と確認状況

![DICT_PONG AWSアーキテクチャ図](architecture.svg)

図の単体ファイルは配布キットの `ARCHITECTURE.svg` です。拡大しても文字が鮮明なSVG形式で、PCのブラウザで開けます。

ブラウザからCloudFrontへはHTTPS/WSS、CloudFrontからEC2へはHTTPで転送します。EC2のアプリは自動生成のオリジンヘッダーを確認します。このヘッダーはAWSが内部で設定するもので、プレイヤーや `chun` が入力するものではありません。

1台のEC2で全ゲームを管理する小規模向け構成です。複数台への分散・無停止更新・自動スケーリングはありません。CPU戦もサーバーで処理するので、AWS側が停止中は遊べません。

配布前に19件のテストで、ダッシュ・スタミナ・8方向移動・ゴール拡大、2人のWebSocket対戦での5点先取、左右反転操作、CPU3段階、戦績の保存と再起動、相手別集計、全体停止、停止予約、名前のみの管理判定、画面のDOM動作を確認しています。YAMLは `cfn-lint` で静的検証しています。**実AWSへの反映と、CloudWatch・時刻指定停止の実動作は未検証です。ブラウザ操作の許可がタイムアウトしたため、今回の画面の目視確認も未実施です。**

## AWS公式資料

- CloudFormationのコンソール操作：[スタックの作成](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stack.html)
- CloudFrontの通信要件：[WebSocket対応](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html)
- サーバー接続：[Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
- 見積もり：[AWS Pricing Calculator](https://calculator.aws/)
- 利用料金の把握：[AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
- 時刻・タイムゾーン：[SchedulerのCloudFormation設定](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-scheduler-schedule.html)
- EC2の開始・停止を直接呼び出す：[Schedulerのユニバーサルターゲット](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-universal.html)
- 停止中の課金：[EC2の状態別課金](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-lifecycle.html)
- 固定IPv4の料金：[VPCの料金](https://aws.amazon.com/vpc/pricing/)
- ログ収集：[CloudWatch Agent設定](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Agent-Configuration-File-Details.html)
- ログ検索の費用：[CloudWatchの料金](https://aws.amazon.com/cloudwatch/pricing/)
