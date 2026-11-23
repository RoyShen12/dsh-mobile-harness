import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { text } from 'node:stream/consumers'
import { encodeId, listPool, openFile, removeFile, resolveInPool, saveUpload } from '../lib/files.js'

test('transfer IDs select regular files directly in the pool', async t => {
  const prefix = join(await realpath(tmpdir()), 'dsh-pool-test-')
  const root = await mkdtemp(prefix)
  t.after(async () => {
    assert.ok(root.startsWith(prefix) && await realpath(root) === root)
    await rm(root, { recursive: true, force: true })
  })
  const pool = join(root, 'pool')
  await mkdir(pool)
  const fixture = join(root, 'outside.txt')
  await writeFile(fixture, 'outside')
  const name = '示例.txt'
  await writeFile(join(pool, name), 'inside')
  const [listed] = await listPool(pool)
  const file = await openFile(pool, listed.id)
  assert.equal(file.name, name)
  assert.equal(await text(file.stream()), 'inside')
  for (const path of ['nested/file', '../outside.txt', '../POOL/file', 'nested\\file', fixture]) {
    assert.equal(resolveInPool(pool, path), null)
    assert.equal(await openFile(pool, encodeId(path)), null)
    assert.equal(await removeFile(pool, encodeId(path)), false)
  }
  assert.equal(await removeFile(pool, listed.id), true)
  if (process.platform === 'win32') {
    for (const name of ['CONIN$.txt', 'COM¹.txt', 'NUL .txt']) {
      assert.equal(resolveInPool(pool, name), null)
      const uploaded = await saveUpload(pool, name, Buffer.from('fixture'))
      assert.equal(uploaded.name, '_' + name)
      assert.equal(await text((await openFile(pool, uploaded.id)).stream()), 'fixture')
      assert.equal(await removeFile(pool, uploaded.id), true)
    }
  } else {
    await symlink(fixture, join(pool, 'linked'))
    assert.equal(await openFile(pool, encodeId('linked')), null)
    assert.equal(await removeFile(pool, encodeId('linked')), false)
    await writeFile(join(pool, name), 'original')
    const pinned = await openFile(pool, listed.id)
    await rename(join(pool, name), join(pool, 'old'))
    await symlink(fixture, join(pool, name))
    assert.equal(await text(pinned.stream()), 'original')
  }
  assert.equal(await readFile(fixture, 'utf8'), 'outside')
})
