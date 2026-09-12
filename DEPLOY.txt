# v0.17 更新手順

今回のv0.17は、古いapp.jsがブラウザキャッシュで残る問題を避けるため、`app-v17.js` と `style-v17.css` を新しいファイル名で読み込みます。

GitHub Pagesの公開フォルダに以下4ファイルを同じ階層で置き換えてください。
- index.html
- app-v17.js
- style-v17.css
- README.md（任意）

`index.html` は app-v17.js / style-v17.css を参照しています。

検索結果のルートカードには、道路step情報から判定した「一般道→高速→一般道」の区間と、高速道路開始・終了位置が表示されます。
