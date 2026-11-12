import {mkdir, copyFile, readdir, chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const extensionPath = fileURLToPath(new URL('../.local/crystal-quest-extension/', import.meta.url));
export async function prepareLocalExtension() {
  const source = fileURLToPath(new URL('../local/extension/', import.meta.url));
  await mkdir(extensionPath, {recursive: true});
  for (const entry of await readdir(source, {withFileTypes: true})) {
    if (entry.isFile()) await copyFile(join(source, entry.name), join(extensionPath, entry.name));
  }
  await copyFile(new URL('../dist/quest.js', import.meta.url), join(extensionPath, 'quest.js'));
  await chmod(new URL('../Start Crystal Quest.command', import.meta.url), 0o755);
  return extensionPath;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Chromeで読み込むフォルダ: ${await prepareLocalExtension()}`);
}
