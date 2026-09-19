import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageUrl = new URL('../package.json', import.meta.url)
const hostUrl = new URL('../lib/index.js', import.meta.url)

test('bundle does not install a second DSH tool runtime into the profile', async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, 'utf8'))
  const hostSource = await readFile(hostUrl, 'utf8')

  assert.equal(packageJson.dependencies?.['@deepseek-ai/dsh-tools'], undefined)
  assert.equal(packageJson.optionalDependencies?.['@deepseek-ai/dsh-tools'], undefined)
  assert.equal(packageJson.peerDependencies?.['@deepseek-ai/dsh-tools'], undefined)
  assert.doesNotMatch(hostSource, /from\s+['"]@deepseek-ai\/dsh-tools['"]/)
  assert.match(hostSource, /ctx\.tools\.register\(defineNovelTool\(/)
})
