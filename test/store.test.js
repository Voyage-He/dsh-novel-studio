import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NovelRepository, RevisionConflictError, createEmptyProject, normalizeProject } from '../lib/store.js'

async function fixture(t, options) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-store-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  return new NovelRepository(root, options)
}

test('detects an uninitialized workspace without creating any files', async (t) => {
  const repository = await fixture(t)
  const payload = await repository.read()

  assert.equal(payload.initialized, false)
  assert.equal(payload.project, null)
  assert.equal(payload.revision, null)
  assert.deepEqual(payload.history, [])

  await assert.rejects(
    repository.save(createEmptyProject(), { baseRevision: null }),
    /尚未初始化/,
  )
  await assert.rejects(
    repository.applyOperation('set_outline', { content: 'x' }),
    /尚未初始化/,
  )
})

test('initializes a git-friendly project and first revision', async (t) => {
  const repository = await fixture(t)
  const payload = await repository.initialize()

  assert.equal(payload.initialized, true)
  assert.equal(payload.project.title, '未命名小说')
  assert.equal(payload.project.schemaVersion, 4)
  assert.equal(Object.hasOwn(payload.project, 'stage'), false)
  assert.equal(payload.history.length, 1)
  assert.equal(payload.history[0].message, '初始化小说项目')
  assert.equal(payload.revision, payload.history[0].id)

  const serialized = await readFile(join(repository.root, 'project.json'), 'utf8')
  assert.match(serialized, /"masterOutline": ""/)
  assert.ok(serialized.endsWith('\n'))
})

test('initialize is idempotent', async (t) => {
  const repository = await fixture(t)
  const first = await repository.initialize()
  const second = await repository.initialize()
  assert.equal(second.initialized, true)
  assert.equal(second.revision, first.revision)
  assert.equal((await readdir(join(repository.root, '.history', 'revisions'))).length, 1)
})

test('initialize keeps an existing project.json and rebuilds history', async (t) => {
  const repository = await fixture(t)
  await writeFile(join(repository.root, 'project.json'), JSON.stringify({
    ...createEmptyProject(),
    title: '旧工程',
    masterOutline: '已有内容',
  }), 'utf8')

  const payload = await repository.initialize()
  assert.equal(payload.project.title, '旧工程')
  assert.equal(payload.project.masterOutline, '已有内容')
  assert.equal(payload.revision, payload.history[0].id)
})

test('normalizes legacy staged projects into the non-linear schema without losing content', () => {
  const project = normalizeProject({
    schemaVersion: 1,
    stage: 'draft',
    masterOutline: '旧版全书提纲',
    chapters: [{
      id: 'chapter-1',
      title: '旧章节',
      status: 'draft',
      outline: '旧版章节提纲',
      content: '已经写好的正文',
    }],
  })

  assert.equal(project.schemaVersion, 4)
  assert.equal(Object.hasOwn(project, 'stage'), false)
  assert.equal(project.masterOutline, '旧版全书提纲')
  assert.deepEqual(project.meta, { author: '', description: '', tags: [], status: 'ongoing' })
  assert.deepEqual(project.volumes, [])
  assert.equal(project.chapters[0].generationMode, 'outline')
  assert.deepEqual(project.chapters[0].placement, { sceneDescription: '', characterIds: [], requirements: '' })
  assert.equal(project.chapters[0].outline, '旧版章节提纲')
  assert.equal(project.chapters[0].content, '已经写好的正文')
})

test('normalizes metadata and volumes, dropping invalid or duplicated chapter references', () => {
  const project = normalizeProject({
    meta: {
      author: '林桥',
      description: '一座退潮才可见的城市。',
      tags: ['悬疑', ' 近未来 ', '', '悬疑'],
      status: 'paused',
    },
    volumes: [
      { id: 'volume-1', title: '第一卷 退潮', chapterIds: ['chapter-1', 'chapter-2', 'chapter-1', 'missing'] },
      { id: 'volume-2', title: '第二卷 涨潮', chapterIds: ['chapter-1'] },
    ],
    chapters: [
      { id: 'chapter-1', title: '第 1 章' },
      { id: 'chapter-2', title: '第 2 章' },
    ],
  })

  assert.equal(project.meta.author, '林桥')
  assert.deepEqual(project.meta.tags, ['悬疑', '近未来'])
  assert.equal(project.meta.status, 'paused')
  assert.equal(project.volumes.length, 2)
  assert.deepEqual(project.volumes[0].chapterIds, ['chapter-1', 'chapter-2'])
  assert.deepEqual(project.volumes[1].chapterIds, [])
})

