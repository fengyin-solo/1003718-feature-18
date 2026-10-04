/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 动作执行的操作者上下文：越权处置在服务层直接拒绝，页面不做业务判断。
export type OperatorContext = {
  operator: string
  roles: string[]
}

// 检修事项的联动登记草稿：由巡检故障或设备入口预填，来源记录相同的重复登记只生效一次。
export type RepairDraft = {
  设备编号: string
  所属站点: string
  故障描述: string
  来源巡检记录: string
  检修人员: string
  登记日期: string
}

export type RepairCreated = ActionResult & {
  id?: number
  duplicated?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
