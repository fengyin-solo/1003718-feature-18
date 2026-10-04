import type { EntryRow } from './types'

// 巡检域的专属口径：旧系统导出的日期格式不一、重复记录需要合并，统一收口在这一层。

export const PENDING_FAULT_STATUS = '发现故障'

const INSPECTION_STATUS_ORDER = ['待巡检', '已巡检', '发现故障', '已处置']

export type InspectionViewRow = {
  key: string
  // 合并口径下同一组巡检动作对应的所有底层记录 id，动作流转要整组生效。
  ids: number[]
  recordCodes: string[]
  status: string
  站点编号: string
  站点名称: string
  巡检日期: string
  巡检人员: string
  检查项目: string
  发现问题: string
  处理措施: string
  mergedCount: number
}

function pad2(value: string): string {
  return value.padStart(2, '0')
}

/**
 * 兼容旧日期：支持 2026-10-01 / 2026/10/1 / 20261001 / 2026年10月1日 /
 * 2026.10.01、两位年份 26-10-01 以及带时分秒后缀的写法，统一归一为 YYYY-MM-DD；
 * 实在解析不了就原样返回，至少保证相同写法仍能合并到一起。
 */
export function normalizeInspectionDate(raw: unknown): { value: string; parsed: boolean } {
  const text = String(raw ?? '').trim()
  if (!text) {
    return { value: '', parsed: false }
  }
  const datePart = text.split(/\s+/)[0]

  let match = datePart.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (match) {
    return { value: `${match[1]}-${match[2]}-${match[3]}`, parsed: true }
  }

  const relaxed = datePart.replace(/[年月.]/g, '-').replace(/日/g, '').replace(/-+$/, '')
  match = relaxed.match(/^(\d{2,4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (match) {
    const year = match[1].length === 2 ? `20${match[1]}` : match[1]
    return {
      value: `${year}-${pad2(match[2])}-${pad2(match[3])}`,
      parsed: true,
    }
  }
  return { value: text, parsed: false }
}

function textOf(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function unionText(parts: string[]): string {
  const seen = new Set<string>()
  const result: string[] = []
  for (const part of parts) {
    const value = part.trim()
    if (value && !seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result.join('；')
}

function mergeStatus(statuses: string[]): string {
  let best = statuses[0]
  let bestIndex = -1
  for (const status of statuses) {
    const index = INSPECTION_STATUS_ORDER.indexOf(status)
    if (index > bestIndex) {
      best = status
      bestIndex = index
    }
  }
  return best
}

/**
 * 重复记录合并口径：同一站点、同一巡检日期（归一化后）、同一巡检人员视为同一次巡检，
 * 底层多条登记合并成一行；发现问题、处理措施等文本做去重拼接，状态取推进最远的一个。
 */
export function buildInspectionView(
  rows: EntryRow[],
  stationRows: EntryRow[],
): InspectionViewRow[] {
  const stationNames = new Map<string, string>()
  for (const station of stationRows) {
    stationNames.set(textOf(station, '站点编号'), textOf(station, '站点名称'))
  }

  const groups = new Map<
    string,
    {
      rows: EntryRow[]
      dates: { raw: string; parsed: boolean }[]
    }
  >()
  const order: string[] = []

  for (const row of rows) {
    const stationCode = textOf(row, '站点编号')
    const dateInfo = normalizeInspectionDate(row['巡检日期'])
    const inspector = textOf(row, '巡检人员')
    const key = `${stationCode}|${dateInfo.value}|${inspector}`
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
      existing.dates.push({ raw: textOf(row, '巡检日期'), parsed: dateInfo.parsed })
    } else {
      groups.set(key, { rows: [row], dates: [{ raw: textOf(row, '巡检日期'), parsed: dateInfo.parsed }] })
      order.push(key)
    }
  }

  return order.map((key) => {
    const group = groups.get(key)!
    const first = group.rows[0]
    const stationCode = textOf(first, '站点编号')
    const canonicalDate = group.dates.find((item) => item.parsed)?.raw
    const displayDate = canonicalDate
      ? normalizeInspectionDate(canonicalDate).value
      : group.dates[0].raw
    return {
      key,
      ids: group.rows.map((row) => Number(row.id)),
      recordCodes: group.rows.map((row) => textOf(row, '记录编号')),
      status: mergeStatus(group.rows.map((row) => String(row.status))),
      站点编号: stationCode,
      站点名称: stationNames.get(stationCode) ?? '',
      巡检日期: displayDate,
      巡检人员: textOf(first, '巡检人员'),
      检查项目: unionText(group.rows.map((row) => textOf(row, '检查项目'))),
      发现问题: unionText(group.rows.map((row) => textOf(row, '发现问题'))),
      处理措施: unionText(group.rows.map((row) => textOf(row, '处理措施'))),
      mergedCount: group.rows.length,
    }
  })
}

export type InspectionFilters = {
  站点?: string
  巡检日期?: string
  巡检人员?: string
  发现问题?: string
}

/** 联合定位：站点沿站点取数链路同时匹配站点编号/站点名称，日期按归一化后匹配，命中待处置开关只看故障行。 */
export function filterInspectionView(
  rows: InspectionViewRow[],
  filters: InspectionFilters,
  onlyPendingFaults: boolean,
): InspectionViewRow[] {
  const station = (filters.站点 ?? '').trim()
  const dateRaw = (filters.巡检日期 ?? '').trim()
  const inspector = (filters.巡检人员 ?? '').trim()
  const problem = (filters.发现问题 ?? '').trim()
  const dateCanonical = dateRaw ? normalizeInspectionDate(dateRaw).value : ''

  return rows.filter((row) => {
    if (onlyPendingFaults && row.status !== PENDING_FAULT_STATUS) {
      return false
    }
    if (station && !`${row.站点编号} ${row.站点名称}`.includes(station)) {
      return false
    }
    if (
      dateCanonical &&
      !`${row.巡检日期} ${normalizeInspectionDate(row.巡检日期).value}`.includes(dateCanonical)
    ) {
      return false
    }
    if (inspector && !row.巡检人员.includes(inspector)) {
      return false
    }
    if (problem && !`${row.发现问题} ${row.处理措施}`.includes(problem)) {
      return false
    }
    return true
  })
}
