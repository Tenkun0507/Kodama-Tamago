# こだま vs たまご

GitHubで管理しやすいように、製品版v42を複数ファイルへ分割した版です。

## フォルダ構成

```text
kodama-tamago-github/
├─ index.html
├─ css/
│  └─ style.css
├─ js/
│  ├─ audio.js
│  └─ app.js
└─ assets/
   └─ bgm.wav
```

## どこを編集する？

### 見た目を変える
`css/style.css`

色、ボタン、盤面、ルール画面などのデザインはここです。

### BGM / SEを変える
`js/audio.js`

ファイル上部の `AUDIO_SETTINGS` を編集します。

```js
const AUDIO_SETTINGS={
  masterVolume:1.00,
  bgmVolume:0.62,
  seVolume:1.55,
```

- `masterVolume`：全体
- `bgmVolume`：BGM
- `seVolume`：SE

BGM音源そのものは `assets/bgm.wav` です。

### ゲームルール・AIを変える
`js/app.js`

この中にゲーム処理とAI処理があります。

検索すると見つけやすい見出し：
- `AI設定`
- `ゲーム状態`
- `勝利判定`
- `合法手`
- `AI評価 + 新AI戦略`
- `オンライン強化学習`

## PCで動作確認する

一番簡単なのは `index.html` をダブルクリックです。

音声などでブラウザ制限が出る場合は、VS CodeのLive Serverなどでローカルサーバーを使うと安定します。

## GitHubへ上げる流れ

1. GitHubで新しいRepositoryを作る
2. このフォルダ内のファイルとフォルダをそのままアップロードする
3. Commitする
4. GitHub Pagesを使う場合は `Settings → Pages`
5. `Deploy from a branch`
6. Branchを `main`、Folderを `/(root)` にして保存

`index.html` がルートにあるので、そのままWebページとして公開できます。

## 大事

フォルダ構成を変えるときは、HTMLやJavaScript内のパスも一緒に変える必要があります。

例：

```js
const BGM_FILE="assets/bgm.wav";
```

`bgm.wav`を別のフォルダへ移動した場合は、この部分も変更します。
