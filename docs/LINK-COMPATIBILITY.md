# Geminiへのリンクと対応範囲

確認日：2026年11月12日

## 実装の境界

App Links / Universal Linksは、Webサイトとアプリの双方が関連付けに対応する仕組みです。第三者が独自サイトに関連付けファイルを置くだけでは、GoogleのGeminiアプリへ新しいリンク経路を追加できません。

このサイトはユーザー操作でGoogle所有のHTTPSリンクへ移動します。独自の `gemini://` スキームや、独自ドメイン用の偽の `assetlinks.json` / AASAファイルは使用しません。

## 対応表

| 導線 | 使用するURL | 確認できた範囲 |
| --- | --- | --- |
| iOSで開く | `https://gemini.google.com/app/download/ios` | GoogleのAASAに対象パスが存在します。実際の起動は端末・ブラウザ・設定次第です。プロンプトはコピーして貼り付けます。 |
| Androidで開く | `https://gemini.google.com/app/download/mobile` | Googleの関連付けにGeminiパッケージが存在します。アプリ側Manifestの対象パスは未確認で、起動は保証しません。 |
| Webで開く | `https://gemini.google.com/app` | Gemini Webへの通常リンクです。 |
| URLによる入力・実験 | `https://gemini.google.com/app?q=...` | 任意テキストの公式対応は未確認です。入力、アプリ起動、長文の受け渡しを保証しません。 |
| このサイトへの事前入力 | `?prompt=...` または `#prompt=...` | このサイト自身が解析する仕様です。Gemini側の仕様ではありません。 |

Googleの公式プロンプト集には `prompt_action=prefill&prompt_id=...` のリンクがあります。これはGoogleに登録されたプロンプトIDを指定する形式で、任意の長文を直接渡せる証拠ではありません。

一般的な `/app?q=...` は、確認時点のiOS AASAでUniversal Linkとして一致するパス・クエリ条件ではありません。そのため実験リンクを「iOSアプリへの自動入力」として案内しません。

## 長文の扱い

URL形式では本文をパーセントエンコードするため、日本語や記号が多い文章ほどURLが大きくなります。ブラウザ・OS・リンク処理側の上限は一律ではありません。

- 生成URLがUTF-8で8,000バイトを超える場合、URL入力の実験を無効にします。これはサイト独自のガードです。
- 長文は全文コピーを利用します。URL用に本文を切り詰めて送ることはしません。
- コピーがブラウザに拒否された場合は、編集欄から手動コピーします。
- アプリへの遷移成功や入力成功は、Webサイトから確実には検知できません。
- Geminiへの自動送信は行いません。最後の確認と送信は利用者が行います。

## 実機確認チェックリスト

以下は実機確認が必要な項目です。リポジトリ内の自動テストの成功は、これらの確認完了を意味しません。

- [ ] Android + Chrome + Geminiインストール済み：通常リンクでの遷移と全文貼り付け。
- [ ] Android + Gemini未インストール：ブラウザまたは案内先への遷移。
- [ ] iPhone + Safari + Geminiインストール済み：Universal Linkの起動と全文貼り付け。
- [ ] iPhone + Gemini未インストール：案内先への遷移。
- [ ] iOS / Androidのアプリ内ブラウザ：コピー拒否時の案内と手動操作。
- [ ] 日本語、絵文字、改行、`&`・`#`・`?` を含む文章の内容一致。
- [ ] 8,000バイト境界と長文での実験リンクの無効化、全文コピーの維持。
- [ ] 各端末のGeminiで実験用 `q` の受け取り可否。非対応時にも通常導線を利用できること。

## 一次資料

- [Android App Linksの概要](https://developer.android.com/training/app-links/about)
- [Apple：アプリとWebサイトのコンテンツをリンクする](https://developer.apple.com/documentation/xcode/allowing-apps-and-websites-to-link-to-your-content)
- [GoogleのAndroid関連付け](https://gemini.google.com/.well-known/assetlinks.json)
- [GoogleのiOS関連付け（AASA）](https://gemini.google.com/.well-known/apple-app-site-association)
- [Google公式Geminiプロンプト集](https://gemini.google/explore/)

Google側の関連付けやアプリの挙動は変更される可能性があります。挙動が変わった場合は、通常導線のコピーとWeb版を使用してください。