test('AI can update metadata and manage volumes without touching other layers', async (t) => {
  const repository = await fixture(t)
  await repository.initialize()

  const metaResult = await repository.applyOperation('set_meta', {
    metadataJson: JSON.stringify({ title: '潮痕', author: '林桥', description: '海水保存记忆。', tags: ['悬疑', '近未来'], status: 'finished' }),
    message: '补充元数据',
  })
  assert.equal(metaResult.project.meta.author, '林桥')
  assert.deepEqual(metaResult.project.meta.tags, ['悬疑', '近未来'])
  assert.equal(metaResult.project.meta.status, 'finished')
  assert.ok(metaResult.history[0].summary.sections.includes('meta'))
  assert.equal(metaResult.project.chapters.length, 0)

  const volumeResult = await repository.applyOperation('upsert_volume', {
    id: 'volume-1',
    title: '第一卷 退潮',
    metadataJson: JSON.stringify({ chapterIds: ['chapter-1'] }),
    message: '建立第一卷',
  })
  assert.equal(volumeResult.project.volumes.length, 1)
  assert.equal(volumeResult.project.volumes[0].title, '第一卷 退潮')
  assert.ok(volumeResult.history[0].summary.sections.includes('volumes'))

  const removed = await repository.applyOperation('delete_volume', { id: 'volume-1', message: '删卷' })
  assert.equal(removed.project.volumes.length, 0)
})

test('serializes concurrent initializations into one initial revision', async (t) => {
  const repository = await fixture(t)
  const payloads = await Promise.all([repository.initialize(), repository.initialize(), repository.initialize()])
  const snapshots = await readdir(join(repository.root, '.history', 'revisions'))

  assert.equal(new Set(payloads.map((payload) => payload.revision)).size, 1)
  assert.equal(payloads[0].history.length, 1)
  assert.equal(snapshots.length, 1)
})

test('saves snapshots, reports semantic changes and rejects stale baselines', async (t) => {
  const repository = await fixture(t)
  const first = await repository.initialize()
  const edited = structuredClone(first.project)
  edited.title = '雾港来信'
  edited.masterOutline = '失踪记者留下七封无法寄出的信。'

  const second = await repository.save(edited, {
    baseRevision: first.revision,
    message: '确定书名与总纲',
    source: 'human',
  })

  assert.notEqual(second.revision, first.revision)
  assert.equal(second.history[0].message, '确定书名与总纲')
  assert.deepEqual(second.history[0].summary.sections, ['meta', 'outline'])

  await assert.rejects(
    repository.save({ ...second.project, genre: '悬疑' }, { baseRevision: first.revision }),
    (error) => error instanceof RevisionConflictError && error.actual === second.revision,
  )
})

test('AI operations can revise any layer in any order without implicit status changes', async (t) => {
  const repository = await fixture(t)
  await repository.initialize()

  await repository.applyOperation('set_meta', {
    metadataJson: JSON.stringify({ title: '潮痕', genre: '近未来悬疑', premise: '海水会保存人的最后一段记忆。' }),
    message: '建立作品定位',
  })
  await repository.applyOperation('upsert_character', {
    id: 'lin-qiao',
    title: '林桥',
    content: '记忆取证员，极度依赖事实，却隐瞒自己删除过妹妹的记忆。',
    metadataJson: JSON.stringify({ role: '主角', arc: '控制事实 → 接受记忆的不可靠 → 承担选择' }),
    message: '补充主角卡',
  })
  await repository.applyOperation('upsert_knowledge', {
    id: 'memory-tide',
    title: '记忆潮汐',
    content: '只有死亡前七分钟的强烈记忆会在特定盐度下析出。',
    metadataJson: JSON.stringify({ category: '世界规则' }),
    message: '记录核心世界规则',
  })
  await repository.applyOperation('upsert_chapter_outline', {
    id: 'chapter-1',
    title: '退潮之后',
    content: '林桥在禁区打捞到一段不属于死者的童年记忆。',
    metadataJson: JSON.stringify({
      status: 'revised',
      scenes: [{ id: 'scene-1', title: '打捞', goal: '确认死者身份', conflict: '记忆指向林桥本人', outcome: '林桥私藏样本' }],
    }),
    message: '完成第一章小纲',
  })
  const drafted = await repository.applyOperation('append_chapter_content', {
    id: 'chapter-1',
    content: '退潮时，防波堤像一排刚从水里醒来的黑色牙齿。',
    message: '写入第一场正文',
  })
  await repository.applyOperation('set_outline', {
    content: '调查员从一具没有身份的溺尸开始，逐步发现城市在出售死者记忆。',
    message: '写完正文后再补全书提纲',
  })
  await repository.applyOperation('upsert_chapter_outline', {
    id: 'chapter-1',
    content: '林桥在禁区打捞到一段不属于死者的童年记忆，并决定私藏样本。',
    message: '正文存在时继续改章节提纲',
  })
  const continued = await repository.applyOperation('append_chapter_content', {
    id: 'chapter-1',
    content: '林桥把取样管举到路灯下，蓝色絮状物正缓慢聚成一张脸。',
    message: '续写第一场',
  })

  assert.equal(continued.project.title, '潮痕')
  assert.equal(Object.hasOwn(continued.project, 'stage'), false)
  assert.equal(continued.project.characters[0].id, 'lin-qiao')
  assert.equal(continued.project.knowledge[0].category, '世界规则')
  assert.equal(continued.project.chapters[0].scenes.length, 1)
  assert.equal(continued.project.chapters[0].status, 'revised')
  assert.match(continued.project.chapters[0].outline, /私藏样本/)
  assert.match(continued.project.chapters[0].content, /退潮时[\s\S]+林桥把取样管/)
  assert.ok(continued.stats.words > drafted.stats.words)
  assert.equal(continued.history[0].source, 'ai')
})

