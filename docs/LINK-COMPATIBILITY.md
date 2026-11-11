# CRYSTAL QUEST：Gemini起動リンクの対応範囲

確認日：2026年11月12日

## 公式イベントの実装で確認できたこと

[Google公式の記事](https://note.com/google_gemini/n/n96348d37694c)は、呪文を選ぶとイベント用のプロンプトがGeminiへ渡り、自動で実行される体験を説明しています。終了した[公式体験ページのアーカイブ](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)では、次のパラメーターを持つGoogleの起動リンクを確認しました。

```text
https://gemini.google.com/app/download/mobile
  ?mode=fast
  &target=image
  &prompt_id=FhNSphiBckxl
  &prompt_action=autosubmit
  &redirect=home
```

これは調査対象のマダンテ用リンクの記録であり、FF版に設定する値ではありません。リンクの `prompt_id` はGoogle側に登録されたDQ用プロンプトを指定します。Webサイト上の本文をFF用に書き換えても、そのIDの登録内容は変わりません。

任意のプロンプトを登録してIDを発行する一般公開API・手順は、確認した公開資料からは見つかっていません。`?q=` で任意の長文を渡し、自動実行できるとは扱いません。

## FF版の現在の動作

| 導線 | 現在の状態 |
| --- | --- |
| 魔法選択とFF用プロンプト生成 | 6種類に対応。初期選択はアルテマです。 |
| Geminiへの初回入力 | 全文コピー → Geminiを開く → 利用者が貼り付けて送信するモードです。 |
| 初回案内 | 写真を受け取るまでは指定された案内文だけを返すようプロンプトで指示します。 |
| 写真受信後 | 選択魔法を使う完成画像1枚だけを生成するよう指示します。写真はGeminiに直接送ります。 |
| FFプロンプトの自動入力・実行 | 未接続です。実際に登録・検証されたFF用IDが必要です。 |

`dist/launch-config.js` の `REGISTERED_PROMPTS` は、魔法ごとの登録済みFFプロンプトの、端末別に検証した完全URLを設定するためのものです。初期値はすべて `null` とし、DQ用IDや架空のIDは設定しません。iOS・Android・Webを個別に検証し、元のURLを変更せず使用します。ローカルの設定だけでGoogle側へ登録できるわけではありません。

現地用 `/event/` ページのアーカイブから抽出したボタンの実URLは [EVENT-LINK-EVIDENCE.json](EVENT-LINK-EVIDENCE.json) に記録しています。オンライン用画像テンプレートのリンクとは区別しています。

プロンプトに書いた案内文、画像枚数、外見の保持は生成モデルへの指示です。WebサイトがGeminiの返答を検査・強制する仕組みではないため、完全一致や生成成功は保証できません。

## App Links / Universal Links

| 環境 | 通常の起動リンク | 確認できた範囲 |
| --- | --- | --- |
| iOS | `https://gemini.google.com/app/download/ios` | GoogleのAASAに対象パスがあります。実際の起動はアプリの導入状態、ブラウザ、端末設定に依存します。 |
| Android | `https://gemini.google.com/app/download/mobile` | Googleのドメイン関連付けにGeminiパッケージがあります。アプリ側Manifestの対象パスは未確認です。 |
| Web | `https://gemini.google.com/app` | Gemini Webへの通常リンクです。 |

このサイトは、利用者の操作からGoogle所有のHTTPSリンクを直接開きます。独自サイト側だけでGeminiアプリとの関連付けを新設することはできません。独自の `gemini://` スキームや偽のAASA・`assetlinks.json` は使用しません。

## 実機での確認が必要な項目

- [ ] Android + Chrome：インストール済み・未インストールでの通常リンクの遷移。
- [ ] iPhone + Safari：Universal Linkの起動、未インストール時の遷移。
- [ ] 初回にFF用プロンプトを全文送信し、写真受信前に指定の案内だけが返ること。
- [ ] 人物とモンスター立像の写真を送信し、選択した魔法の画像が1枚生成されること。
- [ ] コピー拒否時の手動操作と、日本語・改行・絵文字を含む本文の一致。
- [ ] FF用IDを登録できた場合：魔法ごとに、起動・初回送信・案内・撮影後の生成まで確認すること。

## 一次資料

- [Google公式：ジェミニクエスト体験記事](https://note.com/google_gemini/n/n96348d37694c)
- [公式体験ページのアーカイブ](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)
- [Android App Linksの概要](https://developer.android.com/training/app-links/about)
- [Apple：アプリとWebサイトのコンテンツをリンクする](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)
- [GoogleのAndroid関連付け](https://gemini.google.com/.well-known/assetlinks.json)
- [GoogleのiOS関連付け（AASA）](https://gemini.google.com/.well-known/apple-app-site-association)

アーカイブは当時の仕組みを示す資料です。既存DQリンクが現在も使えることや、FF版への流用を保証するものではありません。
