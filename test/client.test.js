import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const clientPath = new URL('../lib/client.js', import.meta.url)

test('right sidebar supports manual editing without duplicating AI conversation', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /h\('input'/)
  assert.match(source, /h\('textarea'/)
  assert.match(source, /method:\s*'POST'/)
  assert.match(source, /saveDraft/)
  assert.doesNotMatch(source, /sendPrompt|runAI|buildPrompt|AI 写作台|生成下一场|继续写|重写润色/)
  assert.match(source, /手动编辑 · 无 AI 对话/)
  assert.match(source, /可在 DSH 主对话区随时修改任意层级的内容/)
  assert.doesNotMatch(source, /WorkflowRail|novel-workflow|当前阶段|完整大纲[\s\S]*章节小纲[\s\S]*正文细节/)
  assert.match(source, /function buildVersionForest\(history\)/)
  assert.match(source, /novel-version-tree/)
  assert.match(source, /node\.children\.length > 1/)
  assert.match(source, /revision\.parent/)
  assert.doesNotMatch(source, /novel-timeline|novel-revision-dot/)
  assert.match(source, /novel-chapters-workspace/)
  assert.match(source, /novel-chapter-directory/)
  assert.match(source, /'aria-label': '章节目录'/)
  assert.doesNotMatch(source, /'aria-label': '章节与场景目录'|onSelectScene|selectedSceneId/)
  assert.match(source, /\.novel-chapter-directory\{flex:none;display:flex;gap:4px;padding:6px;overflow-x:auto;overflow-y:hidden/)
  assert.match(source, /\.novel-chapters-workspace\{display:flex;flex-direction:column\}/)
  assert.match(source, /function PlacementComposer\(props\)/)
  assert.match(source, /'aria-label': '章节生成方式'/)
  assert.match(source, /提纲生成/)
  assert.match(source, /放置生成/)
  assert.match(source, /sceneDescription/)
  assert.match(source, /togglePlacementCharacter/)
  assert.match(source, /自动结合人物卡、世界知识和前文生成细纲/)
})

test('uninitialized workspace shows only an initialize button and auto-loads afterwards', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /function InitPanel\(props\)/)
  assert.match(source, /current workspace|novel-init/)
  assert.match(source, /初始化小说工程/)
  assert.match(source, /model\.data\.initialized === false/)
  assert.match(source, /action: 'initialize'/)
  assert.match(source, /initialize: initialize/)
  assert.match(source, /一个工作区对应一部小说/)
})

test('blank sessions get a novel entry because the session header is hidden', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /conversation\.input\.dock/)
  assert.match(source, /function DockNovelEntry\(props\)/)
  assert.match(source, /session\.blank !== true/)
  assert.match(source, /dsh-novel-studio-dock/)
  assert.match(source, /当前工作区小说/)
})

test('blank sessions open the novel panel in a shell overlay because details is locked', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /shell\.overlay/)
  assert.match(source, /function OverlayNovelPanel\(\)/)
  assert.match(source, /openNovelOverlay\(session\.id\)/)
  assert.match(source, /closeNovelOverlay/)
  assert.match(source, /novel-overlay/)
  assert.match(source, /overlayNovelListeners/)
})

test('metadata and volume structure are editable and grouped in the directory', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /function VolumeHead\(props\)/)
  assert.match(source, /novel-volume-head/)
  assert.match(source, /连载状态/)
  assert.match(source, /NOVEL_STATUS_LABELS/)
  assert.match(source, /moveChapterToVolume/)
  assert.match(source, /directoryGroups/)
  assert.match(source, /未分卷/)
  assert.match(source, /addVolume/)
  assert.match(source, /作者/)
  assert.match(source, /updateTags/)
})