test('placement mode stores intent and keeps it when AI writes the generated outline', async (t) => {
  const repository = await fixture(t)
  await repository.initialize()

  await repository.applyOperation('set_chapter_placement', {
    id: 'chapter-1',
    title: '雨夜候车室',
    content: '废弃车站突然恢复广播，站台上停着一列不存在于时刻表的旧车。',
    metadataJson: JSON.stringify({
      characterIds: ['lin-qiao', 'witness', 'lin-qiao', ''],
      requirements: '不要立刻揭露列车来源；结尾留下必须登车的压力。',
    }),
    message: '布置第一章',
  })
  const generated = await repository.applyOperation('upsert_chapter_outline', {
    id: 'chapter-1',
    content: '广播叫出林桥的名字，目击者否认听见，旧车开门后出现与前文矛盾的证物。',
    metadataJson: JSON.stringify({
      scenes: [{ id: 'platform', title: '不存在的列车', goal: '确认广播来源', conflict: '只有林桥听见自己的名字', outcome: '两人被迫登车' }],
    }),
    message: '根据放置生成细纲',
  })

  const chapter = generated.project.chapters[0]
  assert.equal(chapter.generationMode, 'placement')
  assert.equal(chapter.placement.sceneDescription, '废弃车站突然恢复广播，站台上停着一列不存在于时刻表的旧车。')
  assert.deepEqual(chapter.placement.characterIds, ['lin-qiao', 'witness'])
  assert.match(chapter.placement.requirements, /不要立刻揭露/)
  assert.match(chapter.outline, /广播叫出林桥/)
  assert.equal(chapter.scenes[0].id, 'platform')
})

test('restore creates a new head without destroying later history', async (t) => {
  const repository = await fixture(t)
  const initial = await repository.initialize()
  const firstProject = structuredClone(initial.project)
  firstProject.title = '第一版书名'
  const first = await repository.save(firstProject, { baseRevision: initial.revision, message: '第一版' })
  const secondProject = structuredClone(first.project)
  secondProject.title = '第二版书名'
  const second = await repository.save(secondProject, { baseRevision: first.revision, message: '第二版' })

  const restored = await repository.restore(first.revision)

  assert.equal(restored.project.title, '第一版书名')
  assert.notEqual(restored.revision, first.revision)
  assert.notEqual(restored.revision, second.revision)
  assert.equal(restored.history[0].source, 'restore')
  assert.equal(restored.history[0].parent, first.revision)
  assert.ok(restored.history.some((revision) => revision.id === second.revision))

  const branchProject = structuredClone(restored.project)
  branchProject.title = '第一版的另一条分支'
  const branched = await repository.save(branchProject, {
    baseRevision: restored.revision,
    message: '沿恢复版本继续修改',
  })
  assert.equal(branched.history[0].parent, restored.revision)
  assert.equal(branched.history.find((revision) => revision.id === second.revision).parent, first.revision)
})

test('history retention prunes old snapshot files from the visible index', async (t) => {
  const repository = await fixture(t, { historyLimit: 10 })
  let payload = await repository.initialize()
  for (let index = 0; index < 14; index += 1) {
    const project = structuredClone(payload.project)
    project.premise = `版本 ${index}`
    payload = await repository.save(project, { baseRevision: payload.revision, message: `编辑 ${index}` })
  }
  assert.equal(payload.history.length, 10)
  assert.equal(payload.history[0].message, '编辑 13')
})
