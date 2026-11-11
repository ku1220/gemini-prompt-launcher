# CRYSTAL QUEST：Gemini起動リンクの対応範囲

確認日：2026年11月12日

## 現在の状態

**FFプロンプトの自動入力・自動実行は実現していません。** 動作しなかった `q` リンクは通常の開始導線から外しています。手動で準備するボタンから本文を選択し、端末の「コピー」を使ってGeminiへ貼り付け・送信する手順を提供します。

| 項目 | 確認できた状態 |
| --- | --- |
| 魔法選択・FF用プロンプト生成 | 6種類に対応。初期選択はアルテマです。 |
| 初回入力・送信 | 利用者が本文を手動でコピーし、Geminiへ貼り付けて送信します。 |
| 初回案内 | 写真を受け取るまでは指定の案内文だけを返すよう、プロンプトで指示します。 |
| 写真受信後 | 選択魔法を使う完成画像1枚を生成するよう指示します。写真はGeminiに直接送ります。 |
| 自動入力・自動実行 | 未達成です。手動手順への変更を、自動体験の修正完了とは扱いません。 |

Gemini API、APIキーは追加していません。モデルに対する案内文・画像枚数・外見保持の指示は、実際の返答や生成結果をサイト側から強制する仕組みではありません。

## `q` 方式で確認した失敗

試したURLは次の形式でした。

```js
const targetUrl = `https://gemini.google.com/app?q=${encodeURIComponent(fullPrompt)}`;
```

- 利用者から、Androidアプリ・iOSアプリ・Web版の全環境で本文が自動入力されないとの報告がありました。
- ブラウザで別途確認した未ログインのWeb版でも、短い `https://gemini.google.com/app?q=Hello%20Gemini%20link%20test` を開いた後、入力欄は空でした。
- サイト側では、URLを復号した本文と生成プロンプトが一致することを確認しています。日本語・改行・記号を切り詰める処理はありません。短文でも失敗したため、長文サイズだけを原因とは扱えません。

コード内の `prefilledQuestLink()` は診断用に残っていますが、通常のUIからは呼び出しません。関連テストはエンコードと全文保持のテストです。Gemini側が入力を受理することのテストではありません。

診断用ヘルパーの8,000バイト上限はサイト独自のガードです。GoogleやOSが公表した上限ではなく、現在の手動コピー用本文を切り詰める制限でもありません。

## 自動体験に必要な受け取り口

Geminiが実際に受理する任意テキストの入力インターフェース、または正しいFF指示を登録した実行URLが必要です。現在、利用できる動作確認済みの受け取り口を確保できていません。

これは、あらゆる方法が不可能という断定ではありません。確認できていない入力仕様を仮定して、サイト側のURL生成変更だけで自動入力が完成したとは扱わない、という状態です。

## 調査記録：現地イベントの登録済みID

[Google公式の記事](https://note.com/google_gemini/n/n96348d37694c)は、呪文を選ぶとイベント用プロンプトがGeminiへ渡り、自動実行される体験を説明しています。[現地体験ページの保存版](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)では、マダンテ用ボタンに次のパラメーターを確認しました。

```text
https://gemini.google.com/app/download/mobile
  ?mode=fast
  &target=image
  &prompt_id=FhNSphiBckxl
  &prompt_action=autosubmit
  &redirect=home
```

これは当時のDQ用リンクの記録です。FF用の設定には使用していません。サイト上の本文を書き換えても、Google側の登録済みIDの内容は変わりません。任意のFF用IDを発行する一般公開の登録手順は確認できていません。

現地用 `/event/` ページから抽出した実URLは [EVENT-LINK-EVIDENCE.json](EVENT-LINK-EVIDENCE.json) に保存しています。オンラインの画像テンプレート用リンクとは区別しています。保存版は当時の資料であり、既存リンクが現在も使えることを示しません。

## 通常のアプリ起動

| 環境 | 手動手順で使うリンク | 確認できた範囲 |
| --- | --- | --- |
| iOS | `https://gemini.google.com/app/download/ios` | GoogleのAASAに対象パスがあります。実際の起動は導入状態、ブラウザ、端末設定に依存します。 |
| Android | `https://gemini.google.com/app/download/mobile` | Googleのドメイン関連付けにGeminiパッケージがあります。アプリ側Manifestの対象パスは未確認です。 |
| Web | `https://gemini.google.com/app` | Gemini Webへの通常リンクです。 |

App Links / Universal Linksによるアプリ起動と、アプリが任意プロンプトを入力・実行する処理は別の確認項目です。上記リンクの存在を、自動入力対応の根拠にはしません。

## 一次資料

- [Google公式：ジェミニクエスト体験記事](https://note.com/google_gemini/n/n96348d37694c)
- [現地体験ページの保存版](https://web.archive.org/web/20260802112709id_/https://www.dragonquest.jp/geminiquest/event/)
- [Android App Linksの概要](https://developer.android.com/training/app-links/about)
- [Apple：アプリとWebサイトのコンテンツをリンクする](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)
- [GoogleのAndroid関連付け](https://gemini.google.com/.well-known/assetlinks.json)
- [GoogleのiOS関連付け（AASA）](https://gemini.google.com/.well-known/apple-app-site-association)
