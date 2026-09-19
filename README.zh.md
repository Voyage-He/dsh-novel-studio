# dsh-plugin-novel-studio

[English](./README.md) | **简体中文**

把 DeepSeek Harness（DSH）的 Web UI 变成一个“对话在中间、小说在右边”的 AI 小说工作室。

它不是把聊天框换个皮肤，而是建立一套可落盘、可追踪、可恢复的创作工程。全书提纲、章节提纲、场景、人物与正文是并列可修改的资料层，没有强制的写作顺序。AI 与作者使用同一份结构化资料，所有写入都会形成版本。

## 当前功能

- **阅读器式右栏**：默认按小说阅读器展示正文，正文栏内置“正文 / 细纲”切换按钮，细纲视图展示当前章的章节细纲与场景节拍（一章对应一份细纲，编辑模式下可直接修改）；也可审阅提纲、人物、特殊知识和版本；章节目录在详情上方横向滚动，下方使用完整宽度显示当前章节，场景作为章节内的结构化文字留在详情中；需要时切换“编辑”直接修改结构化内容并保存版本。
- **AI 只走主对话**：右栏没有 AI 提示词输入框、生成/续写/润色按钮或第二套聊天体验。所有 AI 创作指令都从 DSH 原本的对话区提出，右栏自动刷新结果。
- **非线性创作**：不设阶段轨道或前置条件。可以先写正文再补提纲，也可以在任何时候修改人设、场景、世界规则或已写章节。
- **两种章节生成方式**：既可提供章节提纲，也可使用“放置生成”——只描述场景、放入登场人物，AI 自动结合最新人物卡、世界知识与前文生成细纲和场景节拍。
- **结构化资料**：小说元数据（作者、简介、标签、连载状态）、书名、题材、核心故事、文风准则、总纲、章节、场景节拍、人物卡、特殊知识库与分卷结构。
- **小说元数据与分卷**：工程顶层保存作者、对外简介、标签组与连载状态（连载中/已完结/暂停），右栏“提纲”页可编辑并展示；章节按卷分组浏览，可新建/重命名/删除卷或在编辑模式把章节移入任意卷（未分卷章节自动归入“未分卷”组），AI 也可通过 `upsert_volume` / `delete_volume` 维护分卷。阅读器顶部持续显示已写字数与目标字数的完成进度。
- **AI 原生写入**：注册 `novel_project_read` 和 `novel_project_write` 两个 DSH 工具。模型会先读最新工程，再把结果写回，而不是只把草稿留在聊天回复中。
- **摘要式修改反馈**：AI 写入后只把“修改了哪些人物/章节/知识、版本号与字数变化”的简短总结反馈到对话界面，具体修改内容落在工程文件中，不会在对话里复述或展示。
- **像代码仓库一样追踪**：每次 AI 写入或手动保存都会创建带父版本、来源、时间、说明和变更摘要的不可变快照；右栏以图形版本树显示父子连线和创作分支，从旧节点恢复会建立新分支。
- **按 workspace 隔离**：一个工作区就是一部小说，小说工程默认保存在当前 DSH 会话 workspace 的 `novel/` 目录，不同 workspace 互不干扰。
- **显式初始化与自动识别**：初次打开右栏时，尚未初始化的 workspace 只显示“初始化小说工程”按钮；点击后创建 `novel/` 目录结构。已初始化的 workspace 会被自动识别并直接加载，也可以在主对话里让 AI 调用 `init_project` 完成初始化。
- **入口按工作区状态显示**：入口是否出现由后端对工作区目录的判定决定，只有两种结果会显示 **小说** 入口——目录为空（除 `.git`、`.gitignore`、`.DS_Store` 外没有任何条目，等待初始化），或目录里已经是有效的小说工程（`novel/project.json` 与版本历史齐备）。已被其它项目占用的目录（存在 `package.json`、源码等，或只有内容不明的 `novel/` 目录）不会注入入口；目录不可读、状态未知或请求失败时同样不显示，宁可少显示也不错显示。如果确实要在已占用的目录里写小说，可在主对话让 AI 执行 `init_project` 显式初始化，之后入口会自动出现。

## 数据目录

在右栏点击“初始化小说工程”（或由 AI 调用 `init_project`）后创建：

```text
<workspace>/novel/
├── project.json                 # 当前结构化小说工程，格式化文本，适合 Git diff
└── .history/
    ├── index.json               # 当前 head 与版本摘要
    └── revisions/<hash>.json    # 可恢复的不可变快照
```

`project.json` 是当前状态的唯一工作副本，可以和普通源码一起交给 Git 管理；`.history` 是插件自己的细粒度恢复层。若只想使用 Git 历史，可在项目自己的 `.gitignore` 中忽略 `novel/.history/`。

## 安装

本地开发目录安装：

```bash
npx @deepseek-ai/dsh plugin --profile web add \
  dsh-plugin-novel-studio@file:/绝对路径/到/novel-plugin
```

然后使用同一 profile 启动：

```bash
npx @deepseek-ai/dsh --profile web
```

