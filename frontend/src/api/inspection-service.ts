import { listRows, saveRows } from '@/data/local-store'
import { listRepairItems, saveRepairItems } from '@/data/repair-store'
import type {
  ActionResult,
  InspectionFilter,
  InspectionRow,
  RepairItem,
} from '@/data/types'

const MODULE_KEY = 'inspection'
const TELEMETRY_KEY = 'telemetry'

const STATUSES = ['待巡检', '已巡检', '发现故障', '已处置'] as const
// 顺着巡检动作推进的状态机：序号越大越靠后，合并重复记录时取进度最靠后的状态。
const STATUS_RANK: Record<string, number> = Object.fromEntries(
  STATUSES.map((status, index) => [status, index]),
)
const ACTION_TARGETS: Record<string, string> = {
  完成巡检: '已巡检',
  报告故障: '发现故障',
  确认处置: '已处置',
}
// 各动作允许的前置状态：不允许越级流转（例如还没巡检就直接确认处置）。
const ACTION_ALLOWED_FROM: Record<string, string[]> = {
  完成巡检: ['待巡检'],
  报告故障: ['待巡检', '已巡检'],
  确认处置: ['发现故障'],
}

export const PENDING_FAULT_STATUS = '发现故障'

export type Operator = {
  name: string
  role: string
}

/**
 * 旧日期兼容：巡检记录在多端、多批次登记，历史数据里混着 2026/10/2、
 * 2026年09月28日、2026.9.28、时间戳等写法，统一规范成 YYYY-MM-DD 后再做合并与定位。
 */
export function normalizeInspectionDate(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return ''
  }
  const text = String(raw).trim()
  if (!text) {
    return ''
  }
  // 2026年09月28日 / 2026 年 9 月 28 日
  const cnMatch = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/)
  if (cnMatch) {
    return formatDateParts(cnMatch[1], cnMatch[2], cnMatch[3])
  }
  // 2026-10-02 / 2026/10/2 / 2026.10.2，允许后面带时间
  const isoMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/)
  if (isoMatch) {
    return formatDateParts(isoMatch[1], isoMatch[2], isoMatch[3])
  }
  // 兜底：交给 Date 解析（纯数字时间戳、ISO 字符串等）
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    return formatDateParts(
      String(parsed.getFullYear()),
      String(parsed.getMonth() + 1),
      String(parsed.getDate()),
    )
  }
  return text
}