test('reader tab toggles between prose and the chapter outline', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /novel-view-switch/)
  assert.match(source, /切换正文与细纲/)
  assert.match(source, /onSwitchView\('prose'\)/)
  assert.match(source, /onSwitchView\('outline'\)/)
  assert.match(source, /novel-outline-note/)
  assert.match(source, /一个章节只对应一份细纲/)
  assert.match(source, /var _readerView = React\.useState\('prose'\)/)
  assert.match(source, /outlineView/)
})

test('novel entry hides itself unless the backend confirms an empty or novel workspace', async () => {
  const source = await readFile(clientPath, 'utf8')

  assert.match(source, /function useWorkspaceEntry\(sessionId\)/)
  assert.match(source, /var next = kind === 'empty' \|\| kind === 'novel'/)
  assert.match(source, /setVisible\(next\)/)
  // 请求失败必须隐藏，且不得回退为显示。
  assert.match(source, /\.catch\(function \(\) \{\s*if \(!active\) return\s*setVisible\(false\)/)
  assert.doesNotMatch(source, /setVisible\(true\)/)
  // 切换工作区时先清空上一个会话的判定结果。
  assert.match(source, /setVisible\(false\)\s*check\(\)/)
  assert.match(source, /function HeaderEntry\(props\)/)
  assert.match(source, /slotSessionId/)
  assert.doesNotMatch(source, /\}, HeaderButton\)/)
})

test('the panel docks through the official right-Sidebar tab system', async () => {
  const source = await readFile(clientPath, 'utf8')

  // 两阶段注册：类型进 sidebarRightTabs，主体进 keyed 的 sidebar.right.pane.tab。
  assert.match(source, /ctx\.get\('sidebarRightTabs'\)/)
  assert.match(source, /sidebarTabs\.register\(\{/)
  assert.match(source, /name: 'sidebar\.right\.pane\.tab'/)
  assert.match(source, /key: SIDEBAR_TAB_ID/)
  // 打开走官方 openTab，它会同一步展开栏目。
  assert.match(source, /ctx\.get\('sidebarRight'\)/)
  assert.match(source, /sidebar\.openTab\(SIDEBAR_TAB_KIND\)/)
  // 布局服务没有 openDetails/closeDetails；旧的 details 槽位也不存在。
  assert.doesNotMatch(source, /openDetails|closeDetails/)
  assert.doesNotMatch(source, /name: 'details'/)
  // shell.overlay 层是 click-through，浮层必须自己接管指针事件。
  assert.match(source, /\.novel-overlay\{[^}]*pointer-events:auto/)
})

test('version graph groups snapshots by parent and preserves visible branches', async () => {
  const source = await readFile(clientPath, 'utf8')
  const instrumented = source.replace(
    "module.exports = {\n      name:",
    "module.exports = {\n      buildVersionForest: buildVersionForest,\n      name:",
  )
  let definition = null
  runInNewContext(instrumented, {
    window: {
      __ModuleLoader__: {
        load(value) { definition = value },
      },
    },
  })
  const plugin = definition.factory(function () {
    return { createElement() {} }
  })
  const revision = (id, parent, createdAt) => ({ id, parent, createdAt, message: id })
  const forest = plugin.buildVersionForest([
    revision('branch-head', 'restore', '2026-01-06T00:00:00.000Z'),
    revision('restore', 'root', '2026-01-05T00:00:00.000Z'),
    revision('main-head', 'main', '2026-01-04T00:00:00.000Z'),
    revision('main', 'root', '2026-01-03T00:00:00.000Z'),
    revision('root', null, '2026-01-02T00:00:00.000Z'),
    revision('trimmed-child', 'missing-parent', '2026-01-01T00:00:00.000Z'),
  ])

  assert.deepEqual(Array.from(forest, (node) => node.revision.id), ['trimmed-child', 'root'])
  assert.equal(forest[0].truncated, true)
  assert.deepEqual(Array.from(forest[1].children, (node) => node.revision.id), ['main', 'restore'])
  assert.equal(forest[1].children[0].children[0].revision.id, 'main-head')
  assert.equal(forest[1].children[1].children[0].revision.id, 'branch-head')
})
