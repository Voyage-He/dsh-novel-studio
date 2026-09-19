// DSH 浏览器 bundle：右侧 details 提供阅读、审阅与结构化手动编辑。
// AI 创作只由原生对话区驱动；客户端不提供第二套对话或提示词入口。
window.__ModuleLoader__.load({
  id: 'dsh-novel-studio',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    var API_PATH = '/plugins/novel-studio/project'
    var TABS = [
      ['reader', '正文'],
      ['outline', '提纲'],
      ['characters', '人物'],
      ['knowledge', '知识'],
      ['history', '版本']
    ]
    var STATUS_LABELS = {
      planned: '待规划',
      outlined: '提纲已整理',
      draft: '草稿',
      revised: '已修订',
      final: '定稿'
    }
    var NOVEL_STATUS_LABELS = {
      ongoing: '连载中',
      finished: '已完结',
      paused: '暂停'
    }

    // 非 blank 会话用官方右侧栏 tab 承载小说面板；blank 会话（新工作区）的
    // 右侧栏被布局锁定为放不下，因此入口改走 shell.overlay 浮层。
    var overlayNovel = { open: false, sessionId: undefined }
    var overlayNovelListeners = new Set()

    function openNovelOverlay(sessionId) {
      overlayNovel.sessionId = sessionId
      overlayNovel.open = true
      overlayNovelListeners.forEach(function (listener) { listener() })
    }

    function closeNovelOverlay() {
      overlayNovel.open = false
      overlayNovelListeners.forEach(function (listener) { listener() })
    }

    function useOverlayNovel() {
      var state = React.useState(overlayNovel.open)
      var open = state[0]
      var setOpen = state[1]
      React.useEffect(function () {
        var listener = function () { setOpen(overlayNovel.open) }
        overlayNovelListeners.add(listener)
        setOpen(overlayNovel.open)
        return function () { overlayNovelListeners.delete(listener) }
      }, [])
      return open
    }

    function deepClone(value) {
      return JSON.parse(JSON.stringify(value))
    }

    function makeId(prefix) {
      return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
    }

    function countWords(value) {
      var source = String(value || '').trim()
      if (source === '') return 0
      var cjk = source.match(/[\u3400-\u9fff]/g)
      var latin = source.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)
      return (cjk ? cjk.length : 0) + (latin ? latin.length : 0)
    }

    async function projectRequest(sessionId, input) {
      var options = input === undefined
        ? { method: 'GET', headers: { accept: 'application/json' } }
        : {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(input)
          }
      var response = await fetch(API_PATH + '?sessionId=' + encodeURIComponent(sessionId), options)
      var payload = await response.json().catch(function () { return null })
      if (!response.ok || !payload || payload.ok !== true) {
        throw new Error(payload && payload.error ? payload.error : '小说项目请求失败（HTTP ' + response.status + '）')
      }
      return payload
    }

    function useNovelProject(sessionId) {
      var _data = React.useState(null)
      var data = _data[0]
      var setData = _data[1]
      var _error = React.useState('')
      var error = _error[0]
      var setError = _error[1]
      var _busy = React.useState(false)
      var busy = _busy[0]
      var setBusy = _busy[1]

      var load = React.useCallback(async function (quiet) {
        try {
          var next = await projectRequest(sessionId)
          setData(function (previous) {
            return previous && previous.revision === next.revision ? previous : next
          })
          setError('')
          return next
        } catch (cause) {
          if (!quiet) setError(cause instanceof Error ? cause.message : String(cause))
          throw cause
        }
      }, [sessionId])

      React.useEffect(function () {
        var active = true
        load(false).catch(function () {})
        var timer = window.setInterval(function () {
          if (active && document.visibilityState !== 'hidden') load(true).catch(function () {})
        }, 1600)
        return function () {
          active = false
          window.clearInterval(timer)
        }
      }, [load])

      var save = React.useCallback(async function (project, baseRevision, message) {
        setBusy(true)
        setError('')
        try {
          var next = await projectRequest(sessionId, {
            action: 'save',
            project: project,
            baseRevision: baseRevision,
            message: message
          })
          setData(next)
          return next
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          throw cause
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      var restore = React.useCallback(async function (revisionId) {
        setBusy(true)
        setError('')
        try {
          var next = await projectRequest(sessionId, { action: 'restore', revisionId: revisionId })
          setData(next)
          return next
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          throw cause
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      var initialize = React.useCallback(async function () {
        setBusy(true)
        setError('')
        try {
          var next = await projectRequest(sessionId, { action: 'initialize' })
          setData(next)
          return next
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
          throw cause
        } finally {
          setBusy(false)
        }
      }, [sessionId])

      return { data: data, error: error, busy: busy, save: save, restore: restore, initialize: initialize }
    }

    function BookIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 17, height: 17, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H11a3 3 0 0 1 3 3v15a3 3 0 0 0-3-3H6.5A2.5 2.5 0 0 0 4 20.5z' }),
        h('path', { d: 'M20 5.5A2.5 2.5 0 0 0 17.5 3H14v18a3 3 0 0 1 3-3h.5a2.5 2.5 0 0 1 2.5 2.5z' })
      )
    }

    function CloseIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', 'aria-hidden': true },
        h('path', { d: 'm6 6 12 12M18 6 6 18' })
      )
    }

    function Button(props) {
      var className = 'novel-btn' + (props.primary ? ' novel-btn-primary' : '') + (props.danger ? ' novel-btn-danger' : '') + (props.small ? ' novel-btn-small' : '')
      return h('button', {
        type: 'button',
        className: className,
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title
      }, props.children)
    }

    function Field(props) {
      return h('label', { className: 'novel-field' },
        h('span', { className: 'novel-field-label' }, props.label),
        props.multiline
          ? h('textarea', {
              className: 'novel-textarea' + (props.large ? ' novel-textarea-large' : ''),
              value: props.value || '',
              rows: props.rows || 4,
              onChange: function (event) { props.onChange(event.target.value) }
            })
          : h('input', {
              className: 'novel-input',
              value: props.value === undefined ? '' : props.value,
              type: props.type || 'text',
              onChange: function (event) { props.onChange(props.type === 'number' ? Number(event.target.value) : event.target.value) }
            })
      )
    }

    function EmptyState(props) {
      return h('div', { className: 'novel-empty' },
        h('div', { className: 'novel-empty-icon' }, props.icon || '◇'),
        h('strong', null, props.title),
        h('p', null, props.children)
      )
    }

    function VolumeHead(props) {
      if (props.editing) {
        return h('div', { className: 'novel-volume-head is-editing' },
          h('input', {
            className: 'novel-volume-input',
            value: props.volume.title,
            'aria-label': '卷标题',
            onChange: function (event) { props.onRename(props.volume.id, event.target.value) }
          }),
          h('span', { className: 'novel-volume-meta' }, props.volume.chapterIds.length + ' 章'),
          h(Button, { small: true, danger: true, onClick: props.onDelete }, '删')
        )
      }
      return h('div', { className: 'novel-volume-head' },
        h('b', null, props.volume.title),
        h('span', null, props.volume.chapterIds.length + ' 章')
      )
    }

    function HeaderButton(props) {
      return h('button', {
        type: 'button',
        className: 'novel-header-button',
        onClick: props.openNovel,
        title: '打开小说审阅区'
      }, h(BookIcon), h('span', null, '小说'))
    }

    // 小说入口只在后端明确确认“空目录工作区（empty）”或
    // “已经是小说工程（novel）”时显示。加载中、请求失败、状态未知
    // （unknown）以及已被其它用途占用的目录（occupied）一律隐藏，
    // 避免在任何非小说目录里注入小说面板入口。
    function useWorkspaceEntry(sessionId) {
      var state = React.useState(false)
      var visible = state[0]
      var setVisible = state[1]
      React.useEffect(function () {
        if (!sessionId) {
          setVisible(false)
          return
        }
        var active = true
        var timer = null
        function stop() {
          if (timer !== null) {
            window.clearInterval(timer)
            timer = null
          }
        }
        function check() {
          fetch(API_PATH + '?sessionId=' + encodeURIComponent(sessionId), { headers: { accept: 'application/json' } })
            .then(function (response) { return response.json() })
            .then(function (payload) {
              if (!active) return
              var kind = payload && payload.ok === true ? payload.workspaceKind : undefined
              var next = kind === 'empty' || kind === 'novel'
              setVisible(next)
              // 确认已是小说工程后无需继续轮询；否则继续低频重查，
              // 以便作者在别处初始化后入口自动出现。
              if (next && kind === 'novel') stop()
            })
            .catch(function () {
              if (!active) return
              setVisible(false)
            })
        }
        function poll() {
          if (active && document.visibilityState !== 'hidden') check()
        }
        // 切换工作区时先清空旧状态，避免上一个会话的判定结果残留。
        setVisible(false)
        check()
        timer = window.setInterval(poll, 8000)
        return function () {
          active = false
          stop()
        }
      }, [sessionId])
      return visible
    }

    function HeaderEntry(props) {
      var visible = useWorkspaceEntry(props.sessionId || props.slotSessionId)
      if (!visible) return null
      return h(HeaderButton, { openNovel: props.openNovel })
    }

    // blank 会话（新工作区/空目录）时会话 header 会被 DSH 整体隐藏，
    // 因此在 composer 上方的常驻 dock 行提供第二个入口；活跃会话
    // (session.blank === false) 由 header 按钮承担，这里返回 null 避免重复。
    // 空白会话的 details 列被 DSH 布局锁定为 0，按钮改开 overlay 浮层。
    function DockNovelEntry(props) {
      var session = props.session
      var visible = useWorkspaceEntry(session ? session.id : undefined)
      if (session === undefined || session.blank !== true) return null
      if (!visible) return null
      return h('div', { className: 'novel-dock-row' },
        h(HeaderButton, {
          openNovel: function () { openNovelOverlay(session.id) }
        }),
        h('span', { className: 'novel-dock-hint' }, '当前工作区小说，可随时初始化或审阅')
      )
    }

    function ReaderParagraphs(props) {
      var source = String(props.content || '').trim()
      if (source === '') return h(EmptyState, { title: '正文还没有落笔', icon: '〆' }, '可以在主对话区直接让 AI 写任意章节或场景，也可以进入编辑模式手动填写。')
      var blocks = source.split(/\n\s*\n/)
      return h('article', { className: 'novel-reader-paper' }, blocks.map(function (block, index) {
        var value = block.trim()
        if (/^#{1,3}\s+/.test(value)) return h('h3', { key: index }, value.replace(/^#{1,3}\s+/, ''))
        return h('p', { key: index }, value)
      }))
    }

    function ReadOnlyValue(props) {
      var value = String(props.value || '').trim()
      return h('div', { className: 'novel-readonly-value' + (props.wide ? ' is-wide' : '') },
        h('span', null, props.label),
        value ? h('div', { className: props.prose ? 'novel-prose-note' : '' }, value) : h('em', null, '尚未设定')
      )
    }

    function ReaderTab(props) {
      var project = props.project
      var chapter = props.chapter
      if (!chapter) return h(EmptyState, { title: '还没有章节', icon: 'Ⅰ' }, '可以在主对话区直接创建任意章节，或进入编辑模式手动添加。')

      var chapterIndex = project.chapters.findIndex(function (item) { return item.id === chapter.id })
      var total = project.chapters.reduce(function (sum, item) { return sum + countWords(item.content) }, 0)
      var progress = project.targetWords > 0 ? Math.min(100, Math.round(total / project.targetWords * 100)) : 0
      var outlineView = props.view === 'outline'
      return h('div', { className: 'novel-reader' },
        h('div', { className: 'novel-reader-toolbar' },
          h('button', { type: 'button', className: 'novel-nav-button', disabled: chapterIndex <= 0, onClick: function () { props.onSelectChapter(project.chapters[chapterIndex - 1].id) }, 'aria-label': '上一章' }, '‹'),
          h('span', { className: 'novel-chapter-position' }, '第 ' + (chapterIndex + 1) + ' / ' + project.chapters.length + ' 章'),
          h('span', { className: 'novel-status' }, STATUS_LABELS[chapter.status] || chapter.status),
          h('button', { type: 'button', className: 'novel-nav-button', disabled: chapterIndex >= project.chapters.length - 1, onClick: function () { props.onSelectChapter(project.chapters[chapterIndex + 1].id) }, 'aria-label': '下一章' }, '›')
        ),
        h('div', { className: 'novel-view-switch', 'aria-label': '切换正文与细纲' },
          h('button', { type: 'button', className: !outlineView ? 'is-active' : '', onClick: function () { props.onSwitchView('prose') } }, '正文'),
          h('button', { type: 'button', className: outlineView ? 'is-active' : '', onClick: function () { props.onSwitchView('outline') } }, '细纲')
        ),
        h('div', { className: 'novel-progress-row' },
          h('span', null, total.toLocaleString() + ' / ' + project.targetWords.toLocaleString() + ' 字'),
          h('div', { className: 'novel-progress' }, h('i', { style: { width: progress + '%' } })),
          h('b', null, progress + '%')
        ),
        h('div', { className: 'novel-reader-heading' },
          h('span', null, project.title),
          h('h2', null, chapter.title),
          h('small', null, (outlineView ? countWords(chapter.outline).toLocaleString() + ' 字细纲' : countWords(chapter.content).toLocaleString() + ' 字') + ' · ' + chapter.scenes.length + ' 个场景节拍')
        ),
        outlineView
          ? h('div', { className: 'novel-outline-pane' },
              props.editing
                ? h('div', { className: 'novel-edit-stack' },
                    h(Field, { label: '章节细纲', value: chapter.outline, multiline: true, large: true, rows: 14, onChange: function (value) { props.updateChapter('outline', value) } }),
                    chapter.generationMode === 'placement' ? h('div', { className: 'novel-placement-note' }, '本章使用放置生成：场景描述与放置人物见“提纲”页；此处编辑或由 AI 生成的细纲。') : null,
                    h('div', { className: 'novel-scenes-heading' },
                      h('b', null, '场景节拍'),
                      h(Button, { small: true, onClick: props.addScene }, '＋ 场景')
                    ),
                    chapter.scenes.length === 0 ? h('p', { className: 'novel-muted' }, '本章尚未拆分场景。') : null,
                    chapter.scenes.map(function (scene, index) {
                      return h(SceneCard, {
                        key: scene.id,
                        scene: scene,
                        index: index,
                        editing: true,
                        onChange: function (next) { props.updateScene(index, next) },
                        onDelete: function () { props.deleteScene(index) }
                      })
                    })
                  )
                : h('div', { className: 'novel-outline-read' },
                    chapter.outline.trim()
                      ? h('div', { className: 'novel-prose-note novel-outline-note' }, chapter.outline)
                      : h(EmptyState, { title: '本章细纲还没有落笔', icon: '✓' }, '在编辑模式或主对话区让 AI 生成细纲；一个章节只对应一份细纲。'),
                    h('div', { className: 'novel-scenes-heading' }, h('b', null, '场景节拍'), h('span', null, chapter.scenes.length + ' 个')),
                    chapter.scenes.length === 0 ? h('p', { className: 'novel-muted' }, '细纲里可以继续拆分具体场景。') : null,
                    chapter.scenes.map(function (scene, index) {
                      return h(SceneCard, { key: scene.id, scene: scene, index: index, editing: false })
                    })
                  )
            )
          : props.editing
            ? h('div', { className: 'novel-edit-stack' },
                h(Field, { label: '章节标题', value: chapter.title, onChange: function (value) { props.updateChapter('title', value) } }),
                h(Field, { label: '正文', value: chapter.content, multiline: true, large: true, rows: 22, onChange: function (value) { props.updateChapter('content', value) } })
              )
            : h(ReaderParagraphs, { content: chapter.content })
      )
    }

    function SceneCard(props) {
      var scene = props.scene
      function set(field, value) {
        var next = Object.assign({}, scene)
        next[field] = value
        props.onChange(next)
      }
      if (props.editing) {
        return h('article', { className: 'novel-scene-card' },
          h('div', { className: 'novel-card-title-row' },
            h('b', null, '场景 ' + (props.index + 1)),
            h(Button, { small: true, danger: true, onClick: props.onDelete }, '删除')
          ),
          h(Field, { label: '标题', value: scene.title, onChange: function (value) { set('title', value) } }),
          h(Field, { label: '场景摘要', value: scene.summary, multiline: true, rows: 3, onChange: function (value) { set('summary', value) } }),
          h('div', { className: 'novel-fact-grid' },
            h(Field, { label: '视角', value: scene.pov, onChange: function (value) { set('pov', value) } }),
            h(Field, { label: '地点', value: scene.location, onChange: function (value) { set('location', value) } })
          ),
          h(Field, { label: '目标', value: scene.goal, onChange: function (value) { set('goal', value) } }),
          h(Field, { label: '冲突', value: scene.conflict, onChange: function (value) { set('conflict', value) } }),
          h(Field, { label: '结果 / 变化', value: scene.outcome, onChange: function (value) { set('outcome', value) } })
        )
      }
      return h('article', { className: 'novel-scene-card' },
        h('div', { className: 'novel-card-title-row' },
          h('b', null, String(props.index + 1).padStart(2, '0') + ' · ' + (scene.title || '未命名场景')),
          h('span', null, [scene.pov, scene.location].filter(Boolean).join(' · ') || '场景节拍')
        ),
        scene.summary ? h('p', { className: 'novel-scene-summary' }, scene.summary) : null,
        h('div', { className: 'novel-beat-grid' },
          h(ReadOnlyValue, { label: '目标', value: scene.goal }),
          h(ReadOnlyValue, { label: '冲突', value: scene.conflict }),
          h(ReadOnlyValue, { label: '结果 / 变化', value: scene.outcome, wide: true })
        )
      )
    }

    function PlacementComposer(props) {
      var chapter = props.chapter
      var placement = chapter.placement || { sceneDescription: '', characterIds: [], requirements: '' }
      var selectedIds = Array.isArray(placement.characterIds) ? placement.characterIds : []
      var selectedCharacters = props.characters.filter(function (character) { return selectedIds.indexOf(character.id) >= 0 })

      if (props.editing) {
        return h('div', { className: 'novel-placement-composer' },
          h('div', { className: 'novel-placement-intro' },
            h('b', null, '布置当前章节'),
            h('p', null, '描述想看到的场景并放入登场人物；AI 会自动结合人物卡、世界知识和前文生成细纲。')
          ),
          h(Field, { label: '场景描述', value: placement.sceneDescription, multiline: true, rows: 5, onChange: function (value) { props.updatePlacement('sceneDescription', value) } }),
          h(Field, { label: '额外要求（可选）', value: placement.requirements, multiline: true, rows: 3, onChange: function (value) { props.updatePlacement('requirements', value) } }),
          h('div', { className: 'novel-placement-field' },
            h('span', { className: 'novel-field-label' }, '放置人物'),
            props.characters.length === 0
              ? h('p', { className: 'novel-muted' }, '人物库还是空的，请先在“人物”页建立人物卡。')
              : h('div', { className: 'novel-placement-cast' }, props.characters.map(function (character) {
                  var selected = selectedIds.indexOf(character.id) >= 0
                  return h('button', {
                    type: 'button',
                    key: character.id,
                    className: 'novel-placement-character' + (selected ? ' is-placed' : ''),
                    'aria-pressed': selected,
                    onClick: function () { props.toggleCharacter(character.id) }
                  },
                    h('b', null, character.name.slice(0, 1) || '人'),
                    h('span', null, character.name),
                    h('small', null, character.role || '人物'),
                    h('em', null, selected ? '已放置' : '放置')
                  )
                }))
          ),
          h('div', { className: 'novel-placement-context' },
            h('span', null, selectedIds.length + ' 位人物'),
            h('span', null, props.knowledgeCount + ' 条世界知识'),
            h('span', null, props.previousCount + ' 章前文'),
            h('p', null, '保存布置后，在 DSH 主对话中说“根据《' + chapter.title + '》的当前布置生成细纲”；AI 会读取上述资料并把结果写回本章。')
          ),
          chapter.outline.trim() ? h(Field, { label: 'AI 已生成的细纲（可调整）', value: chapter.outline, multiline: true, rows: 7, onChange: props.updateOutline }) : null
        )
      }

      return h('div', { className: 'novel-placement-review' },
        h('div', { className: 'novel-card-title-row' }, h('b', null, '放置生成'), h('span', null, selectedCharacters.length + ' 位人物 · 自动读取知识与前文')),
        h(ReadOnlyValue, { label: '场景描述', value: placement.sceneDescription, prose: true, wide: true }),
        placement.requirements ? h(ReadOnlyValue, { label: '额外要求', value: placement.requirements, prose: true, wide: true }) : null,
        h('div', { className: 'novel-placed-cast' },
          h('span', null, '登场人物'),
          selectedCharacters.length
            ? selectedCharacters.map(function (character) { return h('b', { key: character.id }, character.name) })
            : h('em', null, '尚未放置人物')
        ),
        chapter.outline.trim()
          ? h(ReadOnlyValue, { label: 'AI 生成细纲', value: chapter.outline, prose: true, wide: true })
          : h('p', { className: 'novel-placement-ready' }, '布置已保存后，可在主对话中说“根据《' + chapter.title + '》的当前布置生成细纲”。')
      )
    }

    function OutlineTab(props) {
      var project = props.project
      var chapter = props.chapter
      var meta = project.meta || { author: '', description: '', tags: [], status: 'ongoing' }

      function volumeIdOf(chapterId) {
        var found = project.volumes.find(function (volume) { return volume.chapterIds.indexOf(chapterId) >= 0 })
        return found ? found.id : ''
      }

      var directoryGroups = (function () {
        var assigned = new Set()
        var groups = []
        project.volumes.forEach(function (volume) {
          var items = volume.chapterIds.map(function (id) {
            return project.chapters.find(function (item) { return item.id === id })
          }).filter(Boolean)
          items.forEach(function (item) { assigned.add(item.id) })
          groups.push({ volume: volume, items: items })
        })
        var loose = project.chapters.filter(function (item) { return !assigned.has(item.id) })
        if (loose.length > 0) groups.push({ volume: null, items: loose })
        return groups
      })()

      return h('div', { className: 'novel-review-page' },
        h('section', { className: 'novel-section' },
          h('div', { className: 'novel-section-title' }, h('div', null, h('h3', null, '作品定位'), h('span', null, '全书创作约束与元数据'))),
          props.editing
            ? h(React.Fragment, null,
                h('div', { className: 'novel-fact-grid' },
                  h(Field, { label: '书名', value: project.title, onChange: function (value) { props.updateProject('title', value) } }),
                  h(Field, { label: '题材', value: project.genre, onChange: function (value) { props.updateProject('genre', value) } })
                ),
                h('div', { className: 'novel-fact-grid' },
                  h(Field, { label: '作者', value: meta.author, onChange: function (value) { props.updateMeta('author', value) } }),
                  h('label', { className: 'novel-field' }, h('span', { className: 'novel-field-label' }, '连载状态'),
                    h('select', { className: 'novel-select', value: meta.status, onChange: function (event) { props.updateMeta('status', event.target.value) } },
                      Object.keys(NOVEL_STATUS_LABELS).map(function (key) { return h('option', { key: key, value: key }, NOVEL_STATUS_LABELS[key]) })
                    )
                  ),
                  h(Field, { label: '目标字数', type: 'number', value: project.targetWords, onChange: function (value) { props.updateProject('targetWords', value) } })
                ),
                h(Field, { label: '标签（逗号分隔）', value: (meta.tags || []).join(', '), onChange: function (value) { props.updateTags(value) } }),
                h(Field, { label: '简介', value: meta.description, multiline: true, rows: 3, onChange: function (value) { props.updateMeta('description', value) } }),
                h(Field, { label: '核心故事', value: project.premise, multiline: true, rows: 3, onChange: function (value) { props.updateProject('premise', value) } }),
                h(Field, { label: '文风准则', value: project.styleGuide, multiline: true, rows: 4, onChange: function (value) { props.updateProject('styleGuide', value) } })
              )
            : h('div', { className: 'novel-fact-grid' },
                h(ReadOnlyValue, { label: '书名', value: project.title }),
                h(ReadOnlyValue, { label: '题材', value: project.genre }),
                h(ReadOnlyValue, { label: '作者', value: meta.author }),
                h(ReadOnlyValue, { label: '连载状态', value: NOVEL_STATUS_LABELS[meta.status] || meta.status }),
                h(ReadOnlyValue, { label: '目标字数', value: project.targetWords ? project.targetWords.toLocaleString() + ' 字' : '' }),
                h(ReadOnlyValue, { label: '标签', value: (meta.tags || []).join(' · ') }),
                h(ReadOnlyValue, { label: '简介', value: meta.description, prose: true, wide: true }),
                h(ReadOnlyValue, { label: '核心故事', value: project.premise, prose: true, wide: true }),
                h(ReadOnlyValue, { label: '文风准则', value: project.styleGuide, prose: true, wide: true })
              )
        ),
        h('section', { className: 'novel-section' },
          h('div', { className: 'novel-section-title' }, h('div', null, h('h3', null, '全书提纲'), h('span', null, '可随时调整的全局构想与参考'))),
          props.editing
            ? h(Field, { label: '全书结构', value: project.masterOutline, multiline: true, large: true, rows: 14, onChange: function (value) { props.updateProject('masterOutline', value) } })
            : project.masterOutline.trim() ? h('div', { className: 'novel-prose-note novel-master-outline' }, project.masterOutline) : h(EmptyState, { title: '全书提纲尚未填写', icon: '⌁' }, '这不会阻止先写任何章节或细节；需要时再手动补充，或在主对话区让 AI 写入。')
        ),
        h('section', { className: 'novel-section novel-chapters-section' },
          h('div', { className: 'novel-section-title' },
            h('div', null, h('h3', null, '章节与场景'), h('span', null, project.chapters.length + ' 章 · ' + project.volumes.length + ' 卷')),
            props.editing ? h('div', { className: 'novel-section-actions' },
              h(Button, { small: true, onClick: props.addVolume }, '＋ 卷'),
              h(Button, { small: true, onClick: props.addChapter }, '＋ 新建章节')
            ) : null
          ),
          project.chapters.length === 0 ? h('p', { className: 'novel-muted' }, props.editing ? '点击“新建章节”手动添加。' : '尚无章节。可手动编辑或通过主对话区直接创建。') : null,
          project.chapters.length > 0 ? h('div', { className: 'novel-chapters-workspace' },
            h('nav', { className: 'novel-chapter-directory', 'aria-label': '章节目录' }, directoryGroups.map(function (group) {
              var groupKey = group.volume ? group.volume.id : 'unassigned'
              return h('div', { key: groupKey, className: 'novel-directory-group' },
                group.volume
                  ? h(VolumeHead, {
                      volume: group.volume,
                      editing: props.editing,
                      onRename: props.renameVolume,
                      onDelete: function () { props.deleteVolume(group.volume.id) }
                    })
                  : h('div', { className: 'novel-volume-head' }, h('b', null, '未分卷'), h('span', null, group.items.length + ' 章')),
                group.items.map(function (item) {
                  var index = project.chapters.findIndex(function (candidate) { return candidate.id === item.id })
                  var active = chapter && chapter.id === item.id
                  return h('div', { key: item.id, className: 'novel-directory-group is-chapter' + (active ? ' is-active' : '') },
                    h('button', {
                      type: 'button',
                      className: 'novel-chapter-row' + (active ? ' is-active' : ''),
                      onClick: function () { props.onSelectChapter(item.id) },
                      'aria-current': active ? 'page' : undefined
                    },
                      h('span', { className: 'novel-chapter-number' }, String(index + 1).padStart(2, '0')),
                      h('span', { className: 'novel-chapter-row-main' }, h('b', null, item.title), h('small', null, item.generationMode === 'placement' ? (item.placement.sceneDescription || '尚未布置场景') : (item.outline || '未填写章节提纲'))),
                      h('em', null, item.scenes.length + ' 场')
                    )
                  )
                })
              )
            })),
            chapter ? h('div', { className: 'novel-chapter-review' },
            h('div', { className: 'novel-card-title-row' },
              h('h3', null, chapter.title),
              props.editing ? h(Button, { small: true, danger: true, onClick: props.deleteChapter }, '删除章') : h('span', { className: 'novel-status' }, STATUS_LABELS[chapter.status] || chapter.status)
            ),
            h('div', { className: 'novel-generation-mode', 'aria-label': '章节生成方式' },
              h('span', null, '生成方式'),
              props.editing
                ? h('div', null,
                    h('button', { type: 'button', className: chapter.generationMode !== 'placement' ? 'is-active' : '', onClick: function () { props.updateChapter('generationMode', 'outline') } }, '提纲生成'),
                    h('button', { type: 'button', className: chapter.generationMode === 'placement' ? 'is-active' : '', onClick: function () { props.updateChapter('generationMode', 'placement') } }, '放置生成')
                  )
                : h('b', null, chapter.generationMode === 'placement' ? '放置生成' : '提纲生成')
            ),
            props.editing ? h(React.Fragment, null,
              h('div', { className: 'novel-fact-grid' },
                h(Field, { label: '章节标题', value: chapter.title, onChange: function (value) { props.updateChapter('title', value) } }),
                h('label', { className: 'novel-field' }, h('span', { className: 'novel-field-label' }, '状态'),
                  h('select', { className: 'novel-select', value: chapter.status, onChange: function (event) { props.updateChapter('status', event.target.value) } }, Object.keys(STATUS_LABELS).map(function (key) { return h('option', { key: key, value: key }, STATUS_LABELS[key]) }))
                ),
                h('label', { className: 'novel-field' }, h('span', { className: 'novel-field-label' }, '所属卷'),
                  h('select', { className: 'novel-select', value: volumeIdOf(chapter.id), onChange: function (event) { props.moveChapterToVolume(chapter.id, event.target.value === '' ? null : event.target.value) } },
                    h('option', { value: '' }, '未分卷'),
                    project.volumes.map(function (volume) { return h('option', { key: volume.id, value: volume.id }, volume.title) })
                  )
                )
              ),
              chapter.generationMode === 'placement'
                ? h(PlacementComposer, {
                    chapter: chapter,
                    characters: project.characters,
                    knowledgeCount: project.knowledge.length,
                    previousCount: Math.max(0, project.chapters.findIndex(function (item) { return item.id === chapter.id })),
                    editing: true,
                    updatePlacement: props.updatePlacement,
                    toggleCharacter: props.togglePlacementCharacter,
                    updateOutline: function (value) { props.updateChapter('outline', value) }
                  })
                : h(Field, { label: '章节提纲', value: chapter.outline, multiline: true, rows: 7, onChange: function (value) { props.updateChapter('outline', value) } }),
              h(Field, { label: '作者备注', value: chapter.notes, multiline: true, rows: 3, onChange: function (value) { props.updateChapter('notes', value) } })
            ) : h(React.Fragment, null,
              chapter.generationMode === 'placement'
                ? h(PlacementComposer, {
                    chapter: chapter,
                    characters: project.characters,
                    knowledgeCount: project.knowledge.length,
                    previousCount: Math.max(0, project.chapters.findIndex(function (item) { return item.id === chapter.id })),
                    editing: false
                  })
                : h(ReadOnlyValue, { label: '章节提纲', value: chapter.outline, prose: true, wide: true }),
              chapter.notes ? h(ReadOnlyValue, { label: '作者备注', value: chapter.notes, prose: true, wide: true }) : null
            ),
            h('div', { className: 'novel-scenes-heading' },
              h('b', null, '场景节拍'),
              props.editing ? h(Button, { small: true, onClick: props.addScene }, '＋ 场景') : h('span', null, chapter.scenes.length + ' 个')
            ),
            chapter.scenes.length === 0 ? h('p', { className: 'novel-muted' }, '本章尚未拆分场景。') : null,
            chapter.scenes.map(function (scene, index) {
              return h(SceneCard, {
                key: scene.id,
                scene: scene,
                index: index,
                editing: props.editing,
                onChange: function (next) { props.updateScene(index, next) },
                onDelete: function () { props.deleteScene(index) }
              })
            })
            ) : h(EmptyState, { title: '选择一个章节', icon: 'Ⅰ' }, '从左侧目录选择章节或场景。')
          ) : null
        )
      )
    }

    function CharactersTab(props) {
      var selected = props.selected
      return h('div', { className: 'novel-review-page' },
        h('div', { className: 'novel-section-title' },
          h('div', null, h('h3', null, '人物卡'), h('span', null, '欲望、秘密、关系与变化轨迹')),
          props.editing ? h(Button, { small: true, onClick: props.add }, '＋ 人物') : null
        ),
        props.items.length === 0 ? h(EmptyState, { title: '还没有人物卡', icon: '♙' }, props.editing ? '点击“＋ 人物”手动建立人物档案。' : '可进入编辑模式手动添加，或在主对话区随时让 AI 建立。') : null,
        h('div', { className: 'novel-pill-list' }, props.items.map(function (item) {
          return h('button', { type: 'button', key: item.id, className: 'novel-pill' + (selected && selected.id === item.id ? ' is-active' : ''), onClick: function () { props.onSelect(item.id) } },
            h('b', null, item.name.slice(0, 1) || '人'), h('span', null, item.name), item.role ? h('small', null, item.role) : null
          )
        })),
        selected ? h('section', { className: 'novel-section novel-profile-card' },
          props.editing
            ? h(React.Fragment, null,
                h('div', { className: 'novel-card-title-row' }, h('h3', null, selected.name), h(Button, { small: true, danger: true, onClick: props.remove }, '删除')),
                h('div', { className: 'novel-fact-grid' },
                  h(Field, { label: '姓名', value: selected.name, onChange: function (value) { props.update('name', value) } }),
                  h(Field, { label: '角色定位', value: selected.role, onChange: function (value) { props.update('role', value) } })
                ),
                h(Field, { label: '人物档案', value: selected.profile, multiline: true, large: true, rows: 12, onChange: function (value) { props.update('profile', value) } }),
                h(Field, { label: '人物弧线', value: selected.arc, multiline: true, rows: 6, onChange: function (value) { props.update('arc', value) } })
              )
            : h(React.Fragment, null,
                h('div', { className: 'novel-profile-heading' },
                  h('div', { className: 'novel-avatar' }, selected.name.slice(0, 1) || '人'),
                  h('div', null, h('h3', null, selected.name), h('span', null, selected.role || '角色定位未设定'))
                ),
                h(ReadOnlyValue, { label: '人物档案', value: selected.profile, prose: true, wide: true }),
                h(ReadOnlyValue, { label: '人物弧线', value: selected.arc, prose: true, wide: true })
              )
        ) : null
      )
    }

    function KnowledgeTab(props) {
      var selected = props.selected
      return h('div', { className: 'novel-review-page' },
        h('div', { className: 'novel-section-title' },
          h('div', null, h('h3', null, '特殊知识'), h('span', null, '世界规则、考据、术语与时间线')),
          props.editing ? h(Button, { small: true, onClick: props.add }, '＋ 条目') : null
        ),
        props.items.length === 0 ? h(EmptyState, { title: '知识库还是空的', icon: '⌘' }, props.editing ? '点击“＋ 条目”手动记录资料。' : '可进入编辑模式手动添加，或在主对话区告诉 AI 哪些事实不能出错。') : null,
        h('div', { className: 'novel-knowledge-list' }, props.items.map(function (item) {
          return h('button', { type: 'button', key: item.id, className: 'novel-knowledge-row' + (selected && selected.id === item.id ? ' is-active' : ''), onClick: function () { props.onSelect(item.id) } },
            h('span', null, item.category || '资料'), h('b', null, item.title)
          )
        })),
        selected ? h('section', { className: 'novel-section novel-knowledge-card' },
          props.editing
            ? h(React.Fragment, null,
                h('div', { className: 'novel-card-title-row' }, h('h3', null, selected.title), h(Button, { small: true, danger: true, onClick: props.remove }, '删除')),
                h('div', { className: 'novel-fact-grid' },
                  h(Field, { label: '标题', value: selected.title, onChange: function (value) { props.update('title', value) } }),
                  h(Field, { label: '分类', value: selected.category, onChange: function (value) { props.update('category', value) } })
                ),
                h(Field, { label: '知识内容', value: selected.content, multiline: true, large: true, rows: 16, onChange: function (value) { props.update('content', value) } })
              )
            : h(React.Fragment, null,
                h('div', { className: 'novel-card-title-row' }, h('h3', null, selected.title), h('span', { className: 'novel-category-badge' }, selected.category || '资料')),
                h('div', { className: 'novel-prose-note' }, selected.content || '尚未记录具体内容')
              )
        ) : null
      )
    }

    function buildVersionForest(history) {
      var nodes = new Map()
      history.forEach(function (revision) {
        if (!revision || typeof revision.id !== 'string' || nodes.has(revision.id)) return
        nodes.set(revision.id, { revision: revision, children: [], truncated: false })
      })
      var roots = []
      nodes.forEach(function (node) {
        var parent = typeof node.revision.parent === 'string' ? nodes.get(node.revision.parent) : null
        if (!parent || parent === node) {
          node.truncated = Boolean(node.revision.parent && !parent)
          roots.push(node)
          return
        }
        var cursor = parent
        var seen = new Set()
        while (cursor && !seen.has(cursor)) {
          if (cursor === node) {
            roots.push(node)
            return
          }
          seen.add(cursor)
          cursor = typeof cursor.revision.parent === 'string' ? nodes.get(cursor.revision.parent) : null
        }
        parent.children.push(node)
      })
      function compare(left, right) {
        var leftTime = Date.parse(left.revision.createdAt) || 0
        var rightTime = Date.parse(right.revision.createdAt) || 0
        return leftTime - rightTime || left.revision.id.localeCompare(right.revision.id)
      }
      nodes.forEach(function (node) { node.children.sort(compare) })
      roots.sort(compare)
      return roots
    }

    function VersionTreeNode(props) {
      var node = props.node
      var revision = node.revision
      var summary = revision.summary || {}
      var sections = Array.isArray(summary.sections) ? summary.sections.join('、') : ''
      var wordDelta = summary.wordDelta || 0
      var isHead = revision.id === props.head
      var source = revision.source === 'ai' ? 'AI' : revision.source === 'restore' ? '恢复操作' : revision.source === 'system' ? '系统' : '作者'
      return h('li', { className: 'novel-version-item' + (node.children.length ? ' has-children' : '') + (isHead ? ' is-head' : '') },
        h('div', { className: 'novel-version-row' },
          h('div', { className: 'novel-version-rail', 'aria-hidden': true },
            h('span', { className: 'novel-version-dot' }),
            node.children.length > 1 ? h('span', { className: 'novel-fork-count', title: node.children.length + ' 条分支' }, node.children.length) : null
          ),
          h('div', { className: 'novel-version-body' },
            h('div', { className: 'novel-card-title-row' },
              h('div', null,
                h('b', null, revision.message),
                h('span', { className: 'novel-version-identity' },
                  h('code', null, revision.id),
                  revision.parent ? h('small', null, '← ' + revision.parent.slice(0, 7)) : h('small', null, '根版本')
                )
              ),
              !isHead && props.editing
                ? h(Button, { small: true, disabled: props.busy, onClick: function () { props.onRestore(revision.id) } }, '恢复')
                : h('span', { className: isHead ? 'novel-head-badge' : node.truncated ? 'novel-root-badge' : 'novel-history-badge' }, isHead ? '当前' : node.truncated ? '截断起点' : '历史')
            ),
            h('p', null, sections ? '变更：' + sections : '记录项目状态', wordDelta ? ' · 字数 ' + (wordDelta > 0 ? '+' : '') + wordDelta : ''),
            h('small', null, new Date(revision.createdAt).toLocaleString() + ' · ' + source)
          )
        ),
        node.children.length
          ? h('ul', { className: 'novel-version-children ' + (node.children.length > 1 ? 'is-fork' : 'is-chain') }, node.children.map(function (child) {
              return h(VersionTreeNode, {
                key: child.revision.id,
                node: child,
                head: props.head,
                editing: props.editing,
                busy: props.busy,
                onRestore: props.onRestore
              })
            }))
          : null
      )
    }

    function HistoryTab(props) {
      var roots = buildVersionForest(props.history)
      return h('div', { className: 'novel-history-page' },
        h('div', { className: 'novel-section-title' }, h('div', null, h('h3', null, '版本树'), h('span', null, props.editing ? '选择任意节点恢复并创建新分支' : '连线表示父子版本，分叉表示不同创作方向'))),
        props.history.length === 0 ? h(EmptyState, { title: '暂无版本', icon: '↶' }, '首次保存或 AI 写入后，版本节点会显示在这里。') : null,
        roots.length ? h('div', { className: 'novel-version-tree-wrap' },
          h('ul', { className: 'novel-version-tree' }, roots.map(function (root) {
            return h(VersionTreeNode, {
              key: root.revision.id,
              node: root,
              head: props.head,
              editing: props.editing,
              busy: props.busy,
              onRestore: props.onRestore
            })
          }))
        ) : null
      )
    }

    function preferredChapter(project, selectedId) {
      var selected = project.chapters.find(function (item) { return item.id === selectedId })
      if (selected) return selected
      var written = project.chapters.filter(function (item) { return item.content.trim() !== '' })
      return written[written.length - 1] || project.chapters[0] || null
    }

    function InitPanel(props) {
      return h('aside', { className: 'novel-panel' },
        h('div', { className: 'novel-panel-header' },
          h('div', { className: 'novel-brand' }, h(BookIcon), h('div', null, h('b', null, '小说审阅区'), h('small', null, '未初始化'))),
          h('button', { className: 'novel-icon-btn', type: 'button', onClick: props.closeNovel, 'aria-label': '关闭' }, h(CloseIcon))
        ),
        h('div', { className: 'novel-init' },
          h('div', { className: 'novel-init-icon' }, h(BookIcon)),
          h('h3', null, '当前工作区还不是小说工作区'),
          h('p', null, '一个工作区对应一部小说。初始化会创建 novel/ 目录结构（project.json 与版本历史），之后的 AI 写入和右栏编辑都保存在这个文件夹里。'),
          h(Button, { primary: true, disabled: props.busy, onClick: props.onInitialize }, props.busy ? '初始化中…' : '初始化小说工程')
        ),
        props.error ? h('div', { className: 'novel-banner is-error' }, props.error) : null
      )
    }

    function NovelPanel(props) {
      var model = useNovelProject(props.sessionId)
      var _tab = React.useState('reader')
      var tab = _tab[0]
      var setTab = _tab[1]
      var _readerView = React.useState('prose')
      var readerView = _readerView[0]
      var setReaderView = _readerView[1]
      var _editing = React.useState(false)
      var editing = _editing[0]
      var setEditing = _editing[1]
      var _draft = React.useState(null)
      var draft = _draft[0]
      var setDraft = _draft[1]
      var _baseRevision = React.useState(null)
      var baseRevision = _baseRevision[0]
      var setBaseRevision = _baseRevision[1]
      var _dirty = React.useState(false)
      var dirty = _dirty[0]
      var setDirty = _dirty[1]
      var _selectedChapterId = React.useState('')
      var selectedChapterId = _selectedChapterId[0]
      var setSelectedChapterId = _selectedChapterId[1]
      var _selectedCharacterId = React.useState('')
      var selectedCharacterId = _selectedCharacterId[0]
      var setSelectedCharacterId = _selectedCharacterId[1]
      var _selectedKnowledgeId = React.useState('')
      var selectedKnowledgeId = _selectedKnowledgeId[0]
      var setSelectedKnowledgeId = _selectedKnowledgeId[1]
      var _notice = React.useState('')
      var notice = _notice[0]
      var setNotice = _notice[1]

      React.useEffect(function () {
        if (!model.data) return
        if (draft === null || !dirty) {
          setDraft(deepClone(model.data.project))
          setBaseRevision(model.data.revision)
          setDirty(false)
        }
      }, [model.data && model.data.revision])

      if (!props.sessionId) {
        return h('aside', { className: 'novel-panel' },
          h('div', { className: 'novel-panel-header' }, h('div', { className: 'novel-brand' }, h(BookIcon), h('b', null, '小说审阅区')), h('button', { className: 'novel-icon-btn', type: 'button', onClick: props.closeNovel, 'aria-label': '关闭' }, h(CloseIcon))),
          h('div', { className: 'novel-loading' }, h('p', null, '请先在左侧选择工作区并创建会话，再打开小说审阅区。'))
        )
      }

      if (!model.data) {
        return h('aside', { className: 'novel-panel' },
          h('div', { className: 'novel-panel-header' }, h('div', { className: 'novel-brand' }, h(BookIcon), h('b', null, '小说审阅区')), h('button', { className: 'novel-icon-btn', type: 'button', onClick: props.closeNovel, 'aria-label': '关闭' }, h(CloseIcon))),
          h('div', { className: 'novel-loading' }, h('i'), h('p', null, model.error || '正在读取当前 workspace 的小说工程…'))
        )
      }

      if (model.data.initialized === false) {
        return h(InitPanel, {
          closeNovel: props.closeNovel,
          busy: model.busy,
          error: model.error,
          onInitialize: function () { model.initialize().catch(function () {}) }
        })
      }

      if (!draft) {
        return h('aside', { className: 'novel-panel' },
          h('div', { className: 'novel-panel-header' }, h('div', { className: 'novel-brand' }, h(BookIcon), h('b', null, '小说审阅区')), h('button', { className: 'novel-icon-btn', type: 'button', onClick: props.closeNovel, 'aria-label': '关闭' }, h(CloseIcon))),
          h('div', { className: 'novel-loading' }, h('i'), h('p', null, model.error || '正在加载小说工程…'))
        )
      }

      var project = draft
      var chapter = preferredChapter(project, selectedChapterId)
      var character = project.characters.find(function (item) { return item.id === selectedCharacterId }) || project.characters[0] || null
      var knowledge = project.knowledge.find(function (item) { return item.id === selectedKnowledgeId }) || project.knowledge[0] || null
      var chapterIndex = chapter ? project.chapters.findIndex(function (item) { return item.id === chapter.id }) : -1
      var characterIndex = character ? project.characters.findIndex(function (item) { return item.id === character.id }) : -1
      var knowledgeIndex = knowledge ? project.knowledge.findIndex(function (item) { return item.id === knowledge.id }) : -1

      function change(mutator) {
        setDraft(function (current) {
          var next = deepClone(current)
          mutator(next)
          return next
        })
        setDirty(true)
      }

      function updateProject(field, value) {
        change(function (next) { next[field] = value })
      }

      function updateMeta(field, value) {
        change(function (next) {
          if (next.meta === undefined) next.meta = { author: '', description: '', tags: [], status: 'ongoing' }
          next.meta[field] = value
        })
      }

      function updateTags(value) {
        change(function (next) {
          if (next.meta === undefined) next.meta = { author: '', description: '', tags: [], status: 'ongoing' }
          next.meta.tags = String(value || '').split(/[,，;；]+/).map(function (item) { return item.trim() }).filter(Boolean)
        })
      }

      function updateChapter(field, value) {
        if (chapterIndex < 0) return
        change(function (next) { next.chapters[chapterIndex][field] = value })
      }

      function selectChapter(id) {
        setSelectedChapterId(id)
      }

      function volumeIndexIn(next, volumeId) {
        return next.volumes.findIndex(function (volume) { return volume.id === volumeId })
      }

      function addVolume() {
        change(function (next) {
          if (next.volumes === undefined) next.volumes = []
          next.volumes.push({ id: makeId('volume'), title: '卷 ' + (next.volumes.length + 1) + ' · ' + next.title, chapterIds: [] })
        })
      }

      function renameVolume(volumeId, title) {
        change(function (next) {
          var index = volumeIndexIn(next, volumeId)
          if (index >= 0) next.volumes[index].title = title
        })
      }

      function deleteVolume(volumeId) {
        var volume = project.volumes.find(function (item) { return item.id === volumeId })
        if (!volume) return
        if (!window.confirm('删除卷“' + volume.title + '”及其归属？其中的章节不会被删除，会回到“未分卷”。')) return
        change(function (next) { next.volumes = next.volumes.filter(function (item) { return item.id !== volumeId }) })
      }

      function moveChapterToVolume(chapterId, volumeId) {
        change(function (next) {
          if (next.volumes === undefined) next.volumes = []
          next.volumes = next.volumes.map(function (volume) {
            var without = volume.chapterIds.filter(function (id) { return id !== chapterId })
            if (volume.id === volumeId && without.indexOf(chapterId) < 0) without.push(chapterId)
            return Object.assign({}, volume, { chapterIds: without })
          })
        })
      }

      function addChapter() {
        var id = makeId('chapter')
        change(function (next) {
          next.chapters.push({ id: id, title: '第 ' + (next.chapters.length + 1) + ' 章', status: 'planned', generationMode: 'outline', placement: { sceneDescription: '', characterIds: [], requirements: '' }, outline: '', content: '', notes: '', scenes: [], wordCount: 0 })
        })
        setSelectedChapterId(id)
        setTab('outline')
      }

      function deleteChapter() {
        if (!chapter || !window.confirm('删除《' + chapter.title + '》？保存前可以取消编辑，保存后仍可从版本历史恢复。')) return
        var id = chapter.id
        change(function (next) { next.chapters = next.chapters.filter(function (item) { return item.id !== id }) })
        setSelectedChapterId('')
      }

      function addScene() {
        if (chapterIndex < 0) return
        change(function (next) {
          next.chapters[chapterIndex].scenes.push({ id: makeId('scene'), title: '场景 ' + (next.chapters[chapterIndex].scenes.length + 1), summary: '', pov: '', location: '', goal: '', conflict: '', outcome: '' })
        })
      }

      function cancelEditing() {
        if (dirty && !window.confirm('放弃本次未保存的手动修改？')) return
        setDraft(deepClone(model.data.project))
        setBaseRevision(model.data.revision)
        setDirty(false)
        setEditing(false)
        setNotice('')
      }

      async function saveDraft() {
        if (!dirty) {
          setEditing(false)
          return
        }
        try {
          var next = await model.save(draft, baseRevision, '作者手动编辑：' + draft.title)
          setDraft(deepClone(next.project))
          setBaseRevision(next.revision)
          setDirty(false)
          setEditing(false)
          setNotice('手动修改已保存为版本 ' + next.revision)
        } catch (_) {}
      }

      async function restoreRevision(id) {
        if (!window.confirm('恢复到版本 ' + id + '？恢复操作本身也会生成新版本。')) return
        try {
          var next = await model.restore(id)
          setDraft(deepClone(next.project))
          setBaseRevision(next.revision)
          setDirty(false)
          setEditing(false)
          setNotice('已恢复并生成新版本 ' + next.revision)
        } catch (_) {}
      }

      var remoteChanged = dirty && model.data.revision !== baseRevision
      var content = null
      if (tab === 'reader') {
        content = h(ReaderTab, {
          project: project,
          chapter: chapter,
          editing: editing,
          view: readerView,
          onSwitchView: setReaderView,
          updateChapter: updateChapter,
          onSelectChapter: selectChapter,
          addScene: addScene,
          updateScene: function (index, nextScene) { change(function (next) { next.chapters[chapterIndex].scenes[index] = nextScene }) },
          deleteScene: function (index) { change(function (next) { next.chapters[chapterIndex].scenes.splice(index, 1) }) }
        })
      } else if (tab === 'outline') {
        content = h(OutlineTab, {
          project: project,
          chapter: chapter,
          editing: editing,
          updateProject: updateProject,
          updateMeta: updateMeta,
          updateTags: updateTags,
          updateChapter: updateChapter,
          addChapter: addChapter,
          addVolume: addVolume,
          renameVolume: renameVolume,
          deleteVolume: deleteVolume,
          moveChapterToVolume: moveChapterToVolume,
          deleteChapter: deleteChapter,
          onSelectChapter: selectChapter,
          addScene: addScene,
          updatePlacement: function (field, value) {
            change(function (next) {
              var placement = next.chapters[chapterIndex].placement || { sceneDescription: '', characterIds: [], requirements: '' }
              placement[field] = value
              next.chapters[chapterIndex].placement = placement
            })
          },
          togglePlacementCharacter: function (characterId) {
            change(function (next) {
              var placement = next.chapters[chapterIndex].placement || { sceneDescription: '', characterIds: [], requirements: '' }
              var ids = Array.isArray(placement.characterIds) ? placement.characterIds.slice() : []
              var index = ids.indexOf(characterId)
              if (index >= 0) ids.splice(index, 1)
              else ids.push(characterId)
              placement.characterIds = ids
              next.chapters[chapterIndex].placement = placement
            })
          },
          updateScene: function (index, nextScene) { change(function (next) { next.chapters[chapterIndex].scenes[index] = nextScene }) },
          deleteScene: function (index) { change(function (next) { next.chapters[chapterIndex].scenes.splice(index, 1) }) }
        })
      } else if (tab === 'characters') {
        content = h(CharactersTab, {
          items: project.characters,
          selected: character,
          editing: editing,
          onSelect: setSelectedCharacterId,
          add: function () {
            var id = makeId('character')
            change(function (next) { next.characters.push({ id: id, name: '新人物', role: '', profile: '', arc: '' }) })
            setSelectedCharacterId(id)
          },
          update: function (field, value) { if (characterIndex >= 0) change(function (next) { next.characters[characterIndex][field] = value }) },
          remove: function () {
            if (character && window.confirm('删除人物“' + character.name + '”？')) {
              change(function (next) { next.characters.splice(characterIndex, 1) })
              setSelectedCharacterId('')
            }
          }
        })
      } else if (tab === 'knowledge') {
        content = h(KnowledgeTab, {
          items: project.knowledge,
          selected: knowledge,
          editing: editing,
          onSelect: setSelectedKnowledgeId,
          add: function () {
            var id = makeId('knowledge')
            change(function (next) { next.knowledge.push({ id: id, title: '新知识条目', category: '', content: '' }) })
            setSelectedKnowledgeId(id)
          },
          update: function (field, value) { if (knowledgeIndex >= 0) change(function (next) { next.knowledge[knowledgeIndex][field] = value }) },
          remove: function () {
            if (knowledge && window.confirm('删除知识“' + knowledge.title + '”？')) {
              change(function (next) { next.knowledge.splice(knowledgeIndex, 1) })
              setSelectedKnowledgeId('')
            }
          }
        })
      } else {
        content = h(HistoryTab, { history: model.data.history || [], head: model.data.revision, editing: editing, busy: model.busy, onRestore: restoreRevision })
      }

      return h('aside', { className: 'novel-panel' },
        h('div', { className: 'novel-panel-header' },
          h('div', { className: 'novel-brand' }, h(BookIcon), h('div', null, h('b', null, project.title), h('small', null, editing ? '手动编辑 · 无 AI 对话' : '阅读审阅 · 对话驱动'))),
          h('div', { className: 'novel-header-actions' },
            editing
              ? h(React.Fragment, null,
                  h(Button, { small: true, disabled: model.busy, onClick: cancelEditing }, '取消'),
                  h(Button, { small: true, primary: true, disabled: model.busy || remoteChanged, onClick: saveDraft }, model.busy ? '保存中…' : dirty ? '保存版本' : '完成')
                )
              : h(Button, { small: true, onClick: function () { setEditing(true); setNotice('') } }, '编辑'),
            h('button', { className: 'novel-icon-btn', type: 'button', title: '关闭', onClick: function () { if (!dirty || window.confirm('放弃未保存修改并关闭？')) props.closeNovel() }, 'aria-label': '关闭' }, h(CloseIcon))
          )
        ),
        h('nav', { className: 'novel-tabs', 'aria-label': '小说资料页' }, TABS.map(function (item) {
          return h('button', { type: 'button', key: item[0], className: tab === item[0] ? 'is-active' : '', onClick: function () { setTab(item[0]) } }, item[1])
        })),
        h('div', { className: 'novel-observer-note' }, h('span', null, editing ? '✎' : '◉'), h('p', null, editing ? '正在直接编辑小说数据；任何资料与正文都可随时修改，这里不提供 AI 对话。' : '右栏只用于阅读与审阅；可在 DSH 主对话区随时修改任意层级的内容。')),
        model.error ? h('div', { className: 'novel-banner is-error' }, model.error) : null,
        remoteChanged ? h('div', { className: 'novel-banner is-warn' }, '主对话中的 AI 已写入新版本。请取消本次编辑并重新修改，避免覆盖。') : null,
        notice ? h('button', { type: 'button', className: 'novel-banner is-notice', onClick: function () { setNotice('') } }, notice, h('span', null, '×')) : null,
        h('div', { className: 'novel-panel-scroll' }, content),
        h('footer', { className: 'novel-panel-footer' },
          h('span', null, project.chapters.reduce(function (sum, item) { return sum + countWords(item.content) }, 0).toLocaleString() + ' 字'),
          h('span', null, project.chapters.length + ' 章'),
          h('b', null, dirty ? '未保存' : '自动同步'),
          h('code', null, baseRevision)
        )
      )
    }

    // 空白会话的浮层载体：复用 NovelPanel，替换 close 行为并挂在
    // shell.overlay（frame 级浮层，仅空白会话时打开）。
    function OverlayNovelPanel() {
      var open = useOverlayNovel()
      if (!open) return null
      return h('div', { className: 'novel-overlay', role: 'region', 'aria-label': '小说审阅区' },
        h(NovelPanel, {
          sessionId: overlayNovel.sessionId,
          closeNovel: closeNovelOverlay
        })
      )
    }

    var CSS = `.novel-header-button{height:30px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer}.novel-header-button:hover{background:var(--dsw-alias-button-floating-hover)}
.novel-panel{box-sizing:border-box;height:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden}.novel-panel *{box-sizing:border-box}.novel-panel-header{height:58px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px 8px 15px;border-bottom:1px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 94%,transparent)}.novel-brand{display:flex;align-items:center;gap:9px;min-width:0}.novel-brand>svg{color:var(--dsw-alias-state-business-primary);flex:none}.novel-brand>div{display:flex;flex-direction:column;min-width:0}.novel-brand b{font-size:14px;line-height:18px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.novel-brand small{font-size:10px;color:var(--dsw-alias-label-tertiary);letter-spacing:.06em}.novel-header-actions{display:flex;align-items:center;gap:5px;flex:none}.novel-icon-btn,.novel-nav-button{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}.novel-icon-btn{width:30px;height:30px}.novel-nav-button{width:28px;height:28px;font:22px/1 Georgia,serif}.novel-icon-btn:hover,.novel-nav-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.novel-nav-button:disabled{opacity:.25;cursor:default}.novel-btn{min-height:30px;display:inline-flex;align-items:center;justify-content:center;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}.novel-btn:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover)}.novel-btn:disabled{opacity:.42;cursor:not-allowed}.novel-btn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}.novel-btn-danger{color:var(--dsw-alias-state-error-primary)}.novel-btn-small{min-height:26px;padding:3px 8px;font-size:11px}
.novel-tabs{height:40px;flex:none;display:flex;align-items:stretch;padding:0 8px;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto}.novel-tabs button{flex:1;min-width:52px;position:relative;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;cursor:pointer}.novel-tabs button:hover{color:var(--dsw-alias-label-primary)}.novel-tabs button.is-active{color:var(--dsw-alias-state-business-primary);font-weight:600}.novel-tabs button.is-active:after{content:"";position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}.novel-observer-note{flex:none;display:flex;gap:7px;margin:8px 10px 0;padding:7px 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,var(--dsw-alias-border-l1));border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary)}.novel-observer-note span{color:var(--dsw-alias-state-business-primary);font-size:9px;margin-top:3px}.novel-observer-note p{margin:0;font-size:10px;line-height:15px}.novel-panel-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}.novel-panel-footer{height:30px;flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:10px}.novel-panel-footer code{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.novel-panel-footer b{color:var(--dsw-alias-state-success-primary);font-weight:500}.novel-loading{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;color:var(--dsw-alias-label-secondary);padding:30px;text-align:center}.novel-loading i{width:24px;height:24px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;animation:novel-spin 1s linear infinite}@keyframes novel-spin{to{transform:rotate(360deg)}}.novel-banner{flex:none;margin:8px 10px 0;padding:8px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);font-size:11px;line-height:16px}.novel-banner.is-error{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,var(--dsw-alias-bg-layer-2))}.novel-banner.is-warn{color:var(--dsw-alias-state-warning-primary);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 8%,var(--dsw-alias-bg-layer-2))}.novel-banner.is-notice{display:flex;justify-content:space-between;text-align:left;width:calc(100% - 20px);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-2));cursor:pointer}
.novel-empty{min-height:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:25px;color:var(--dsw-alias-label-secondary)}.novel-empty-icon{font-family:Georgia,serif;font-size:30px;color:var(--dsw-alias-state-business-primary);opacity:.7;margin-bottom:6px}.novel-empty strong{font-family:Georgia,"Songti SC",serif;font-size:15px;color:var(--dsw-alias-label-primary)}.novel-empty p{max-width:280px;margin:6px 0;font-size:11px;line-height:1.7}.novel-muted{margin:4px 0;color:var(--dsw-alias-label-tertiary);font-size:11px}
.novel-reader{min-height:100%;padding-bottom:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-state-business-primary) 4%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1) 170px)}.novel-reader-toolbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:8px 12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 92%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--dsw-alias-border-l1)}.novel-chapter-position{flex:1;text-align:center;font-size:11px;color:var(--dsw-alias-label-secondary)}.novel-status{flex:none;padding:3px 6px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);font-size:10px}.novel-progress-row{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:7px;padding:9px 16px 0;color:var(--dsw-alias-label-tertiary);font-size:9px}.novel-progress{height:3px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden}.novel-progress i{display:block;height:100%;background:var(--dsw-alias-state-business-primary)}.novel-reader-heading{text-align:center;padding:24px 18px 14px}.novel-reader-heading>span{font-size:9px;letter-spacing:.18em;color:var(--dsw-alias-label-tertiary)}.novel-reader-heading h2{margin:8px 0 5px;font-family:Georgia,"Songti SC","STSong",serif;font-size:21px;font-weight:600;line-height:1.35}.novel-reader-heading small{font-size:9px;color:var(--dsw-alias-label-tertiary)}.novel-reader-paper{padding:5px 25px 30px;font-family:Georgia,"Songti SC","STSong",serif;font-size:15px;line-height:2.05;letter-spacing:.035em;color:var(--dsw-alias-label-primary)}.novel-reader-paper p{margin:0 0 1.05em;text-indent:2em;white-space:pre-wrap}.novel-reader-paper h3{text-align:center;margin:1.5em 0 .8em;font-size:17px}.novel-edit-stack{padding:8px 14px 22px;display:flex;flex-direction:column;gap:10px}
.novel-review-page,.novel-history-page{padding:12px;display:flex;flex-direction:column;gap:12px}.novel-section{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.novel-section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.novel-section-title h3,.novel-card-title-row h3{margin:0;font-size:13px}.novel-section-title>div:first-child{display:flex;flex-direction:column;gap:2px}.novel-section-title span{font-size:10px;color:var(--dsw-alias-label-tertiary)}.novel-fact-grid,.novel-beat-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}.novel-field{display:flex;flex-direction:column;gap:5px;min-width:0}.novel-field-label{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary)}.novel-input,.novel-textarea,.novel-select{width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none}.novel-input{height:34px;padding:0 9px}.novel-textarea{padding:8px 9px;line-height:1.65;resize:vertical}.novel-textarea-large{min-height:180px}.novel-select{height:34px;padding:0 8px}.novel-input:focus,.novel-textarea:focus,.novel-select:focus{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent)}.novel-readonly-value{display:flex;flex-direction:column;gap:4px;min-width:0;padding:8px;border-radius:7px;background:var(--dsw-alias-bg-layer-1)}.novel-readonly-value.is-wide{grid-column:1/-1}.novel-readonly-value>span{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--dsw-alias-label-tertiary)}.novel-readonly-value>div{font-size:11px;line-height:1.65;color:var(--dsw-alias-label-primary)}.novel-readonly-value em{font-size:10px;font-style:normal;color:var(--dsw-alias-label-tertiary)}.novel-prose-note{white-space:pre-wrap;font-size:12px;line-height:1.8;color:var(--dsw-alias-label-secondary)}.novel-master-outline{padding:2px 3px;font-family:Georgia,"Songti SC",serif;line-height:1.95}.novel-card-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.novel-card-title-row>span{font-size:9px;color:var(--dsw-alias-label-tertiary)}
.novel-chapters-section{min-height:0}.novel-chapters-workspace{height:clamp(430px,65vh,720px);min-height:0;display:grid;grid-template-columns:minmax(122px,34%) minmax(0,1fr);overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.novel-chapter-directory{min-width:0;overflow:auto;scrollbar-gutter:stable;border-right:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}.novel-directory-group+.novel-directory-group{border-top:1px solid var(--dsw-alias-border-l1)}.novel-chapter-row{width:100%;display:flex;align-items:center;gap:7px;padding:9px 7px;border:0;border-radius:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.novel-chapter-row:hover{background:var(--dsw-alias-interactive-bg-hover)}.novel-chapter-row.is-active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}.novel-chapter-number{font-family:Georgia,serif;font-size:13px;color:var(--dsw-alias-label-tertiary)}.novel-chapter-row-main{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}.novel-chapter-row-main b{font-size:11px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}.novel-chapter-row-main small{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:8px;color:var(--dsw-alias-label-tertiary)}.novel-chapter-row em{font-style:normal;font-size:8px;white-space:nowrap;color:var(--dsw-alias-label-tertiary)}.novel-scene-directory{padding:0 5px 7px 18px}.novel-scene-directory-row{width:100%;height:27px;display:flex;align-items:center;gap:6px;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}.novel-scene-directory-row span{flex:none;font:9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-tertiary)}.novel-scene-directory-row b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:500}.novel-chapters-workspace>.novel-chapter-review{min-width:0;min-height:0;overflow:auto;scrollbar-gutter:stable;display:flex;flex-direction:column;gap:9px;margin:0;padding:13px;border:0}.novel-scenes-heading{display:flex;justify-content:space-between;align-items:center;margin-top:4px}.novel-scenes-heading b{font-size:11px}.novel-scenes-heading span{font-size:9px;color:var(--dsw-alias-label-tertiary)}.novel-scene-card{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid transparent;border-left:2px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,var(--dsw-alias-border-l2));border-radius:4px 8px 8px 4px;background:var(--dsw-alias-bg-layer-2)}.novel-scene-card.is-selected{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 48%,var(--dsw-alias-border-l1));border-left-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,transparent)}.novel-scene-summary{margin:0;font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.novel-pill-list{display:flex;gap:6px;overflow-x:auto;padding-bottom:3px}.novel-pill{min-width:94px;display:grid;grid-template-columns:24px 1fr;grid-template-rows:auto auto;column-gap:6px;align-items:center;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-2);color:inherit;text-align:left;cursor:pointer}.novel-pill>b{grid-row:1/3;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}.novel-pill span{font-size:11px;white-space:nowrap}.novel-pill small{font-size:9px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}.novel-pill.is-active{border-color:var(--dsw-alias-state-business-primary)}.novel-profile-heading{display:flex;align-items:center;gap:10px}.novel-avatar{width:38px;height:38px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-family:Georgia,"Songti SC",serif;font-size:18px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary)}.novel-profile-heading h3{margin:0 0 3px;font-size:15px}.novel-profile-heading span{font-size:10px;color:var(--dsw-alias-label-tertiary)}.novel-knowledge-list{display:flex;flex-direction:column;gap:4px}.novel-knowledge-row{display:flex;align-items:center;gap:8px;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:inherit;text-align:left;cursor:pointer}.novel-knowledge-row span,.novel-category-badge{padding:2px 5px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);font-size:9px;color:var(--dsw-alias-label-secondary)}.novel-knowledge-row b{font-size:11px}.novel-knowledge-row.is-active{border-color:var(--dsw-alias-state-business-primary)}
.novel-version-tree-wrap{overflow-x:auto;padding:2px 1px 6px}.novel-version-tree,.novel-version-children{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;min-width:280px}.novel-version-item{position:relative;min-width:0}.novel-version-row{display:grid;grid-template-columns:24px minmax(0,1fr);align-items:stretch;position:relative}.novel-version-rail{position:relative;min-height:38px;display:flex;justify-content:center;padding-top:14px}.novel-version-dot{position:relative;z-index:2;width:10px;height:10px;border:2px solid var(--dsw-alias-bg-layer-1);border-radius:50%;background:var(--dsw-alias-label-tertiary);box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}.novel-version-item.is-head>.novel-version-row .novel-version-dot{background:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent)}.novel-version-item.has-children>.novel-version-row>.novel-version-rail:after{content:"";position:absolute;z-index:0;left:11px;top:22px;bottom:-10px;width:1px;background:var(--dsw-alias-border-l3)}.novel-version-children{position:relative;min-width:0}.novel-version-children.is-chain{padding-left:0}.novel-version-children.is-fork{margin-top:1px;padding-left:18px}.novel-version-children.is-fork:before{content:"";position:absolute;left:11px;top:-9px;bottom:17px;width:1px;background:var(--dsw-alias-state-business-primary)}.novel-version-children>.novel-version-item>.novel-version-row>.novel-version-rail:before{content:"";position:absolute;z-index:0;left:11px;top:-9px;height:23px;width:1px;background:var(--dsw-alias-border-l3)}.novel-version-children.is-fork>.novel-version-item:before{content:"";position:absolute;left:-7px;top:18px;width:18px;height:1px;background:var(--dsw-alias-state-business-primary)}.novel-version-body{padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);min-width:0}.novel-version-item.is-head>.novel-version-row>.novel-version-body{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 45%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-2))}.novel-version-body .novel-card-title-row>div{display:flex;flex-direction:column;gap:3px;min-width:0}.novel-version-body p{margin:6px 0 2px;font-size:10px;color:var(--dsw-alias-label-secondary)}.novel-version-body>small{font-size:9px;color:var(--dsw-alias-label-tertiary)}.novel-version-identity{display:flex;align-items:center;gap:6px;min-width:0}.novel-version-identity code{font-size:9px;color:var(--dsw-alias-label-tertiary)}.novel-version-identity small{font-size:8px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}.novel-fork-count{position:absolute;z-index:3;right:-2px;top:4px;min-width:13px;height:13px;padding:0 3px;display:flex;align-items:center;justify-content:center;border-radius:7px;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground);font-size:8px;font-weight:700}.novel-head-badge,.novel-history-badge,.novel-root-badge{font-size:9px;padding:2px 6px;border-radius:999px;white-space:nowrap}.novel-head-badge{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}.novel-history-badge{color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover)}.novel-root-badge{color:var(--dsw-alias-state-warning-primary);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 10%,transparent)}
.novel-chapters-section{container-type:inline-size}
.novel-chapters-workspace{display:flex;flex-direction:column}.novel-chapter-directory{flex:none;display:flex;gap:4px;padding:6px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:auto;border-right:0;border-bottom:1px solid var(--dsw-alias-border-l2)}.novel-directory-group{flex:0 0 auto}.novel-directory-group+.novel-directory-group{border-top:0}.novel-chapter-row{width:152px;height:50px;padding:6px 8px;border:1px solid transparent;border-radius:7px}.novel-chapter-row.is-active{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,var(--dsw-alias-border-l1))}.novel-chapters-workspace>.novel-chapter-review{flex:1}
.novel-generation-mode{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.novel-generation-mode>span{font-size:10px;font-weight:600;color:var(--dsw-alias-label-secondary)}.novel-generation-mode>div{display:flex;gap:3px;padding:2px;border-radius:7px;background:var(--dsw-alias-bg-layer-1)}.novel-generation-mode button{height:25px;padding:0 8px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;cursor:pointer}.novel-generation-mode button.is-active{background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l2)}.novel-generation-mode>b{font-size:10px;color:var(--dsw-alias-state-business-primary)}
.novel-placement-composer,.novel-placement-review{display:flex;flex-direction:column;gap:10px;padding:11px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,var(--dsw-alias-border-l1));border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 4%,var(--dsw-alias-bg-layer-1))}.novel-placement-intro b{font-size:12px}.novel-placement-intro p{margin:4px 0 0;font-size:10px;line-height:1.6;color:var(--dsw-alias-label-secondary)}.novel-placement-field{display:flex;flex-direction:column;gap:6px}.novel-placement-cast{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px}.novel-placement-character{min-width:0;display:grid;grid-template-columns:28px minmax(0,1fr) auto;grid-template-rows:auto auto;column-gap:7px;align-items:center;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;text-align:left;cursor:pointer}.novel-placement-character>b{grid-row:1/3;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.novel-placement-character span,.novel-placement-character small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.novel-placement-character span{font-size:10px;font-weight:600}.novel-placement-character small{font-size:8px;color:var(--dsw-alias-label-tertiary)}.novel-placement-character em{grid-column:3;grid-row:1/3;font-size:8px;font-style:normal;color:var(--dsw-alias-label-tertiary)}.novel-placement-character.is-placed{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-layer-2))}.novel-placement-character.is-placed>b{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-primary-foreground)}.novel-placement-character.is-placed em{color:var(--dsw-alias-state-business-primary)}.novel-placement-context{display:flex;flex-wrap:wrap;gap:5px;padding-top:2px}.novel-placement-context span{padding:3px 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);font-size:9px;color:var(--dsw-alias-label-secondary)}.novel-placement-context p{flex-basis:100%;margin:2px 0 0;font-size:9px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}.novel-placed-cast{display:flex;align-items:center;flex-wrap:wrap;gap:5px}.novel-placed-cast>span{font-size:9px;color:var(--dsw-alias-label-tertiary)}.novel-placed-cast b{padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);font-size:9px}.novel-placed-cast em{font-size:9px;font-style:normal;color:var(--dsw-alias-label-tertiary)}.novel-placement-ready{margin:0;padding:8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.6}
@container (max-width:430px){.novel-chapters-workspace{grid-template-columns:108px minmax(0,1fr)}.novel-chapters-workspace>.novel-chapter-review{padding:10px}.novel-chapters-workspace .novel-fact-grid,.novel-chapters-workspace .novel-beat-grid{grid-template-columns:1fr}.novel-chapters-workspace .novel-readonly-value.is-wide{grid-column:auto}.novel-chapter-row{gap:5px;padding-left:6px;padding-right:5px}.novel-chapter-row em{display:none}}
@media(max-width:360px){.novel-fact-grid,.novel-beat-grid{grid-template-columns:1fr}.novel-readonly-value.is-wide{grid-column:auto}.novel-reader-paper{padding-left:18px;padding-right:18px}}
.novel-init{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:30px;text-align:center;color:var(--dsw-alias-label-secondary)}.novel-init-icon{width:54px;height:54px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}.novel-init h3{margin:0;font-size:14px;color:var(--dsw-alias-label-primary)}.novel-init p{max-width:300px;margin:0 0 6px;font-size:11px;line-height:1.7}
.novel-dock-row{width:100%;display:flex;align-items:center;gap:8px;padding:0 8px}.novel-dock-hint{font-size:10px;color:var(--dsw-alias-label-tertiary)}
.novel-overlay{position:fixed;inset:0 0 0 auto;width:min(460px,94vw);z-index:30;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv2);pointer-events:auto}.novel-overlay>*{flex:1;min-height:0}
.novel-sidebar-tab{height:100%;min-height:0;display:flex;flex-direction:column}.novel-sidebar-tab>*{flex:1;min-height:0}
.novel-section-actions{display:flex;gap:5px;flex-wrap:wrap}
.novel-volume-head{display:flex;align-items:center;gap:6px;padding:7px 8px 4px;font-size:10px}.novel-volume-head b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-weight:600}.novel-volume-head span{color:var(--dsw-alias-label-tertiary);font-size:9px}.novel-volume-head.is-editing{padding:5px 6px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,transparent)}.novel-volume-head.is-editing b{color:var(--dsw-alias-state-business-primary)}.novel-volume-input{flex:1;min-width:0;height:24px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:10px;padding:0 6px}.novel-volume-meta{flex:none}.novel-directory-group.is-chapter+.novel-directory-group.is-chapter{border-top:1px solid var(--dsw-alias-border-l1)}
.novel-view-switch{display:flex;justify-content:center;gap:3px;padding:6px 12px 0}.novel-view-switch button{height:24px;padding:0 14px;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;cursor:pointer}.novel-view-switch button:hover{color:var(--dsw-alias-label-primary)}.novel-view-switch button.is-active{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary);font-weight:600}.novel-outline-pane{padding-bottom:22px}.novel-outline-note{padding:12px 25px 18px;font-family:Georgia,"Songti SC","STSong",serif;font-size:13px;line-height:2;letter-spacing:.02em}.novel-placement-note{padding:7px 9px;border-radius:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 22%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-layer-2));font-size:10px;color:var(--dsw-alias-label-secondary)}`

    function insertStyle() {
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-novel-studio'
      tag.dataset.pluginCss = 'dsh-novel-studio/client.css'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return function () { tag.remove() }
    }

    // DSH 的右侧栏由 ui-sidebar-right 的 tab 系统拥有：插件注册一个 tab 类型
    // （定义进 sidebarRightTabs，主体进 keyed 的 sidebar.right.pane.tab，键为
    // 定义 id），再用 ctx.sidebarRight.openTab(kind) 打开——同一步会展开栏目。
    var SIDEBAR_TAB_ID = 'dsh-novel-studio'
    var SIDEBAR_TAB_KIND = 'novel-studio'

    // tab 主体：右侧栏按 session scope 传入 tab 的标准 props。
    function NovelSidebarTab(props) {
      return h('div', { className: 'novel-sidebar-tab' },
        h(NovelPanel, { sessionId: props.sessionId, closeNovel: props.closeNovel })
      )
    }

    module.exports = {
      name: 'dsh-novel-studio',
      // sidebarRight / sidebarRightTabs 声明为依赖，保证 apply 运行时官方右侧栏
      // 服务已就绪（依赖顺序影响注册时机，不能用 ctx.get 事后补救）。
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight'],
      apply: function (ctx) {
        ctx.effect(insertStyle)

        // 服务已由 inject 保证就绪；这里仍做存在性判断，避免运行时被卸载时崩溃。
        function openNovelTab(sessionId) {
          var sidebar = ctx.get('sidebarRight')
          if (sidebar !== undefined && typeof sidebar.openTab === 'function') {
            try {
              sidebar.openTab(SIDEBAR_TAB_KIND)
              return
            } catch (cause) {
              // tab 类型未注册成功时不让点击静默失败，直接退回浮层。
            }
          }
          openNovelOverlay(sessionId)
        }

        var sidebarTabs = ctx.get('sidebarRightTabs')
        if (sidebarTabs !== undefined && typeof sidebarTabs.register === 'function') {
          ctx.effect(function () {
            return sidebarTabs.register({
              id: SIDEBAR_TAB_ID,
              kind: SIDEBAR_TAB_KIND,
              priority: 'extension',
              title: function () { return '小说' },
              guide: [{
                order: 60,
                title: function () { return '小说工程' },
                description: function () { return '阅读、审阅与编辑当前工作区的小说工程' }
              }]
            })
          })

          ctx.slots.inject('sidebar.right.pane.tab', function () {
            return ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: SIDEBAR_TAB_ID,
              inject: function (sessionId, actions) {
                return {
                  sessionId: sessionId,
                  closeNovel: function () {
                    if (actions !== undefined && typeof actions.close === 'function') actions.close()
                  }
                }
              }
            }, NovelSidebarTab)
          })
        }

        ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-novel-studio-open',
            order: 30,
            inject: function (sessionId) {
              return {
                openNovel: function () { openNovelTab(sessionId) },
                slotSessionId: typeof sessionId === 'string'
                  ? sessionId
                  : (sessionId && typeof sessionId === 'object' ? sessionId.sessionId : undefined)
              }
            }
          }, HeaderEntry)
        })

        // 空目录 / 新工作区的 blank 会话没有会话 header，但
        // conversation.input.dock 在 Hero 阶段仍渲染并携带 session 快照，
        // 保证小说入口始终可用。空白会话的右侧栏被布局锁定，因此
        // 入口按钮打开 shell.overlay 浮层。
        ctx.slots.inject('conversation.input.dock', function () {
          return ctx.slots.register({
            name: 'conversation.input.dock',
            id: 'dsh-novel-studio-dock',
            order: 30,
            inject: function (props) {
              return {
                session: props && props.session ? props.session : undefined
              }
            }
          }, DockNovelEntry)
        })

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-novel-studio-overlay',
            order: 40
          }, OverlayNovelPanel)
        })
      }
    }

    return module.exports
  }
})
