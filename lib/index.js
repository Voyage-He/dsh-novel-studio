import { readdir } from 'node:fs/promises'
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { NovelRepository, RevisionConflictError } from './store.js'

export const name = 'dsh-novel-studio'
export const inject = ['tools', 'webServer', 'agents']

export const Config = Schema.object({
  projectDirectory: Schema.string().default('novel'),
  historyLimit: Schema.number().min(10).max(1000).default(300),
})

const ROUTE = '/plugins/novel-studio/project'
const MAX_BODY_BYTES = 12 * 1024 * 1024
const MAX_RECENT_PROSE_CHARS = 12000

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function validateProjectDirectory(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error('projectDirectory 不能为空')
  const candidate = normalize(value.trim())
  if (isAbsolute(candidate) || candidate === '..' || candidate.startsWith(`..${sep}`)) {
    throw new Error('projectDirectory 必须是 workspace 内的相对路径')
  }
  return candidate
}

function projectRoot(cwd, directory) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('当前会话没有有效的 workspace 路径')
  const workspace = resolve(cwd)
  const root = resolve(workspace, directory)
  if (root !== workspace && !root.startsWith(`${workspace}${sep}`)) throw new Error('小说目录越出了当前 workspace')
  return root
}

// 未初始化时的工作区分类：只把版本控制/系统条目视为“空”，
// 含其它任何内容（包括内容不明的小说目录）都视为已被占用。
const IGNORED_WORKSPACE_ENTRIES = new Set(['.git', '.gitignore', '.DS_Store'])

async function workspaceKind(workspace, initialized) {
  if (initialized) return 'novel'
  const entries = await readdir(workspace, { withFileTypes: true }).catch(() => null)
  if (entries === null) return 'unknown'
  return entries.every((entry) => IGNORED_WORKSPACE_ENTRIES.has(entry.name)) ? 'empty' : 'occupied'
}

function json(res, status, value) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(value))
}

async function bodyJson(req) {
  let bytes = 0
  const chunks = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  const source = Buffer.concat(chunks).toString('utf8')
  const value = JSON.parse(source || '{}')
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求体必须是 JSON 对象')
  return value
}

function toolText(value) {
  return [{ type: 'text', text: value }]
}

const SECTION_LABELS = {
  project: '工程',
  meta: '作品定位',
  outline: '全书提纲',
  characters: '人物',
  knowledge: '知识',
  chapters: '章节',
  volumes: '分卷',
}

function itemNames(items, ids, key) {
  return (ids ?? []).map((id) => {
    const item = items.find((entry) => entry.id === id)
    return item ? item[key] || id : id
  })
}

// 仅提取本次写入版本的简明变更摘要；不携带任何具体内容。
function summarizeWriteResult(payload) {
  const record = payload.history?.[0]
  const summary = record?.summary
  if (!summary) return { sections: [], wordDelta: 0, names: {} }
  return {
    sections: Array.isArray(summary.sections) ? summary.sections : [],
    wordDelta: typeof summary.wordDelta === 'number' ? summary.wordDelta : 0,
    names: {
      characters: itemNames(payload.project.characters, summary.changedCharacters, 'name'),
      knowledge: itemNames(payload.project.knowledge, summary.changedKnowledge, 'title'),
      chapters: itemNames(payload.project.chapters, summary.changedChapters, 'title'),
      volumes: itemNames(payload.project.volumes, summary.changedVolumes, 'title'),
    },
  }
}