function formatDateParts(year: string, month: string, day: string): string {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return `${year}-${month}-${day}`
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function toInspectionRow(row: InspectionRow): InspectionRow {
  return {
    ...row,
    巡检日期: normalizeInspectionDate(row['巡检日期']),
  }
}

function uniqueJoin(values: string[]): string {
  const seen: string[] = []
  for (const value of values) {
    const text = value.trim()
    if (text && !seen.includes(text)) {
      seen.push(text)
    }
  }
  return seen.join('；')
}

/**
 * 重复记录合并口径（由本次实现确定）：
 * 同一站点、同一规范化巡检日期的多条巡检记录视为同一次巡检的重复登记；
 * 以巡检动作进度最靠后的记录为代表（同进度取最早登记的一条），
 * 巡检人员、检查项目、发现问题、处理措施按非空去重归并；后续动作对整组生效。
 */
export function mergeInspectionRows(rows: InspectionRow[]): InspectionRow[] {
  const groups = new Map<string, InspectionRow[]>()
  for (const raw of rows) {
    const row = toInspectionRow(raw)
    const key = `${String(row['站点编号'] ?? '').trim()}__${String(row['巡检日期'] ?? '')}`
    const list = groups.get(key)
    if (list) {
      list.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  const merged: InspectionRow[] = []
  for (const members0 of groups.values()) {
    const members = [...members0].sort((a, b) => {
      const rankGap =
        (STATUS_RANK[String(a.status)] ?? -1) - (STATUS_RANK[String(b.status)] ?? -1)
      if (rankGap !== 0) {
        return -rankGap
      }
      return Number(a.id) - Number(b.id)
    })
    const representative = members[0]
    const status = String(representative.status)
    merged.push({
      ...representative,
      巡检人员: uniqueJoin(members.map((item) => String(item['巡检人员'] ?? ''))),
      检查项目: uniqueJoin(members.map((item) => String(item['检查项目'] ?? ''))),
      发现问题: uniqueJoin(members.map((item) => String(item['发现问题'] ?? ''))),
      处理措施: uniqueJoin(members.map((item) => String(item['处理措施'] ?? ''))),
      status,
      pending: status !== STATUSES[STATUSES.length - 1],
      abnormal: status === PENDING_FAULT_STATUS,
      memberIds: members.map((item) => Number(item.id)).sort((a, b) => a - b),
      merged: members.length > 1,
    })
  }

  return merged.sort((a, b) => {
    const dateGap = String(b['巡检日期'] ?? '').localeCompare(String(a['巡检日期'] ?? ''))
    if (dateGap !== 0) {
      return dateGap
    }
    return Number(b.id) - Number(a.id)
  })
}

export function listInspection(filters: InspectionFilter): {
  items: InspectionRow[]
  total: number
  groups: InspectionRow[]
} {
  // 先合并再筛选：重复登记不能靠筛选条件互相藏起来。
  const groups = mergeInspectionRows(listRows(MODULE_KEY) as InspectionRow[])
  const items = groups.filter((row) => matchFilters(row, filters))
  return { items, total: items.length, groups }
}

function matchFilters(row: InspectionRow, filters: InspectionFilter): boolean {
  const date = String(row['巡检日期'] ?? '')
  const staff = String(row['巡检人员'] ?? '')
  const problem = String(row['发现问题'] ?? '')
  if (filters.巡检日期.trim() && !date.includes(filters.巡检日期.trim())) {
    return false
  }
  if (filters.巡检人员.trim() && !staff.includes(filters.巡检人员.trim())) {
    return false
  }
  if (filters.发现问题.trim() && !problem.includes(filters.发现问题.trim())) {
    return false
  }
  if (filters.onlyPending && row.status !== PENDING_FAULT_STATUS) {
    return false
  }
  return true
}

export function inspectionStats(groups: InspectionRow[]) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const inspected = groups.filter((row) => STATUS_RANK[String(row.status)] >= STATUS_RANK['已巡检'])
  const stations = new Set(
    inspected.map((row) => String(row['站点编号'] ?? '')).filter(Boolean),
  )
  return [
    {
      label: '本月巡检次数',
      value: groups.filter((row) => String(row['巡检日期'] ?? '').startsWith(currentMonth)).length,
    },
    { label: '已巡检站点', value: stations.size },
    {
      label: '待处置故障',
      value: groups.filter((row) => row.status === PENDING_FAULT_STATUS).length,
    },
  ]
}

/** 处置权限：发现该故障的巡检人员本人，或值班管理员。 */
export function canDispose(row: InspectionRow, operator: Operator): boolean {
  if (operator.role === '值班管理员') {
    return true
  }
  return String(row['巡检人员'] ?? '')
    .split(/[、,，]/)
    .map((name) => name.trim())
    .includes(operator.name)
}

/**
 * 巡检动作流转。
 * 每次都从实时存储重新取数做前置状态校验（CAS 口径）：
 * 两个确认并发到达时，只有第一个能从「发现故障」写入「已处置」，
 * 第二个读到的已是新状态，会被幂等挡下——确认处置只生效一次。
 */
export function runInspectionAction(
  group: InspectionRow,
  action: string,
  operator: Operator,
): ActionResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `巡检记录没有登记「${action}」这个动作` }
  }

  // 从实时存储读取原始记录（合并字段只在列表展示时临时产生，不落库）。
  const rows = listRows(MODULE_KEY)
  const liveMembers = rows.filter((row) => group.memberIds.includes(Number(row.id)))
  if (liveMembers.length === 0) {
    return { ok: false, message: '巡检记录已不存在，请刷新列表' }
  }
  // 实时状态：重复记录整组共用一个进度，取最靠后的状态。
  const liveStatus = liveMembers
    .map((row) => String(row.status))
    .sort((a, b) => (STATUS_RANK[b] ?? -1) - (STATUS_RANK[a] ?? -1))[0]

  if (liveStatus === target) {
    return { ok: false, message: `巡检记录已经是「${target}」，不用重复操作` }
  }
  const allowedFrom = ACTION_ALLOWED_FROM[action] ?? []
  if (!allowedFrom.includes(liveStatus)) {
    return {
      ok: false,
      message: `当前状态「${liveStatus}」不能执行「${action}」，请按巡检流程逐步流转`,
    }
  }
  if (action === '确认处置' && !canDispose(group, operator)) {
    return {
      ok: false,
      message: '越权处置已拒绝：仅巡检人员本人或值班管理员可确认处置',
    }
  }

  const memberSet = new Set(group.memberIds)
  const next = rows.map((row) =>
    memberSet.has(Number(row.id))
      ? {
          ...row,
          status: target,
          pending: target !== STATUSES[STATUSES.length - 1],
          abnormal: target === PENDING_FAULT_STATUS,
        }
      : row,
  )
  saveRows(MODULE_KEY, next)
  return { ok: true, message: `巡检记录已${action}，当前状态「${target}」` }
}

/** 设备入口联动新增检修事项：同一设备、同一条巡检故障只允许生成一张检修单。 */
export function createRepairFromInspection(
  deviceId: number,
  sourceRecordNo: string,
  problem: string,
): ActionResult & { duplicate?: boolean } {
  const devices = listRows(TELEMETRY_KEY)
  const device = devices.find((row) => Number(row.id) === Number(deviceId))
  if (!device) {
    return { ok: false, message: '没有找到对应的遥测设备' }
  }

  const deviceNo = String(device['设备编号'] ?? '')
  const items = listRepairItems()
  const existed = items.some(
    (item) => item.设备编号 === deviceNo && item.来源记录编号 === sourceRecordNo,
  )
  if (existed) {
    // 并发或重复点击：直接返回已有结果，不重复建单。
    return { ok: true, duplicate: true, message: '该故障的检修事项已登记，无需重复新增' }
  }

  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(
    now.getMinutes(),
  ).padStart(2, '0')}`
  const item: RepairItem = {
    id: items.reduce((max, current) => Math.max(max, current.id), 0) + 1,
    设备编号: deviceNo,
    所属站点: String(device['所属站点'] ?? ''),
    来源记录编号: sourceRecordNo,
    检修事项: `${device['设备类型'] ?? '遥测设备'}检修（巡检联动）`,
    发现问题: problem,
    报修时间: stamp,
    状态: '待检修',
  }
  saveRepairItems([...items, item])

  // 设备同步进入待维修，巡检发现的故障顺着取数链路落到设备侧。
  const nextDevices = devices.map((row) =>
    Number(row.id) === Number(deviceId)
      ? { ...row, status: '待维修', pending: true, abnormal: true }
      : row,
  )
  saveRows(TELEMETRY_KEY, nextDevices)
  return { ok: true, message: `已为设备 ${deviceNo} 新增检修事项，并转为待维修` }
}

export function repairItemsForDevice(deviceNo: string): RepairItem[] {
  return listRepairItems().filter((item) => item.设备编号 === deviceNo)
}
