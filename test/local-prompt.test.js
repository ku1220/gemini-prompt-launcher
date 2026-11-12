import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {SPELLS, buildQuestPrompt, WELCOME_TEXT} from '../dist/quest.js';

const context = vm.createContext({buildQuestPrompt});
new vm.Script((await readFile(new URL('../local/extension/local-prompt.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace(/^export /gm, '')).runInContext(context);

test('all local spells combine the canonical photo rules with an immediate one-image action', () => {
  for (const spell of SPELLS) {
    const prompt = context.buildLocalQuestPrompt(spell.id);
    assert.ok(prompt.includes(spell.effect));
    assert.ok(prompt.includes(spell.pose));
    assert.match(prompt, /写真の人物の顔立ち、髪型/);
    assert.match(prompt, /モンスター立像の造形、比率、色彩を保持/);
    assert.match(prompt, /このメッセージに添付された写真/);
    assert.match(prompt, /直ちに1枚だけ生成/);
    assert.doesNotMatch(prompt, /# 初期アクション|# 次のアクション|写真がまだ届いていない|次のユーザーメッセージ|カメラを起動/);
    assert.ok(!prompt.includes(WELCOME_TEXT));
    assert.ok(buildQuestPrompt(spell.id).includes(WELCOME_TEXT));
  }
});

test('an invalid local spell never silently falls back to another instruction', () => {
  assert.throws(() => context.buildLocalQuestPrompt('unknown'));
});
