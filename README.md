# dsh-novel-studio

**English** | [简体中文](./README.zh.md)

An AI novel studio for the DeepSeek Harness Web UI: AI work stays in the native conversation, while a reader-like right panel reviews prose and structured context and offers an optional manual edit mode—without a second AI chat, prompt box, or enforced writing sequence. The reader header carries a prose/outline toggle: the outline view shows the current chapter's outline plus its structured scene beats (one outline per chapter, editable in edit mode). The chapter directory scrolls horizontally above a full-width detail pane, while scenes remain structured text inside the selected chapter. Outlines, characters, scenes, knowledge, prose, novel metadata (author, description, tags, serialization status) and volume grouping can be revised at any time.

Each chapter supports two generation modes. Outline mode uses an author-supplied chapter outline. Placement mode lets the author describe a scene and place character cards into it; the model then receives those live character cards, all world knowledge, chapter continuity, and a bounded excerpt of preceding prose to generate the detailed outline and structured scene beats. The placement remains reusable and generated prose is never overwritten implicitly.

See the [Chinese README](./README.zh.md) for the complete guide.

## Install from a local checkout

```bash
npx @deepseek-ai/dsh plugin --profile web add \
  dsh-novel-studio@file:/absolute/path/to/novel-plugin

npx @deepseek-ai/dsh --profile web
```

Open a workspace and a non-empty session, then click **小说** in the session header. The backend classifies the workspace directory and the entry is injected only for two results: an empty directory (nothing but `.git`, `.gitignore`, `.DS_Store`, waiting to be initialized) or a directory that already holds a valid novel project (`novel/project.json` plus revision history). A directory already used by another project (a `package.json`, source files, or a stray `novel/` directory with unknown content) gets no novel entry; an unreadable directory, an unknown state, or a failed request also hides it, because a missing entry is better than a wrong one. To write a novel inside such a directory anyway, ask the AI to run `init_project` in the native conversation and the entry appears afterwards.

The panel docks through the official right Sidebar (ui-sidebar-right) tab system: the plugin registers `novel-studio` as a tab type and calls `ctx.sidebarRight.openTab(kind)`, which opens the tab and expands the column in the same step. The tab also appears in the Sidebar's guide ("小说工程"), and it closes through the panel header's close button or the Sidebar's own collapse control.

On a blank session (for example right after picking an empty-directory workspace) DSH hides the session header and the right column cannot fit, so the **小说** entry moves to the persistent row above the composer and opens the panel as a right-side overlay; after the first message it returns next to the session title and uses the official Sidebar again.

## Storage

Each DSH workspace maps to exactly one novel. The first time the panel opens an uninitialized workspace, it only shows an "Initialize novel project" button; clicking it creates the `novel/project.json` and `novel/.history/` revision store. Already-initialized workspaces are detected automatically and loaded directly, and the AI can also initialize via `novel_project_write` with `operation=init_project`.

AI writes, manual saves, and restores create immutable snapshots. The panel automatically refreshes when the native conversation changes the project; its write requests are limited to explicit manual save, initialize, and restore actions.

After an AI write, the conversation only receives a short summary—which characters/chapters/knowledge entries changed, the new revision, and the word delta. The actual content is persisted into the project files, so the reply never repeats or dumps the edited text.

The Versions tab renders snapshots as a parent/child tree. Restoring an older node creates a visible branch, so alternate creative directions remain reviewable instead of being flattened into one timeline.

## Development

```bash
npm install
npm run check
npm test
npm run pack:check
```

Built against the public contracts and tool execution pipeline in `@deepseek-ai/dsh 0.1.0-rc.7`. The bundle deliberately does not install its own `@deepseek-ai/dsh-tools` runtime into the profile; tool scheduling stays owned by the DSH host. DeepSeek Harness is in developer preview and may introduce breaking changes.
