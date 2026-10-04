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

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 巡检记录合并后的一行：memberIds 记录被合并的原始巡检记录。 */
export type InspectionRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  memberIds: number[]
  merged: boolean
  [field: string]: string | number | boolean | number[]
}

/** 巡检记录的联合定位条件。 */
export type InspectionFilter = {
  巡检日期: string
  巡检人员: string
  发现问题: string
  onlyPending: boolean
}

/** 设备入口新增的检修事项：由「发现故障」的巡检记录联动产生。 */
export type RepairItem = {
  id: number
  设备编号: string
  所属站点: string
  来源记录编号: string
  检修事项: string
  发现问题: string
  报修时间: string
  状态: string
}
