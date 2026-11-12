import {buildQuestPrompt} from './quest.js';

export function buildLocalQuestPrompt(spellId) {
  const canonical = buildQuestPrompt(spellId);
  const boundary = canonical.indexOf('\n# 初期アクション：写真を受け取るまで');
  if (boundary < 0) throw new Error('写真生成の指示を確認できません。');
  const rules = canonical.slice(0, boundary).trim().replace('これからユーザーが送る、', '今回添付された、');
  return `${rules}

# 今回のアクション：添付写真から画像を生成
このメッセージに添付された写真を使い、上記ルールに従って、選択された魔法を放つ最高品質の完成画像を直ちに1枚だけ生成してください。歓迎文、撮影の案内、写真を再送する依頼、追加質問は不要です。複数候補、比較グリッド、別アングル、追加画像は作らず、画像内に説明文、文字装飾、透かしを追加しないでください。添付写真を確認できない場合や画像生成機能を利用できない場合は、生成したと偽らず、その旨を簡潔に伝えてください。`;
}