在 DSH 中选择一个 workspace，创建或打开非空会话。会话标题右侧会出现 **小说** 按钮，点击后打开右侧栏：尚未初始化的 workspace 会显示初始化按钮，点击后创建小说工程；已初始化的 workspace 会自动识别并加载内容。面板按官方右侧栏（ui-sidebar-right）的 tab 机制注册——小说作为一个 tab 类型出现，点击入口即打开该 tab 并同步展开栏目，也可以从右侧栏的“＋”向导页里选择“小说工程”打开；关闭使用面板标题栏的关闭按钮或右侧栏自身的收起控件。对于尚未发送任何消息的空白会话（例如刚选定一个空目录工作区），DSH 会隐藏会话标题栏且右侧栏放不下，此时 **小说** 按钮出现在输入框上方的常驻行，点击后以右侧浮层打开本面板；发送第一条消息后按钮回到会话标题右侧，并改用官方右侧栏。

移除插件：

```bash
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-novel-studio
```

## 使用方式

- 直接在原本的对话区提出当下想做的修改，例如“先写第三章追逐戏”、“把主角的动机改掉”或“根据现有正文重新整理全书提纲”。
- 全书提纲、章节提纲、人物、知识、场景与正文都可以反复调整，修改其中一项不会自动改变其它内容或项目阶段。
- 对已有条目的修改会精准落位：例如“完善某某人物”，AI 会先读取最新人物卡，再以原 `id` 调用 `upsert_character` 更新；写入完成后只反馈本次修改总结（条目、版本号、字数变化），具体内容保存在右栏与工程文件中。
- 右栏默认用于阅读和审阅，编辑模式用于直接修改小说数据，不承载 AI 对话。AI 写入后会自动刷新；版本既可在编辑模式下手动恢复，也可在主对话中指定版本号恢复。

### 放置生成

1. 在“提纲”页选择一个章节，进入编辑并把“生成方式”切换为“放置生成”。
2. 用自然语言描述场景，例如“暴雨夜的废弃车站恢复广播，一列不存在于时刻表的旧车进站”。
3. 从人物卡中点击放入本章登场人物；可再填写不可违背的结果、氛围或悬念要求。
4. 保存后在 DSH 主对话中说“根据《章节名》的当前布置生成细纲”。AI 会读取该章的专用生成上下文：已放置人物的最新人物卡、全部世界知识、此前各章的结构以及最近 12,000 字符前文。
5. AI 把生成的章节细纲与结构化场景节拍写回当前章，原始布置会保留，后续可以调整布置再次生成；已有正文不会被自动覆盖。

“放置”只保存人物 id，不复制人物卡内容；因此人物设定或世界知识更新后，下一次生成会自动使用最新资料。放置模式也不要求预先填写章节细纲。

## 配置

包的 `patch.yml` 默认配置：

```yaml
config:
  projectDirectory: novel
  historyLimit: 300
```

- `projectDirectory` 必须是 workspace 内的相对路径，不能越出 workspace。
- `historyLimit` 范围为 10–1000。

用户可以在 profile 的 `cordis.patch.yml` 中按插件行 id 覆盖配置。DSH 的 patch 会替换整行 `config`，覆盖时请重述两个字段。

## 与官方 DSH 架构的对应关系

实现遵守官方插件约定：

- Host 入口导出 `apply`、Schemastery `Config` 和依赖 `inject`；资源注册绑定 Cordis 生命周期。
- npm 包通过 `dsh.bundle.patch` 贡献组合层，通过 `dsh.client` 暴露浏览器 bundle。
- AI 能力通过 `ctx.tools.register()` 注册官方的原始 `ToolDefinition` 形状，包含 JSON Schema 参数、规范输出、参数校验与模型可见渲染。
- 插件不把 `@deepseek-ai/dsh-tools` 作为运行时依赖安装到 profile；ToolRuntime、调度器与工具管线始终由 DSH 宿主提供，避免两份服务包的私有标识不一致。
- Client 通过 `ctx.slots.inject` 等待槽位声明；入口注册到 additive 的 `conversation.session.header.utilities`，小说面板以更低 `priority` 显式 shadow 官方 single `details` 槽位。
- Client 的写请求仅用于作者手动保存或恢复项目；AI 创作操作全部由当前 DSH 主会话中的模型调用官方工具完成。插件不另存 API Key，也不绕过 DSH 的权限、会话与工具管线。

参考：

- [DeepSeek Harness 官方仓库](https://github.com/deepseek-ai/deepseek-harness)
- [官方：第一个插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)
- [官方：开发一个工具](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/tool.zh.md)
- [官方：插件配置](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.zh.md)
- [官方：打包与安装插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)
- [官方：工具执行流水线](https://deepseek-harness.github.io/deepseek-harness/reference/tool-execution-pipeline)
- [官方：ToolDefinition 与工具子系统](https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/tools)

## 兼容性说明

当前按 `@deepseek-ai/dsh 0.1.0-rc.7` 的官方公开契约、Tool 执行流水线与客户端 slot 实现开发。DSH 官方明确仍处于 Developer Preview，未来可能有破坏性变更。

本插件会 shadow 默认工具详情右栏：启用后，点击聊天中的工具行仍会打开右栏，但显示小说工作室而非官方工具详情。关闭或卸载插件后，官方详情面板自动恢复。

## 开发检查

```bash
npm install
npm run check
npm test
npm run pack:check
```