// 把写入结果渲染成面向作者的一句话摘要；具体修改内容不会出现在对话界面。
function renderWriteResult(value) {
  let result
  try {
    result = JSON.parse(value)
  } catch (error) {
    return value
  }
  if (result === null || typeof result !== 'object' || result.ok !== true) return value
  const lines = [result.message || `已写入小说工程并创建版本 ${result.revision}`]
  const changes = result.changes
  if (changes && Array.isArray(changes.sections) && changes.sections.length > 0) {
    const parts = changes.sections.map((key) => {
      const label = SECTION_LABELS[key] || key
      const names = changes.names && Array.isArray(changes.names[key]) ? changes.names[key] : []
      return names.length > 0 ? `${label}（${names.join('、')}）` : label
    })
    lines.push(`变更：${parts.join('；')}`)
    if (typeof changes.wordDelta === 'number' && changes.wordDelta !== 0) {
      lines.push(`字数：${changes.wordDelta > 0 ? '+' : ''}${changes.wordDelta}`)
    }
  } else {
    lines.push('已记录新版本快照，内容无实质变化')
  }
  return lines.join('\n')
}

// Register the canonical ToolDefinition shape directly. Importing dsh-tools
// from a third-party bundle would install a second ToolRuntime copy in the
// profile; its private scheduler Symbol is incompatible with the DSH host.
function defineNovelTool(options) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(options.parameters)) {
    properties[key] = {
      type: spec.type,
      ...(spec.description === undefined ? {} : { description: spec.description }),
    }
    if (spec.required === true) required.push(key)
  }
  return {
    name: options.name,
    description: options.description,
    parameters: {
      type: 'object',
      properties,
      ...(required.length === 0 ? {} : { required }),
    },
    output: options.output,
    async execute(args, exec) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须是对象')
      for (const [key, spec] of Object.entries(options.parameters)) {
        const value = args[key]
        if (value === undefined) {
          if (spec.required === true) throw new Error(`缺少必需参数：${key}`)
          continue
        }
        if (spec.type === 'integer') {
          if (!Number.isInteger(value)) throw new Error(`参数 ${key} 必须是整数`)
          continue
        }
        if (spec.type === 'number') {
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`参数 ${key} 必须是有限数值`)
          continue
        }
        if (typeof value !== spec.type) throw new Error(`参数 ${key} 必须是 ${spec.type}`)
      }
      return options.execute(args, exec)
    },
  }
}

function recentPreviousProse(chapters, currentIndex) {
  let remaining = MAX_RECENT_PROSE_CHARS
  const excerpts = []
  for (let index = currentIndex - 1; index >= 0 && remaining > 0; index -= 1) {
    const content = chapters[index].content.trim()
    if (content === '') continue
    const excerpt = content.slice(Math.max(0, content.length - remaining))
    excerpts.unshift({
      id: chapters[index].id,
      title: chapters[index].title,
      excerpt,
      truncated: excerpt.length < content.length,
    })
    remaining -= excerpt.length
  }
  return excerpts
}

function selectGenerationContext(payload, id) {
  const project = payload.project
  const chapterIndex = project.chapters.findIndex((chapter) => chapter.id === id)
  if (chapterIndex < 0) throw new Error(`找不到章节 ${id}`)
  const chapter = project.chapters[chapterIndex]
  const characterIds = new Set(chapter.placement.characterIds)
  const selectedCharacters = project.characters.filter((character) => characterIds.has(character.id))
  const resolvedIds = new Set(selectedCharacters.map((character) => character.id))

  return {
    revision: payload.revision,
    task: chapter.generationMode === 'placement'
      ? '根据作者的场景布置自动生成当前章细纲与场景节拍；不要要求作者先提供细纲。'
      : '根据现有章节提纲继续规划或写作。',
    writingContract: {
      readBeforeGenerating: '必须综合使用已放置人物的最新人物卡、世界知识、前文连续性和当前章已有正文。',
      placementIsIntent: '场景布置表达作者意图，不是待扩写的章节提纲；允许 AI 补足因果、冲突、转折和场景顺序。',
      persistResult: '生成细纲后调用 novel_project_write：operation=upsert_chapter_outline，id 使用当前章节 id，content 写章节细纲，metadataJson.scenes 写结构化场景节拍。',
      preserveData: '不得覆盖当前章正文，也不得修改未被作者要求改变的人物卡、知识或其它章节。',
    },
    project: {
      title: project.title,
      genre: project.genre,
      premise: project.premise,
      styleGuide: project.styleGuide,
      meta: project.meta,
      volumes: project.volumes,
      masterOutline: project.masterOutline,
    },
    currentChapter: chapter,
    placement: {
      sceneDescription: chapter.placement.sceneDescription,
      requirements: chapter.placement.requirements,
      selectedCharacters,
      missingCharacterIds: chapter.placement.characterIds.filter((characterId) => !resolvedIds.has(characterId)),
    },
    worldKnowledge: project.knowledge,
    previousChapters: project.chapters.slice(0, chapterIndex).map((previous) => ({
      id: previous.id,
      title: previous.title,
      status: previous.status,
      outline: previous.outline,
      scenes: previous.scenes,
      wordCount: previous.wordCount,
    })),
    recentPreviousProse: recentPreviousProse(project.chapters, chapterIndex),
  }
}

