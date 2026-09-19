import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../lib/index.js'

function fakeContext(agentsById) {
  const definitions = []
  let route = null
  return {
    definitions,
    get route() { return route },
    tools: {
      register(definition) {
        definitions.push(definition)
        return () => {}
      },
    },
    webServer: {
      register(definition) {
        route = definition
        return () => { route = null }
      },
    },
    agents: {
      get(id) { return agentsById.get(id) },
    },
    effect(setup) {
      setup()
      return () => {}
    },
  }
}

function execution(cwd) {
  return {
    agent: { session: { header: { cwd } } },
    signal: new AbortController().signal,
  }
}

async function initProject(write, root) {
  await write.execute({ operation: 'init_project' }, execution(root))
}

async function projectGet(ctx, sessionId) {
  const request = Readable.from([])
  request.method = 'GET'
  request.socket = { remoteAddress: '127.0.0.1' }
  request.url = '/plugins/novel-studio/project?sessionId=' + sessionId
  let status = 0
  let body = ''
  await ctx.route.handler(request, {
    writeHead(nextStatus) { status = nextStatus },
    end(value) { body = value },
  })
  return { status, payload: JSON.parse(body) }
}

test('host plugin registers official tools and keeps repositories workspace-scoped', async (t) => {
  const firstRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-host-a-'))
  const secondRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-host-b-'))
  t.after(async () => Promise.all([
    rm(firstRoot, { recursive: true, force: true }),
    rm(secondRoot, { recursive: true, force: true }),
  ]))

  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })

  assert.deepEqual(ctx.definitions.map((definition) => definition.name), [
    'novel_project_read',
    'novel_project_write',
  ])
  assert.equal(ctx.route.path, '/plugins/novel-studio/project')

  const read = ctx.definitions[0]
  const write = ctx.definitions[1]
  assert.equal(read.parameters.type, 'object')
  assert.equal(read.parameters.properties.section.type, 'string')
  assert.equal(write.parameters.type, 'object')
  assert.deepEqual(write.parameters.required, ['operation'])
  assert.equal(write.parameters.properties.operation.type, 'string')
  assert.equal(write.output.schema.type, 'string')
  assert.equal(typeof write.output.render, 'function')

  await initProject(write, firstRoot)
  await initProject(write, secondRoot)
  await assert.rejects(
    write.execute({ operation: 123 }, execution(firstRoot)),
    /operation 必须是 string/,
  )
  await write.execute({
    operation: 'set_outline',
    content: 'A workspace 的总纲',
    message: '写入 A',
  }, execution(firstRoot))
  await write.execute({
    operation: 'set_outline',
    content: 'B workspace 的总纲',
    message: '写入 B',
  }, execution(secondRoot))

  const first = JSON.parse(await read.execute({ section: 'outline' }, execution(firstRoot)))
  const second = JSON.parse(await read.execute({ section: 'outline' }, execution(secondRoot)))

  assert.equal(first.project.masterOutline, 'A workspace 的总纲')
  assert.equal(second.project.masterOutline, 'B workspace 的总纲')
  assert.notEqual(first.revision, second.revision)

  const firstDisk = JSON.parse(await readFile(join(firstRoot, 'novel', 'project.json'), 'utf8'))
  const secondDisk = JSON.parse(await readFile(join(secondRoot, 'novel', 'project.json'), 'utf8'))
  assert.equal(firstDisk.masterOutline, 'A workspace 的总纲')
  assert.equal(secondDisk.masterOutline, 'B workspace 的总纲')
})

test('host configuration refuses a project directory outside the workspace', () => {
  const ctx = fakeContext(new Map())
  assert.throws(
    () => apply(ctx, { projectDirectory: '../elsewhere', historyLimit: 40 }),
    /workspace 内的相对路径/,
  )
})

