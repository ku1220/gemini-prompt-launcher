# CRYSTAL QUEST：Gemini起動リンクの対応範囲

確認日：2026年11月12日

## 今回のFF版の実装

選択した魔法のプロンプト全文を `encodeURIComponent` でエンコードし、次のURLへ直接遷移する方式です。

```js
const targetUrl = `https://gemini.google.com/app?q=${encodeURIComponent(fullPrompt)}`;
```

`prompt_id` の登録やGemini APIは使用しません。送信は利用者がGeminiで行い、サイトから自動送信や送信ボタンの操作は行いません。

| 導線 | 現在の状態 |
| --- | --- |
| 魔法選択とFF用プロンプト生成 | 6種類に対応。初期選択はアルテマです。 |
| `q` への本文設定 | 選択した魔法の全文をURLエンコードして設定します。 |
| アプリ起動・入力欄への反映 | 受け取り側の端末、ブラウザ、アプリのバージョン、ログイン状態に依存します。スマートフォン実機では未検証です。 |
| 初回送信 | Geminiの入力欄を確認して、利用者が送信します。 |
| 初回案内 | 写真を受け取るまでは指定された案内文だけを返すようプロンプトで指示します。 |
| 写真受信後 | 選択魔法を使う完成画像1枚だけを生成するよう指示します。写真はGeminiに直接送ります。 |
| 本文が入力されない場合 | 本文を選択し、端末の「コピー」を使ってGeminiに貼り付けて送信します。 |

URLの生成・遷移を実装したことと、Gemini側での受け取りを確認したことは区別しています。確認した公開資料だけを根拠に、すべてのWeb版・モバイルアプリで `q` が受理される公式保証があるとは扱いません。

2026年11月12日のブラウザ確認では、未ログインのGemini Web版で `https://gemini.google.com/app?q=Hello%20Gemini%20link%20test` を開いても、入力欄は空のままでした。この環境では事前入力を再現できていません。ログイン済みの環境とモバイル実機は未検証です。

プロンプトに書いた案内文、画像枚数、外見の保持は生成モデルへの指示です。WebサイトがGeminiの返答を検査・強制する仕組みではないため、完全一致や生成成功は保証できません。

## 長文とプライバシー

生成したURLがUTF-8で8,000バイトを超える場合、URLによる受け渡しを止め、コピーによる受け渡しへ案内します。本文を切り詰めることはありません。これはサイト独自の保守的なガードで、GoogleやOSの公称上限ではありません。

URLには本文が含まれ、Googleへ送信されます。共有先、ブラウザ履歴、ログから本文を読める場合があります。機密情報を含めないでください。撮影した写真をこのサイトへアップロードする処理はありません。

## 調査記録：公式イベントの別方式

[Google公式の記事](https://note.com/google_gemini/n/n96348d37694c)は、呪文を選ぶとイベント用のプロンプトがGeminiへ渡り、自動で実行される体験を説明しています。終了した[公式体験ページのアーカイブ](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)では、次のパラメーターを持つGoogleの起動リンクを確認しました。

```text
https://gemini.google.com/app/download/mobile
  ?mode=fast
  &target=image
  &prompt_id=FhNSphiBckxl
  &prompt_action=autosubmit
  &redirect=home
```

これは調査対象のマダンテ用リンクの記録です。今回のFF版の `q` 方式とは別の実装例で、FF版の設定には使用しません。既存DQ用IDの登録内容を、サイト側の文章変更でFF用へ書き換えることもありません。

現地用 `/event/` ページのアーカイブから抽出したボタンの実URLは [EVENT-LINK-EVIDENCE.json](EVENT-LINK-EVIDENCE.json) に記録しています。オンライン用画像テンプレートのリンクとは区別しています。

## App Links / Universal Links

主導線はすべての環境で `https://gemini.google.com/app?q=...` です。以下は、本文が入力されない場合などに使う通常の起動リンクです。

| 環境 | 通常の起動リンク | 確認できた範囲 |
| --- | --- | --- |
| iOS | `https://gemini.google.com/app/download/ios` | GoogleのAASAに対象パスがあります。実際の起動はアプリの導入状態、ブラウザ、端末設定に依存します。 |
| Android | `https://gemini.google.com/app/download/mobile` | Googleのドメイン関連付けにGeminiパッケージがあります。アプリ側Manifestの対象パスは未確認です。 |
| Web | `https://gemini.google.com/app` | Gemini Webへの通常リンクです。 |

このサイトは、利用者の操作からGoogle所有のHTTPSリンクを直接開きます。独自サイト側だけでGeminiアプリとの関連付けを新設することはできません。独自の `gemini://` スキームや偽のAASA・`assetlinks.json` は使用しません。

## 実機での確認が必要な項目

- [ ] Android + Chrome：`q` リンクでのアプリ起動またはWeb遷移と、入力欄の本文一致。
- [ ] iPhone + Safari：`q` リンクの遷移先と、入力欄の本文一致。アプリ未インストール時も確認。
- [ ] 初回にFF用プロンプトを全文送信し、写真受信前に指定の案内だけが返ること。
- [ ] 人物とモンスター立像の写真を送信し、選択した魔法の画像が1枚生成されること。
- [ ] 端末の「コピー」による操作と、日本語・改行・絵文字を含む本文の一致。
- [ ] 8,000バイト超過時に全文を切り詰めず、コピー導線へ案内されること。

## 一次資料

- [Google公式：ジェミニクエスト体験記事](https://note.com/google_gemini/n/n96348d37694c)
- [公式体験ページのアーカイブ](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)
- [Android App Linksの概要](https://developer.android.com/training/app-links/about)
- [Apple：アプリとWebサイトのコンテンツをリンクする](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)
- [GoogleのAndroid関連付け](https://gemini.google.com/.well-known/assetlinks.json)
- [GoogleのiOS関連付け（AASA）](https://gemini.google.com/.well-known/apple-app-site-association)

アーカイブは当時の仕組みを示す資料です。既存DQリンクが現在も使えることや、FF版への流用を保証するものではありません。
