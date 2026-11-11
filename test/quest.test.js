import test from 'node:test';
import assert from 'node:assert/strict';
import { WELCOME_TEXT, SPELLS, getSpell, buildQuestPrompt } from '../dist/quest.js';

const expectedWelcome = '冒険の準備はできましたか？ 下の『＋』ボタンからカメラを起動し、まものに立ち向かう勇姿を撮影して送信してください！';

test('quest welcome exactly preserves the requested first reply', () => {
  assert.equal(WELCOME_TEXT, expectedWelcome);
  const prompt = buildQuestPrompt('ultima');
  assert.ok(prompt.includes(`\n${expectedWelcome}\n`));
  assert.ok(prompt.includes('画像生成は行わず'));
  assert.ok(prompt.includes('以下の1文だけをテキストで返してください'));
});

test('each selected magic carries its own effect and pose without another spell', () => {
  assert.deepEqual(SPELLS.map((spell) => spell.id), ['ultima', 'flare', 'holy', 'thundaga', 'blizzaga', 'meteor']);
  for (const spell of SPELLS) {
    assert.equal(getSpell(spell.id), spell);
    const prompt = buildQuestPrompt(spell.id);
    assert.ok(prompt.includes(`【${spell.name}】`));
    assert.ok(prompt.includes(spell.effect));
    assert.ok(prompt.includes(spell.pose));
    for (const other of SPELLS.filter((entry) => entry.id !== spell.id)) {
      assert.equal(prompt.includes(`【${other.name}】`), false);
      assert.equal(prompt.includes(other.effect), false);
    }
  }
});

test('quest is deterministic and keeps complete rules after each spell effect', () => {
  for (const spell of SPELLS) {
    const prompt = buildQuestPrompt(spell.id);
    assert.equal(prompt, buildQuestPrompt(spell.id));
    assert.ok(prompt.includes('人物の同一性を保持'));
    assert.ok(prompt.includes('モンスター立像の造形、比率、色彩を保持'));
    assert.ok(prompt.includes('実在の商標ロゴ'));
    assert.ok(prompt.endsWith('その旨を簡潔に伝えてください。'));
    assert.doesNotMatch(prompt, /ドラゴンクエスト|ドラクエ|マダンテ|メラゾーマ|イオナズン|全MP/);
  }
});

test('image instructions wait for a real photo and request only one finished output', () => {
  const prompt = buildQuestPrompt('ultima');
  assert.ok(prompt.includes('実際の写真が添付されたら'));
  assert.ok(prompt.includes('必ず1枚だけ生成'));
  assert.ok(prompt.includes('複数候補、比較グリッド、別アングル、追加画像は作らず'));
  assert.ok(prompt.includes('受信していない写真や人物・モンスターを見たものとして扱わない'));
  assert.ok(prompt.includes('生成したと偽らず'));
});

test('unknown IDs never silently launch a different magic', () => {
  for (const id of ['madante', 'ULTIMA', '', undefined, null, '__proto__']) {
    assert.throws(() => getSpell(id), RangeError);
    assert.throws(() => buildQuestPrompt(id), RangeError);
  }
});

test('spell catalog and entries cannot be mutated between selection and launch', () => {
  assert.equal(Object.isFrozen(SPELLS), true);
  for (const spell of SPELLS) assert.equal(Object.isFrozen(spell), true);
  assert.throws(() => { SPELLS[0].name = 'changed'; }, TypeError);
  assert.throws(() => { SPELLS.push({ id: 'extra' }); }, TypeError);
});
