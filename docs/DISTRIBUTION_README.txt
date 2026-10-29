DICT_PONG 配布ファイル

配布するファイルは、このフォルダーの「PONG-AWS-kit.zip」です。
ZIPを右クリック →「すべて展開」して使ってください。

■ PCで遊ぶ
展開した中の pong-app.zip も展開し、start-local.cmd を開きます。
初回はNode.jsのダウンロードにインターネット接続が必要です。

■ AWSに公開する
同じフォルダーの AWS_SETUP.html をブラウザーで開いてください。
キットを展開した中の pong-app.zip をZIPのままS3へ送ります。
pong-stack.yaml はCloudFormationに送ります。

■ release フォルダーについて
release は配布するZIP・YAML・設置手順書をまとめたフォルダーです。
再パッケージすると、このフォルダーのZIPと手順書も最新に更新されます。

■ 検証の記録
プロジェクト内の docs/TEST_REPORT.md に検証範囲と結果を記載しています。