test('placement generation context resolves character cards, knowledge and previous prose', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-placement-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  await initProject(write, root)
  await write.execute({
    operation: 'upsert_character',
    id: 'lin-qiao',
    title: '林桥',
    content: '记忆取证员，习惯隐藏恐惧。',
    metadataJson: JSON.stringify({ role: '主角', arc: '从控制走向承担' }),
  }, execution(root))
  await write.execute({
    operation: 'upsert_knowledge',
    id: 'ghost-train',
    title: '幽灵列车规则',
    content: '列车只会在暴雨夜停靠废弃站台。',
    metadataJson: JSON.stringify({ category: '世界规则' }),
  }, execution(root))
  await write.execute({ operation: 'upsert_chapter_outline', id: 'chapter-1', title: '前章', content: '林桥收到一张过期车票。' }, execution(root))
  await write.execute({ operation: 'set_chapter_content', id: 'chapter-1', content: '雨水泡开车票背面的蓝色墨迹，露出今晚十一点的时间。' }, execution(root))
  await write.execute({
    operation: 'set_chapter_placement',
    id: 'chapter-2',
    title: '末班车',
    content: '废弃站台恢复广播，一列旧车无声进站。',
    metadataJson: JSON.stringify({ characterIds: ['lin-qiao'], requirements: '结尾必须登车' }),
  }, execution(root))

  const context = JSON.parse(await read.execute({ section: 'generation', id: 'chapter-2' }, execution(root)))
  assert.equal(context.currentChapter.generationMode, 'placement')
  assert.equal(context.placement.selectedCharacters[0].profile, '记忆取证员，习惯隐藏恐惧。')
  assert.equal(context.worldKnowledge[0].id, 'ghost-train')
  assert.equal(context.previousChapters[0].id, 'chapter-1')
  assert.match(context.recentPreviousProse[0].excerpt, /今晚十一点/)
  assert.match(context.writingContract.persistResult, /upsert_chapter_outline/)
  await assert.rejects(read.execute({ section: 'generation', id: 'missing' }, execution(root)), /找不到章节 missing/)
})

test('write tool returns a summarized change report instead of raw content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-summary-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  await initProject(write, root)
  await write.execute({
    operation: 'upsert_character',
    id: 'lin-qiao',
    title: '林桥',
    content: '记忆取证员，习惯隐瞒恐惧。',
    metadataJson: JSON.stringify({ role: '主角', arc: '从控制走向承担' }),
    message: '建立林桥人物卡',
  }, execution(root))

  const result = JSON.parse(await write.execute({
    operation: 'upsert_character',
    id: 'lin-qiao',
    title: '林桥',
    content: '记忆取证员，习惯隐瞒恐惧，却私藏了一段不属于自己的童年记忆。',
    metadataJson: JSON.stringify({ role: '主角', arc: '从控制走向承担' }),
    message: '完善林桥的隐瞒设定',
  }, execution(root)))

  assert.equal(result.ok, true)
  assert.ok(result.changes.sections.includes('characters'))
  assert.deepEqual(result.changes.names.characters, ['林桥'])
  assert.match(result.message, /已写入小说工程并创建版本/)

  const rendered = write.output.render({}, JSON.stringify(result))[0].text
  assert.match(rendered, /人物（林桥）/)
  assert.match(rendered, /版本 [0-9a-f]{12}/)
  assert.doesNotMatch(rendered, /私藏|隐瞒恐惧|林桥.*档案/)
  assert.doesNotMatch(rendered, /"profile"/)

  const after = JSON.parse(await read.execute({ section: 'all' }, execution(root)))
  assert.match(after.project.characters[0].profile, /私藏/)
})

test('write tool reports when the proposed change matches the current version', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-identical-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const write = ctx.definitions[1]

  await initProject(write, root)
  await write.execute({ operation: 'set_outline', content: '同一段总纲', message: '第一版' }, execution(root))
  const before = JSON.parse(await write.execute({ operation: 'set_outline', content: '同一段总纲', message: '重复写入' }, execution(root)))

  assert.equal(before.ok, true)
  assert.deepEqual(before.changes.sections, [])
  assert.match(before.message, /未创建新版本/)
  assert.match(write.output.render({}, JSON.stringify(before))[0].text, /无实质变化/)
})

