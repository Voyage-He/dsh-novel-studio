import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const PROJECT_SCHEMA_VERSION = 4

const STATUS_VALUES = new Set(['planned', 'outlined', 'draft', 'revised', 'final'])
const NOVEL_STATUS_VALUES = new Set(['ongoing', 'finished', 'paused'])

function nowIso() {
  return new Date().toISOString()
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function text(value, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function finiteNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function slugId(value, prefix) {
  const clean = text(value).trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return clean || `${prefix}-${randomUUID().slice(0, 8)}`
}

function words(value) {
  const source = text(value).trim()
  if (source === '') return 0
  const cjk = source.match(/[\u3400-\u9fff]/g)?.length ?? 0
  const latin = source.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0
  return cjk + latin
}

export function createEmptyProject() {
  const createdAt = nowIso()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: 'novel-project',
    title: '未命名小说',
    genre: '',
    premise: '',
    targetWords: 100000,
    styleGuide: '',
    meta: {
      author: '',
      description: '',
      tags: [],
      status: 'ongoing',
    },
    volumes: [],
    masterOutline: '',
    characters: [],
    knowledge: [],
    chapters: [],
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeScene(candidate, index) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    id: slugId(source.id, `scene-${index + 1}`),
    title: text(source.title, `场景 ${index + 1}`).trim() || `场景 ${index + 1}`,
    summary: text(source.summary),
    pov: text(source.pov),
    location: text(source.location),
    goal: text(source.goal),
    conflict: text(source.conflict),
    outcome: text(source.outcome),
  }
}

function normalizePlacement(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    sceneDescription: text(source.sceneDescription),
    characterIds: stringIds(source.characterIds),
    requirements: text(source.requirements),
  }
}

function normalizeChapter(candidate, index) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  const content = text(source.content)
  return {
    id: slugId(source.id, `chapter-${index + 1}`),
    title: text(source.title, `第 ${index + 1} 章`).trim() || `第 ${index + 1} 章`,
    status: STATUS_VALUES.has(source.status) ? source.status : 'planned',
    generationMode: source.generationMode === 'placement' ? 'placement' : 'outline',
    placement: normalizePlacement(source.placement),
    outline: text(source.outline),
    content,
    notes: text(source.notes),
    scenes: Array.isArray(source.scenes) ? source.scenes.map(normalizeScene) : [],
    wordCount: words(content),
  }
}

function normalizeCharacter(candidate, index) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    id: slugId(source.id, `character-${index + 1}`),
    name: text(source.name, `人物 ${index + 1}`).trim() || `人物 ${index + 1}`,
    role: text(source.role),
    profile: text(source.profile),
    arc: text(source.arc),
  }
}

function normalizeKnowledge(candidate, index) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    id: slugId(source.id, `knowledge-${index + 1}`),
    title: text(source.title, `知识条目 ${index + 1}`).trim() || `知识条目 ${index + 1}`,
    category: text(source.category),
    content: text(source.content),
  }
}

function normalizeMeta(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    author: text(source.author),
    description: text(source.description),
    tags: stringIds(source.tags),
    status: NOVEL_STATUS_VALUES.has(source.status) ? source.status : 'ongoing',
  }
}

function normalizeVolume(candidate, index) {
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  return {
    id: slugId(source.id, `volume-${index + 1}`),
    title: text(source.title, `卷 ${index + 1}`).trim() || `卷 ${index + 1}`,
    chapterIds: stringIds(source.chapterIds),
  }
}

export function normalizeProject(candidate) {
  const empty = createEmptyProject()
  const source = candidate && typeof candidate === 'object' ? candidate : {}
  const createdAt = text(source.createdAt, empty.createdAt)
  const chapters = Array.isArray(source.chapters) ? source.chapters.map(normalizeChapter) : []
  const validChapterIds = new Set(chapters.map((chapter) => chapter.id))
  const assigned = new Set()
  const volumes = (Array.isArray(source.volumes) ? source.volumes.map(normalizeVolume) : []).map((volume) => ({
    ...volume,
    chapterIds: volume.chapterIds.filter((chapterId) => {
      if (!validChapterIds.has(chapterId) || assigned.has(chapterId)) return false
      assigned.add(chapterId)
      return true
    }),
  }))
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: slugId(source.id, 'novel-project'),
    title: text(source.title, empty.title).trim() || empty.title,
    genre: text(source.genre),
    premise: text(source.premise),
    targetWords: Math.max(0, Math.round(finiteNumber(source.targetWords, empty.targetWords))),
    styleGuide: text(source.styleGuide),
    meta: normalizeMeta(source.meta),
    volumes,
    masterOutline: text(source.masterOutline),
    characters: Array.isArray(source.characters) ? source.characters.map(normalizeCharacter) : [],
    knowledge: Array.isArray(source.knowledge) ? source.knowledge.map(normalizeKnowledge) : [],
    chapters,
    createdAt,
    updatedAt: text(source.updatedAt, createdAt),
  }
}

