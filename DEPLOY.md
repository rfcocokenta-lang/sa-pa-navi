# SA・PAナビ v0.19 デプロイ

GitHub Pages のリポジトリに次の3ファイルを配置してください。

- index.html
- app-v19.js
- style-v19.css

`index.html` は app-v19.js / style-v19.css を読み込むようになっています。
古い app.js / style.css / app-v18.js / style-v18.css は残しても動作には影響しません。

## v0.19の主な修正
- 一般道候補は OSRM alternatives の中から高速道路比率が低い候補を優先。
- 高速IC取得が一時失敗しても OSRM alternatives から高速候補を復旧。
- SA/PA検索を5km間隔の小さいOverpass検索に変更。
- Overpass障害時は東京湾～館山方面の主要SA/PAをフォールバック。
- 高速区間の地図色表示は継続。