test('conversation tool can restore a revision and sidebar can save manual edits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-restore-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const agents = new Map([['session-1', { session: { header: { cwd: root } } }]])
  const ctx = fakeContext(agents)
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  await initProject(write, root)
  await write.execute({ operation: 'set_outline', content: '第一版总纲', message: '第一版' }, execution(root))
  const first = JSON.parse(await read.execute({ section: 'outline' }, execution(root)))
  await write.execute({ operation: 'set_outline', content: '第二版总纲', message: '第二版' }, execution(root))
  const restored = JSON.parse(await write.execute({ operation: 'restore_revision', id: first.revision }, execution(root)))
  const current = JSON.parse(await read.execute({ section: 'all' }, execution(root)))

  assert.equal(current.project.masterOutline, '第一版总纲')
  assert.notEqual(restored.revision, first.revision)

  const manualProject = structuredClone(current.project)
  manualProject.title = '作者手动改名'
  const request = Readable.from([Buffer.from(JSON.stringify({
    action: 'save',
    project: manualProject,
    baseRevision: current.revision,
    message: '作者手动编辑',
  }))])
  request.method = 'POST'
  request.socket = { remoteAddress: '127.0.0.1' }
  request.url = '/plugins/novel-studio/project?sessionId=session-1'
  let status = 0
  let body = ''
  await ctx.route.handler(request, {
    writeHead(nextStatus) { status = nextStatus },
    end(value) { body = value },
  })
  const response = JSON.parse(body)
  assert.equal(status, 200)
  assert.equal(response.project.title, '作者手动改名')
  assert.equal(response.history[0].source, 'human')
})

test('write tool supports metadata and volumes and read context exposes them', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-meta-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  await initProject(write, root)
  await write.execute({
    operation: 'upsert_chapter_outline',
    id: 'chapter-1',
    title: '退潮',
    content: '打捞记忆。',
  }, execution(root))
  const meta = JSON.parse(await write.execute({
    operation: 'set_meta',
    metadataJson: JSON.stringify({ author: '林桥', description: '海水保存记忆。', tags: ['悬疑'], status: 'ongoing' }),
    message: '补充元数据',
  }, execution(root)))
  assert.equal(meta.ok, true)
  assert.ok(meta.changes.sections.includes('meta'))

  const volume = JSON.parse(await write.execute({
    operation: 'upsert_volume',
    id: 'volume-1',
    title: '第一卷',
    metadataJson: JSON.stringify({ chapterIds: ['chapter-1'] }),
    message: '建立第一卷',
  }, execution(root)))
  assert.ok(volume.changes.sections.includes('volumes'))
  assert.deepEqual(volume.changes.names.volumes, ['第一卷'])

  await write.execute({
    operation: 'upsert_volume',
    id: 'volume-2',
    title: '第二卷',
  }, execution(root))

  const context = JSON.parse(await read.execute({ section: 'outline' }, execution(root)))
  assert.equal(context.project.meta.author, '林桥')
  assert.deepEqual(context.project.meta.tags, ['悬疑'])
  assert.equal(context.project.volumes.length, 2)
  assert.deepEqual(context.project.volumes[0].chapterIds, ['chapter-1'])

  const rendered = write.output.render({}, JSON.stringify(volume))[0].text
  assert.match(rendered, /分卷（第一卷）/)
})

test('read tool flags an uninitialized workspace and init_project creates the project', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-init-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const ctx = fakeContext(new Map())
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  const before = JSON.parse(await read.execute({ section: 'all' }, execution(root)))
  assert.equal(before.initialized, false)
  assert.match(before.message, /init_project/)

  const created = JSON.parse(await write.execute({ operation: 'init_project' }, execution(root)))
  assert.equal(created.ok, true)
  assert.match(created.message, /已初始化小说工程/)
  assert.ok(created.changes.sections.includes('project'))
  assert.deepEqual(created.changes.names, {})

  const after = JSON.parse(await read.execute({ section: 'all' }, execution(root)))
  assert.equal(after.initialized, true)
  assert.equal(after.project.title, '未命名小说')
  assert.equal(after.revision, created.revision)

  const written = JSON.parse(await write.execute({ operation: 'set_outline', content: '初始化后的总纲', message: '初始化后第一笔' }, execution(root)))
  assert.equal(written.ok, true)
  assert.ok(written.changes.sections.includes('outline'))
})

