import {buildQuestPrompt, WELCOME_TEXT} from './quest.js';

export const LOCAL_WELCOME_TEXT = '冒険の準備はできましたか？ ローカル画面の「カメラを起動」から、まものに立ち向かう勇姿を撮影してください！';
export function buildLocalQuestPrompt(spellId) {
  return buildQuestPrompt(spellId).replace(WELCOME_TEXT, LOCAL_WELCOME_TEXT);
}