function selectProjectContext(payload, section, id) {
  const project = payload.project
  if (section === 'generation') return selectGenerationContext(payload, id)
  if (section === 'all') return payload
  if (section === 'chapter') {
    return {
      revision: payload.revision,
      project: {
        title: project.title,
        genre: project.genre,
        premise: project.premise,
        styleGuide: project.styleGuide,
        meta: project.meta,
        volumes: project.volumes,
        masterOutline: project.masterOutline,
        characters: project.characters,
        knowledge: project.knowledge,
        chapter: project.chapters.find((chapter) => chapter.id === id) ?? null,
        chapterOrder: project.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          status: chapter.status,
          generationMode: chapter.generationMode,
          placement: chapter.placement,
          outline: chapter.outline,
          scenes: chapter.scenes,
          wordCount: chapter.wordCount,
        })),
      },
    }
  }
  if (section === 'outline') {
    return {
      revision: payload.revision,
      project: {
        title: project.title,
        genre: project.genre,
        premise: project.premise,
        targetWords: project.targetWords,
        styleGuide: project.styleGuide,
        masterOutline: project.masterOutline,
        meta: project.meta,
        volumes: project.volumes,
        characters: project.characters,
        knowledge: project.knowledge,
        chapters: project.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          status: chapter.status,
          generationMode: chapter.generationMode,
          placement: chapter.placement,
          outline: chapter.outline,
          scenes: chapter.scenes,
          notes: chapter.notes,
          wordCount: chapter.wordCount,
        })),
      },
    }
  }
  return {
    revision: payload.revision,
    stats: payload.stats,
    project: {
      title: project.title,
      genre: project.genre,
      premise: project.premise,
      targetWords: project.targetWords,
      styleGuide: project.styleGuide,
      meta: project.meta,
      volumes: project.volumes,
      masterOutline: project.masterOutline,
      characters: project.characters,
      knowledge: project.knowledge,
      chapters: project.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        status: chapter.status,
        generationMode: chapter.generationMode,
        placement: chapter.placement,
        outline: chapter.outline,
        scenes: chapter.scenes,
        notes: chapter.notes,
        wordCount: chapter.wordCount,
      })),
    },
  }
}