test('sidebar API initializes an uninitialized workspace over POST', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-novel-host-api-init-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const agents = new Map([['session-1', { session: { header: { cwd: root } } }]])
  const ctx = fakeContext(agents)
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })

  const request = Readable.from([Buffer.from(JSON.stringify({ action: 'initialize' }))])
  request.method = 'POST'
  request.socket = { remoteAddress: '127.0.0.1' }
  request.url = '/plugins/novel-studio/project?sessionId=session-1'
  let status = 0
  let body = ''
  await ctx.route.handler(request, {
    writeHead(nextStatus) { status = nextStatus },
    end(value) { body = value },
  })
  const response = JSON.parse(body)
  assert.equal(status, 200)
  assert.equal(response.ok, true)
  assert.equal(response.initialized, true)

  const disk = JSON.parse(await readFile(join(root, 'novel', 'project.json'), 'utf8'))
  assert.equal(disk.title, '未命名小说')
  assert.ok(Array.isArray(JSON.parse(await readFile(join(root, 'novel', '.history', 'index.json'), 'utf8')).revisions))
})

test('workspace kind separates empty, occupied and novel directories', async (t) => {
  const emptyRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-kind-empty-'))
  const occupiedRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-kind-occupied-'))
  const novelRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-kind-novel-'))
  const strayNovelRoot = await mkdtemp(join(tmpdir(), 'dsh-novel-kind-stray-'))
  const missingRoot = join(tmpdir(), 'dsh-novel-kind-missing-' + Date.now().toString(36))
  t.after(async () => Promise.all([
    rm(emptyRoot, { recursive: true, force: true }),
    rm(occupiedRoot, { recursive: true, force: true }),
    rm(novelRoot, { recursive: true, force: true }),
    rm(strayNovelRoot, { recursive: true, force: true }),
  ]))
  await writeFile(join(occupiedRoot, 'package.json'), '{}\n')
  // 只有 novel/ 目录但没有有效工程文件：不能当作空目录，仍属于已被占用。
  await mkdir(join(strayNovelRoot, 'novel'), { recursive: true })
  await writeFile(join(strayNovelRoot, 'novel', 'notes.md'), '手记\n')
  const agents = new Map([
    ['session-empty', { session: { header: { cwd: emptyRoot } } }],
    ['session-occupied', { session: { header: { cwd: occupiedRoot } } }],
    ['session-novel', { session: { header: { cwd: novelRoot } } }],
    ['session-stray', { session: { header: { cwd: strayNovelRoot } } }],
    ['session-missing', { session: { header: { cwd: missingRoot } } }],
  ])
  const ctx = fakeContext(agents)
  apply(ctx, { projectDirectory: 'novel', historyLimit: 40 })
  const read = ctx.definitions[0]
  const write = ctx.definitions[1]

  assert.equal((await projectGet(ctx, 'session-empty')).payload.workspaceKind, 'empty')
  assert.equal((await projectGet(ctx, 'session-occupied')).payload.workspaceKind, 'occupied')
  assert.equal((await projectGet(ctx, 'session-stray')).payload.workspaceKind, 'occupied')
  assert.equal((await projectGet(ctx, 'session-missing')).payload.workspaceKind, 'unknown')

  const occupiedRead = JSON.parse(await read.execute({ section: 'all' }, execution(occupiedRoot)))
  assert.equal(occupiedRead.initialized, false)
  assert.equal(occupiedRead.workspaceKind, 'occupied')
  assert.match(occupiedRead.message, /其它用途/)

  await initProject(write, novelRoot)
  const novel = await projectGet(ctx, 'session-novel')
  assert.equal(novel.payload.workspaceKind, 'novel')
  assert.equal(novel.payload.initialized, true)

  // 忽略版本控制/系统文件：只含 .git 的目录仍视为可初始化。
  await writeFile(join(emptyRoot, '.gitignore'), 'node_modules\n')
  assert.equal((await projectGet(ctx, 'session-empty')).payload.workspaceKind, 'empty')

  await initProject(write, emptyRoot)
  assert.equal((await projectGet(ctx, 'session-empty')).payload.workspaceKind, 'novel')
})
