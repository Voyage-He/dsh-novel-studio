import type { Context } from '@deepseek-ai/cordis'

export const name: 'dsh-novel-studio'
export const inject: readonly ['tools', 'webServer', 'agents']

export interface Config {
  /** 当前 DSH workspace 内的小说工程相对目录。 */
  projectDirectory: string
  /** 内置版本快照保留数量。 */
  historyLimit: number
}

export const Config: unknown

/** 注册小说项目 API 与 novel_project_read / novel_project_write 工具。 */
export function apply(ctx: Context, config: Config): void