export function apply(ctx, config) {
  const directory = validateProjectDirectory(config.projectDirectory)
  const repositories = new Map()

  function repositoryForCwd(cwd) {
    const root = projectRoot(cwd, directory)
    let repository = repositories.get(root)
    if (repository === undefined) {
      repository = new NovelRepository(root, { historyLimit: config.historyLimit })
      repositories.set(root, repository)
    }
    return repository
  }

  function repositoryForExecution(exec) {
    const cwd = exec.agent?.session?.header?.cwd
    if (cwd === undefined) throw new Error('小说工具必须在带 workspace 的 DSH 会话中调用')
    return repositoryForCwd(cwd)
  }

  ctx.tools.register(defineNovelTool({
    name: 'novel_project_read',
    description: '读取当前 workspace 的结构化小说工程。小说右栏可供作者阅读、审阅和手动编辑，但不承载 AI 对话；作者可以按任意顺序修改全书提纲、章节提纲、人设、知识、场景或正文。处理任何变更前先调用本工具读取最新上下文；若返回 initialized=false，先调用 novel_project_write 的 init_project 操作初始化工程。若章节使用放置生成，生成细纲前必须以 section=generation 和章节 id 读取专用上下文包。',
    parameters: {
      section: {
        type: 'string',
        description: '读取范围：context（默认，全部创作上下文但省略正文）、outline（策划结构）、chapter（指定章节且含正文）、generation（指定章节的放置生成上下文）、all（完整工程）。',
      },
      id: {
        type: 'string',
        description: 'section=chapter 或 generation 时要读取的章节 id。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => toolText(value),
    },
    async execute(args, exec) {
      const payload = await repositoryForExecution(exec).read()
      if (payload.initialized === false) {
        const cwd = exec.agent?.session?.header?.cwd
        const kind = typeof cwd === 'string' ? await workspaceKind(resolve(cwd), false) : 'unknown'
        return JSON.stringify({
          initialized: false,
          workspaceKind: kind,
          message: kind === 'occupied'
            ? '当前 workspace 目录已用于其它用途（目录非空且不是小说工程），因此不会显示小说入口。如作者确实要在此目录写小说，先与其确认，再调用 init_project 显式初始化。'
            : kind === 'unknown'
              ? '无法确认当前 workspace 目录状态（目录不存在或不可读）。请让作者确认路径后再调用 init_project。'
              : '当前 workspace 尚未初始化小说工程。请先调用 novel_project_write（operation=init_project）创建工程结构，之后才能读取或写入内容。',
        }, null, 2)
      }
      const section = typeof args.section === 'string' ? args.section : 'context'
      const id = typeof args.id === 'string' ? args.id : ''
      return JSON.stringify(selectProjectContext(payload, section, id), null, 2)
    },
  }))

  ctx.tools.register(defineNovelTool({
    name: 'novel_project_write',
    description: '执行作者在原生对话区提出的 AI 小说操作，并自动生成可恢复版本。所有操作彼此没有前置顺序：正文存在时仍可修改全书提纲、章节提纲、人设、知识、场景、放置布置、正文或分卷结构，且不得因修改某一层而覆盖未指定的其它内容。分卷通过 upsert_volume（title 为卷名，metadataJson.chapterIds 指定归属章节与顺序）与 delete_volume 维护，未出现在任何卷的章节视为未分卷。若当前 workspace 尚未初始化（novel_project_read 返回 initialized=false），先调用 init_project 创建工程结构。放置模式应先用 novel_project_read 的 generation 范围取得人物卡、世界知识与前文，再生成细纲。右侧栏的输入框只用于作者直接编辑数据，不是 AI 对话入口；AI 完成变更后必须用本工具持久化。修改已有条目时复用该条目的 id 做精准更新，例如作者说“完善某某人物”时应先用 novel_project_read 找到该人物 id，再以 upsert_character 传回原 id 与更新后的内容。写入完成后，请在最终回复中只向作者反馈本次修改总结：修改了哪些人物/章节/知识、版本号与字数变化；不要复述或展示被修改的具体内容或全文。',
    parameters: {
      operation: {
        type: 'string',
        required: true,
        description: '操作：init_project（初始化当前 workspace 的小说工程结构，无需其它参数）、set_meta、set_outline、upsert_volume、delete_volume、upsert_character、upsert_knowledge、set_chapter_placement、upsert_chapter_outline、set_chapter_content、append_chapter_content、delete_character、delete_knowledge、delete_chapter、restore_revision。',
      },
      id: {
        type: 'string',
        description: '目标条目的稳定 id。更新/追加正文时传章节 id；restore_revision 时传版本 id；新条目可省略并自动生成。',
      },
      title: {
        type: 'string',
        description: '人物名、知识标题或章节标题。',
      },
      content: {
        type: 'string',
        description: '全书提纲、人物档案、知识内容、放置模式的场景描述、章节提纲或正文。',
      },
      metadataJson: {
        type: 'string',
        description: '附加 JSON 对象字符串。set_meta 可含 title/genre/premise/targetWords/styleGuide/author/description/tags(字符串数组)/status(ongoing|finished|paused)；人物可含 name/role/arc；知识可含 category；upsert_volume 可含 chapterIds（本章节 id 数组，移动章节到某卷或调整顺序）；set_chapter_placement 可含 characterIds/requirements；章节提纲可含 status/notes/scenes；正文可含 status/notes。status 只在作者明确要求改变时传入。',
      },
      message: {
        type: 'string',
        description: '简洁版本说明，例如“补全第一章雨夜追逐场景”。',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => toolText(renderWriteResult(value)),
    },
    async execute(args, exec) {
      const repository = repositoryForExecution(exec)
      if (args.operation === 'init_project') {
        const payload = await repository.initialize()
        return JSON.stringify({
          ok: true,
          revision: payload.revision,
          changes: { sections: ['project'], wordDelta: payload.stats?.words ?? 0, names: {} },
          message: `已初始化小说工程并创建初始版本 ${payload.revision}`,
        }, null, 2)
      }
      if (args.operation === 'restore_revision' && (typeof args.id !== 'string' || args.id.trim() === '')) {
        throw new Error('restore_revision 需要版本 id')
      }
      const before = await repository.read()
      const payload = args.operation === 'restore_revision'
        ? await repository.restore(args.id.trim())
        : await repository.applyOperation(args.operation, args)
      const createdVersion = before.revision !== payload.revision
      return JSON.stringify({
        ok: true,
        revision: payload.revision,
        changes: createdVersion ? summarizeWriteResult(payload) : { sections: [], wordDelta: 0, names: {} },
        message: createdVersion
          ? `已写入小说工程并创建版本 ${payload.revision}`
          : `修改与当前版本一致，未创建新版本（当前版本 ${payload.revision}）`,
      }, null, 2)
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (!isLoopback(req.socket.remoteAddress)) {
        json(res, 403, { ok: false, error: '仅允许本机访问' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'Method not allowed' })
        return
      }
      try {
        const url = new URL(req.url ?? ROUTE, 'http://dsh.local')
        const sessionId = url.searchParams.get('sessionId')
        if (!sessionId) throw new Error('缺少 sessionId')
        const agent = ctx.agents.get(sessionId)
        if (agent === undefined) throw new Error('当前 DSH 会话不存在或尚未连接')
        const cwd = agent.session.header.cwd
        const repository = repositoryForCwd(cwd)
        if (req.method === 'GET') {
          const state = await repository.read()
          const kind = await workspaceKind(resolve(cwd), state.initialized === true)
          json(res, 200, { ok: true, workspaceKind: kind, ...state })
          return
        }
        const input = await bodyJson(req)
        if (input.action === 'initialize') {
          const result = await repository.initialize()
          json(res, 200, { ok: true, ...result })
          return
        }
        if (input.action === 'save') {
          const result = await repository.save(input.project, {
            baseRevision: input.baseRevision,
            message: input.message,
            source: 'human',
          })
          json(res, 200, { ok: true, ...result })
          return
        }
        if (input.action === 'restore') {
          const result = await repository.restore(input.revisionId)
          json(res, 200, { ok: true, ...result })
          return
        }
        throw new Error(`不支持的操作：${String(input.action)}`)
      } catch (error) {
        const status = error instanceof RevisionConflictError ? 409 : 400
        json(res, status, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }), 'novel-studio: workspace project API')
}
