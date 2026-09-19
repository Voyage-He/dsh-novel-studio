declare const plugin: {
  name: 'dsh-novel-studio'
  inject: ['slots', 'sidebarRightTabs', 'sidebarRight']
  /**
   * 面板通过官方右侧栏（ui-sidebar-right）的 tab 系统承载：类型注册进
   * `ctx.sidebarRightTabs`（id/kind/priority/title），主体注册进 keyed 槽位
   * `sidebar.right.pane.tab`（key 为定义 id），入口按钮调用
   * `ctx.sidebarRight.openTab(kind)` 打开并同步展开栏目。
   *
   * 两个 sidebar 服务都用 `ctx.get` 软获取：环境里没有它们（或 tab 注册未生效）
   * 时退回 shell.overlay 浮层，保证入口点击始终有反馈。blank 会话（新工作区）
   * 的右侧栏放不下，同样走浮层路径。
   *
   * 注意：layout 服务只提供 selectPanel / beginNavigation / toggleSidebar /
   * openRightbar / closeRightbar，没有 openDetails；live 槽位树里也没有
   * `details` 槽位。
   */
  apply(ctx: unknown): void
}

export default plugin