function projectWordCount(project) {
  return project.chapters.reduce((sum, chapter) => sum + words(chapter.content), 0)
}

function changedItemIds(before, after, fields) {
  const oldMap = new Map(before.map((item) => [item.id, item]))
  const newMap = new Map(after.map((item) => [item.id, item]))
  const ids = new Set([...oldMap.keys(), ...newMap.keys()])
  return [...ids].filter((id) => {
    const left = oldMap.get(id)
    const right = newMap.get(id)
    if (!left || !right) return true
    return fields.some((field) => JSON.stringify(left[field]) !== JSON.stringify(right[field]))
  })
}

export function summarizeChange(before, after) {
  if (before === null) {
    return {
      sections: ['project'],
      wordDelta: projectWordCount(after),
      changedChapters: after.chapters.map((chapter) => chapter.id),
      changedCharacters: after.characters.map((character) => character.id),
      changedKnowledge: after.knowledge.map((entry) => entry.id),
      changedVolumes: after.volumes.map((volume) => volume.id),
    }
  }
  const sections = []
  const metaChanged = ['title', 'genre', 'premise', 'targetWords', 'styleGuide'].some((key) => before[key] !== after[key])
    || JSON.stringify(before.meta) !== JSON.stringify(after.meta)
  if (metaChanged) sections.push('meta')
  if (before.masterOutline !== after.masterOutline) sections.push('outline')
  const changedCharacters = changedItemIds(before.characters, after.characters, ['name', 'role', 'profile', 'arc'])
  const changedKnowledge = changedItemIds(before.knowledge, after.knowledge, ['title', 'category', 'content'])
  const changedChapters = changedItemIds(before.chapters, after.chapters, ['title', 'status', 'generationMode', 'placement', 'outline', 'content', 'notes', 'scenes'])
  const changedVolumes = changedItemIds(before.volumes, after.volumes, ['title', 'chapterIds'])
  if (changedCharacters.length > 0) sections.push('characters')
  if (changedKnowledge.length > 0) sections.push('knowledge')
  if (changedChapters.length > 0) sections.push('chapters')
  if (changedVolumes.length > 0) sections.push('volumes')
  return {
    sections,
    wordDelta: projectWordCount(after) - projectWordCount(before),
    changedChapters,
    changedCharacters,
    changedKnowledge,
    changedVolumes,
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback
    throw error
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

export class RevisionConflictError extends Error {
  constructor(expected, actual) {
    super(`小说项目已被其它操作更新（页面基线 ${expected || '无'}，当前版本 ${actual || '无'}），请刷新后再保存。`)
    this.name = 'RevisionConflictError'
    this.expected = expected
    this.actual = actual
  }
}

export class NovelRepository {
  constructor(root, options = {}) {
    this.root = root
    this.projectPath = join(root, 'project.json')
    this.historyPath = join(root, '.history', 'index.json')
    this.revisionsPath = join(root, '.history', 'revisions')
    this.historyLimit = Math.max(10, Math.min(1000, Math.round(options.historyLimit ?? 300)))
    this.operation = Promise.resolve()
  }

  enqueue(task) {
    const next = this.operation.then(task, task)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }

  async isInitialized() {
    const [project, history] = await Promise.all([
      readJson(this.projectPath, null),
      readJson(this.historyPath, null),
    ])
    return project !== null && history !== null && Array.isArray(history.revisions)
  }

  // 显式初始化：创建 novel/project.json 与版本历史。
  // 幂等：已初始化时直接返回当前状态；已有 project.json 但缺历史时保留其内容并重建历史。
  async initialize() {
    return this.enqueue(async () => {
      if (await this.isInitialized()) return this.read()
      await mkdir(this.revisionsPath, { recursive: true })
      const project = normalizeProject(await readJson(this.projectPath, null))
      const history = { schemaVersion: 1, head: null, revisions: [] }
      await atomicJson(this.projectPath, project)
      await this.commitSnapshot(history, null, project, {
        message: '初始化小说项目',
        source: 'system',
      })
      return this.read()
    })
  }

  async read() {
    const [rawProject, rawHistory] = await Promise.all([
      readJson(this.projectPath, null),
      readJson(this.historyPath, null),
    ])
    if (rawProject === null || rawHistory === null || !Array.isArray(rawHistory.revisions)) {
      return { initialized: false, revision: null, history: [], project: null, stats: null }
    }
    const project = normalizeProject(rawProject)
    return {
      initialized: true,
      project,
      revision: rawHistory.head,
      history: rawHistory.revisions,
      stats: {
        words: projectWordCount(project),
        chapters: project.chapters.length,
        characters: project.characters.length,
        knowledge: project.knowledge.length,
      },
    }
  }

  async save(project, options = {}) {
    return this.enqueue(async () => {
      const current = await this.read()
      if (current.initialized === false) throw new Error('小说工程尚未初始化，请先初始化再保存')
      if (options.baseRevision !== undefined && options.baseRevision !== current.revision) {
        throw new RevisionConflictError(options.baseRevision, current.revision)
      }
      const next = normalizeProject({ ...project, createdAt: current.project.createdAt, updatedAt: nowIso() })
      const beforeComparable = JSON.stringify({ ...current.project, updatedAt: '' })
      const nextComparable = JSON.stringify({ ...next, updatedAt: '' })
      if (beforeComparable === nextComparable) return current
      const history = await readJson(this.historyPath, { schemaVersion: 1, head: null, revisions: [] })
      await atomicJson(this.projectPath, next)
      await this.commitSnapshot(history, current.project, next, {
        message: text(options.message, '保存修改').trim() || '保存修改',
        source: text(options.source, 'human'),
      })
      return this.read()
    })
  }

  async restore(revisionId) {
    return this.enqueue(async () => {
      const revision = await readJson(join(this.revisionsPath, `${revisionId}.json`), null)
      if (revision === null || !revision.snapshot) throw new Error(`找不到版本 ${revisionId}`)
      const current = await this.read()
      if (current.initialized === false) throw new Error('小说工程尚未初始化，请先初始化再恢复')
      const next = normalizeProject({ ...revision.snapshot, createdAt: current.project.createdAt, updatedAt: nowIso() })
      const history = await readJson(this.historyPath, { schemaVersion: 1, head: null, revisions: [] })
      await atomicJson(this.projectPath, next)
      await this.commitSnapshot(history, current.project, next, {
        message: `恢复到版本 ${revisionId}`,
        source: 'restore',
        parent: revisionId,
      })
      return this.read()
    })
  }

  async applyOperation(operation, args = {}) {
    const current = await this.read()
    if (current.initialized === false) throw new Error('小说工程尚未初始化，请先初始化再修改')
    const project = clone(current.project)
    const metadata = parseMetadata(args.metadataJson)
    const id = text(args.id).trim()
    const content = text(args.content)
    const title = text(args.title).trim()

    switch (operation) {
      case 'set_meta': {
        const meta = metadata
        if (typeof meta.title === 'string') project.title = meta.title
        if (typeof meta.genre === 'string') project.genre = meta.genre
        if (typeof meta.premise === 'string') project.premise = meta.premise
        if (typeof meta.styleGuide === 'string') project.styleGuide = meta.styleGuide
        if (typeof meta.targetWords === 'number') project.targetWords = meta.targetWords
        if (typeof meta.author === 'string') project.meta.author = meta.author
        if (typeof meta.description === 'string') project.meta.description = meta.description
        if (Array.isArray(meta.tags)) project.meta.tags = stringIds(meta.tags)
        if (typeof meta.status === 'string' && NOVEL_STATUS_VALUES.has(meta.status)) project.meta.status = meta.status
        break
      }
      case 'upsert_volume': {
        const itemId = id || slugId(title, `volume-${project.volumes.length + 1}`)
        const index = project.volumes.findIndex((item) => item.id === itemId)
        const previous = index >= 0 ? project.volumes[index] : {}
        const value = normalizeVolume({
          ...previous,
          id: itemId,
          title: title || previous.title,
          chapterIds: Array.isArray(metadata.chapterIds) ? metadata.chapterIds : previous.chapterIds,
        }, Math.max(0, index))
        if (index >= 0) project.volumes[index] = value
        else project.volumes.push(value)
        break
      }
      case 'delete_volume':
        project.volumes = project.volumes.filter((item) => item.id !== id)
        break
      case 'set_outline':
        project.masterOutline = content
        break
      case 'upsert_character': {
        const itemId = id || slugId(metadata.name || title, 'character')
        const index = project.characters.findIndex((item) => item.id === itemId)
        const value = normalizeCharacter({
          ...(index >= 0 ? project.characters[index] : {}),
          id: itemId,
          name: metadata.name || title,
          role: metadata.role,
          profile: content,
          arc: metadata.arc,
        }, Math.max(0, index))
        if (index >= 0) project.characters[index] = value
        else project.characters.push(value)
        break
      }
      case 'upsert_knowledge': {
        const itemId = id || slugId(title, 'knowledge')
        const index = project.knowledge.findIndex((item) => item.id === itemId)
        const value = normalizeKnowledge({
          ...(index >= 0 ? project.knowledge[index] : {}),
          id: itemId,
          title,
          category: metadata.category,
          content,
        }, Math.max(0, index))
        if (index >= 0) project.knowledge[index] = value
        else project.knowledge.push(value)
        break
      }
      case 'upsert_chapter_outline': {
        const itemId = id || slugId(title, `chapter-${project.chapters.length + 1}`)
        const index = project.chapters.findIndex((item) => item.id === itemId)
        const previous = index >= 0 ? project.chapters[index] : {}
        const value = normalizeChapter({
          ...previous,
          id: itemId,
          title: title || previous.title,
          status: metadata.status || previous.status || 'planned',
          outline: content,
          notes: typeof metadata.notes === 'string' ? metadata.notes : previous.notes,
          scenes: Array.isArray(metadata.scenes) ? metadata.scenes : previous.scenes,
        }, Math.max(0, index))
        if (index >= 0) project.chapters[index] = value
        else project.chapters.push(value)
        break
      }
      case 'set_chapter_placement': {
        const itemId = id || slugId(title, `chapter-${project.chapters.length + 1}`)
        const index = project.chapters.findIndex((item) => item.id === itemId)
        const previous = index >= 0 ? project.chapters[index] : {}
        const value = normalizeChapter({
          ...previous,
          id: itemId,
          title: title || previous.title,
          generationMode: 'placement',
          placement: {
            sceneDescription: content,
            characterIds: Array.isArray(metadata.characterIds) ? metadata.characterIds : previous.placement?.characterIds,
            requirements: typeof metadata.requirements === 'string' ? metadata.requirements : previous.placement?.requirements,
          },
        }, Math.max(0, index))
        if (index >= 0) project.chapters[index] = value
        else project.chapters.push(value)
        break
      }
      case 'set_chapter_content':
      case 'append_chapter_content': {
        if (id === '') throw new Error(`${operation} 需要章节 id`)
        const index = project.chapters.findIndex((item) => item.id === id)
        if (index < 0) throw new Error(`找不到章节 ${id}`)
        const chapter = project.chapters[index]
        const nextContent = operation === 'append_chapter_content' && chapter.content.trim() !== ''
          ? `${chapter.content.replace(/\s+$/, '')}\n\n${content.replace(/^\s+/, '')}`
          : content
        project.chapters[index] = normalizeChapter({
          ...chapter,
          content: nextContent,
          status: metadata.status || chapter.status,
          notes: typeof metadata.notes === 'string' ? metadata.notes : chapter.notes,
        }, index)
        break
      }
      case 'delete_character':
        project.characters = project.characters.filter((item) => item.id !== id)
        break
      case 'delete_knowledge':
        project.knowledge = project.knowledge.filter((item) => item.id !== id)
        break
      case 'delete_chapter':
        project.chapters = project.chapters.filter((item) => item.id !== id)
        break
      default:
        throw new Error(`不支持的小说写入操作：${operation}`)
    }

    return this.save(project, {
      baseRevision: current.revision,
      message: text(args.message, `AI：${operation}`).trim() || `AI：${operation}`,
      source: 'ai',
    })
  }

  async commitSnapshot(history, before, project, options) {
    const createdAt = nowIso()
    const parent = options.parent === undefined ? history.head ?? null : options.parent
    const digest = createHash('sha256')
      .update(JSON.stringify({ parent, createdAt, message: options.message, project }))
      .digest('hex')
      .slice(0, 12)
    const summary = summarizeChange(before, project)
    const record = {
      id: digest,
      parent,
      createdAt,
      source: options.source,
      message: options.message,
      summary,
      snapshot: project,
    }
    await atomicJson(join(this.revisionsPath, `${digest}.json`), record)
    const revisions = [{
      id: record.id,
      parent: record.parent,
      createdAt: record.createdAt,
      source: record.source,
      message: record.message,
      summary: record.summary,
    }, ...(Array.isArray(history.revisions) ? history.revisions : [])]
    const kept = revisions.slice(0, this.historyLimit)
    const removed = revisions.slice(this.historyLimit)
    await atomicJson(this.historyPath, {
      schemaVersion: 1,
      head: digest,
      revisions: kept,
    })
    await Promise.all(removed.map((item) => rm(join(this.revisionsPath, `${item.id}.json`), { force: true }).catch(() => {})))
    return record
  }
}

function parseMetadata(value) {
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch (error) {
    throw new Error(`metadataJson 不是有效 JSON：${error.message}`)
  }
  throw new Error('metadataJson 必须是 JSON 对象')
}

export async function removeRepositoryForTest(root) {
  const entries = await readdir(root).catch(() => [])
  await Promise.all(entries.map((entry) => rm(join(root, entry), { recursive: true, force: true })))
}
