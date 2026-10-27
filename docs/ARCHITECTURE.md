# 実装と検証

## サーバー

Node.js 24 LTSと `ws` でHTTP/WebSocketを同じポートに提供します。画面・API・WebSocketは同じオリジンです。サーバーで60Hzの固定ステップ計算を行い、最大30Hzで状態を送ります。クライアントからは操作のみ受け付け、ボール位置・得点・勝敗の申告は受け付けません。

クライアントは受信した状態を補間してCanvasへ描画します。未来の位置の予測やロールバック同期はありません。遅延が大きい接続では、操作の反映が遅く感じられます。

コートは1200×640。バーは18×108、球の半径は12。左右のゴールは中央の高さ232〜408の176ピクセル幅です。ゴール以外の側面は反射し、開口部の上下端は球の半径を考慮して反射します。球全体がゴールを抜けた時点で得点します。寸法は `public/field.js` をサーバーの物理演算と画面描画で共有します。

自陣内を四方向に移動し、円と長方形の接触点・法線で反射します。高速時のすり抜けを避けるため、球を最大1/240秒のサブステップで計算します。右側参加者は状態と操作を左右反転します。上下は反転しません。

マッチングキュー、プライベートルーム、接続一覧、進行中の試合はメモリ上です。複数Nodeプロセス・複数EC2へそのまま分散させる構成には対応しません。

## 保存

Node組み込みの `node:sqlite` を使います。Node 24系列の当該APIはリリース候補段階のため、配布時に検証した24.22.1に固定します。外部SQLiteドライバーのコンパイルは不要です。

テーブルは `players`、`sessions`、`matches`、`results`、`settings`。WALモードと外部キーを使用し、終了結果を1トランザクションで両者分保存します。管理設定もSQLiteに保存します。名前はNFC正規化と前後の空白除去を行い、大文字・小文字は区別します。

パスワードによる本人認証は行いません。初回参加時にランダムなセッションを生成し、HttpOnly・SameSite=StrictのCookieへ保存します。AWS上ではSecureも付けます。同じ名前で新しく参加すれば既存のプロフィールを利用できます。管理操作はセッションのプレイヤー名が `chun` かをサーバー側で確認します。

## AWS

CloudFormationは専用VPC・公開サブネット・EC2 1台・固定IPv4・暗号化データEBS・CloudFrontを作成します。HTTPS/WSSはCloudFrontで終端し、EC2へはHTTPで転送します。EC2の80番は公開ですが、ヘルスチェック以外のアプリ要求は自動生成のオリジンヘッダーで拒否します。SSHは開けず、SSMで管理します。

CloudFrontはCachingDisabledとAllViewerの管理ポリシーを使用し、CookieとWebSocketのハンドシェイク情報を転送します。自動生成のオリジン用Secrets Managerシークレットはゲームの管理者判定とは無関係です。手動設定や入力は不要です。

初期設定ではNode公式バイナリのSHA-256を照合します。CloudFormationのWaitConditionは初期設定・マウント・起動・初回バックアップが成功した場合にだけ成功通知を受けます。AWS料金・残存EBS・バックアップの保管期限は設置手順書に記載しています。

## 自動テスト

- 物理：左右反転、四面と角での反射、接触中の再反射防止、移動範囲と斜め速度、上下壁、ゴール以外の左右壁、両ゴールの得点、ゴール端と球の半径、5点、すり抜け、CPU差分。
- 保存：名前の区別、セッション、再参加、勝率・得点・時間・相手別・モード別集計、中断の除外、設定と結果の永続化、トランザクションのロールバック。
- 通信：実HTTP/WebSocketで2人が接続し、ルーム対戦から5点決着まで操作。両者の左側操作、CPU3段階、ランダムマッチング、途中終了、管理停止、日時予約、毎日の時間制限、名前のみの管理権限、再起動、ログアウト。
- 画面：jsdomでJavaScriptを実行し、登録、CPU選択、対戦・結果・戦績表示、管理画面、設定保存、停止表示を確認。Canvas描画と実際のレイアウトはこのテストでは検証しません。
- 配布：ZIPの必須ファイル、パス、秘密・実行データの混入がないこと、展開したZIPからの起動と通信を確認。
- AWS：CloudFormationを `cfn-lint` で静的検証し、Bashスクリプトを構文検証。

実AWSへのデプロイ、負荷試験、実機ブラウザでの表示・全画面・音・タッチの動作確認は未実施です。ブラウザ自動操作ツールが現在のURLを確定できず終了したため、表示の目視検証は行えていません。

## 運用範囲

200 WebSocket接続をアプリの上限としていますが、性能を保証する同時接続数ではありません。実測に基づく調整が必要です。プレイヤー一覧は新しい登録から最大1,000人、各人の履歴は直近30試合を表示し、全履歴はDBに保存します。記録の削除UIやランキング、観戦、切断後の途中復帰、他端末の強制ログアウトは実装範囲に含めていません。

API・WebSocketの頻度制限、JSONサイズ制限、同一オリジンの操作確認、HTMLエスケープ、CSPを設定しています。名前だけの管理者という仕様を、本人確認付きのアカウント制とはみなさないでください。

## 参照した公式資料

- [Node.js 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [CloudFrontのWebSocket](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html)
- [CloudFrontの管理オリジンリクエストポリシー](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html)
- [CloudFormationのWaitCondition](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-waitcondition.html)
