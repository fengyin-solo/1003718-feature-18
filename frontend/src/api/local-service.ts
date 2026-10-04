import { MODULE_BY_KEY } from '@/data/modules'
import {
  buildInspectionView,
  filterInspectionView,
  PENDING_FAULT_STATUS,
  type InspectionFilters,
  type InspectionViewRow,
} from '@/data/inspection'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OperatorContext,
  OverviewResult,
  PageResult,
  RepairCreated,
  RepairDraft,
} from '@/data/types'

// 与会话 store 的角色口径保持一致，避免页面与服务层各写一份。
const FAULT_DISPOSE_ROLE = '故障处置'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 需要「故障处置」角色的动作：越权调用直接拒绝。
const DISPOSE_ACTIONS_BY_MODULE: Record<string, string[]> = {
  inspection: ['确认处置'],
}

// 在途动作锁：并发点击同一个流转，只有第一次生效，其余直接判定为重复提交。
const inflightKeys = new Set<string>()

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  operator?: OperatorContext,
): ActionResult {
  const meta = moduleMeta(key)
  const restrict = DISPOSE_ACTIONS_BY_MODULE[key]
  if (
    restrict?.includes(action) &&
    operator &&
    !operator.roles.includes(FAULT_DISPOSE_ROLE)
  ) {
    return {
      ok: false,
      message: `越权操作被拒绝：${operator.operator}没有「故障处置」权限，无法${action}，请由运维主管执行`,
    }
  }

  // 巡检记录按合并口径整组流转：合并行对应几条底层记录就一起改，避免同一动作只生效一半。
  if (key === 'inspection') {
    return runInspectionAction(meta, id, action)
  }

  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function runInspectionAction(
  meta: ModuleMeta,
  groupKey: number,
  action: string,
): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(meta.key)
  const view = buildInspectionView(rows, listRows('station'))
  // 单条动作（检修联动后从列表外触发）传的是底层 id；合并行传的是取负的组序号，
  // 这里两种都兼容：优先按底层 id，再按组定位。
  let group: InspectionViewRow | undefined
  if (groupKey < 0) {
    group = view[-groupKey - 1]
  } else {
    group = view.find((item) => item.ids.includes(groupKey))
  }
  if (!group) {
    return { ok: false, message: `没有找到对应的${meta.entity}` }
  }
  if (group.status === target) {
    return { ok: false, message: `该组巡检记录已经是「${target}」，不用重复操作` }
  }

  const idSet = new Set(group.ids)
  let changed = 0
  const next = rows.map((row) => {
    if (!idSet.has(Number(row.id))) {
      return row
    }
    if (String(row.status) === target) {
      return row
    }
    changed += 1
    return {
      ...row,
      status: target,
      pending: target !== '已处置',
      abnormal: target === PENDING_FAULT_STATUS,
      巡检状态: target,
    }
  })
  if (changed === 0) {
    return { ok: false, message: `该组巡检记录已经是「${target}」，不用重复操作` }
  }
  saveRows(meta.key, next)
  return {
    ok: true,
    message: `已${action} ${group.recordCodes.join('、')}，当前状态「${target}」`,
  }
}

/**
 * 带并发保护的动作执行：同一个（模块+对象+动作）在途只允许一次。
 * 模拟到本地存储之间的异步窗口，双击、多标签同时确认都只有第一笔落库。
 */
export async function runActionAsync(
  key: string,
  id: number,
  action: string,
  operator?: OperatorContext,
): Promise<ActionResult> {
  const lock = `${key}:${id}:${action}`
  if (inflightKeys.has(lock)) {
    return { ok: false, message: '操作正在处理中，请勿重复提交（并发确认只生效一次）' }
  }
  inflightKeys.add(lock)
  try {
    // 权限校验放在锁内的第一步：越权请求同样不允许并发刷。
    const result = runAction(key, id, action, operator)
    await delay(250)
    return result
  } finally {
    inflightKeys.delete(lock)
  }
}

export function listInspection(filters: InspectionFilters, onlyPendingFaults: boolean) {
  const rows = listRows('inspection')
  const view = buildInspectionView(rows, listRows('station'))
  const items = filterInspectionView(view, filters, onlyPendingFaults)
  const stations = new Set(
    view.filter((row) => row.status === '已巡检' || row.status === '已处置').map((row) => row.站点编号),
  )
  const currentMonth = new Date().toISOString().slice(0, 7)
  return {
    items,
    total: items.length,
    stats: {
      monthCount: view.filter((row) => row.巡检日期.startsWith(currentMonth)).length,
      inspectedStations: stations.size,
      pendingFaults: view.filter((row) => row.status === PENDING_FAULT_STATUS).length,
    },
  }
}

/** 巡检故障联动检修事项：从巡检行预填草稿。 */
export function repairDraftFromInspection(groupKey: number): RepairDraft | null {
  const view = buildInspectionView(listRows('inspection'), listRows('station'))
  const group = groupKey < 0 ? view[-groupKey - 1] : view.find((item) => item.ids.includes(groupKey))
  if (!group) {
    return null
  }
  return {
    设备编号: '',
    所属站点: group.站点编号,
    故障描述: group.发现问题,
    来源巡检记录: group.recordCodes.join('、'),
    检修人员: '',
    登记日期: new Date().toISOString().slice(0, 10),
  }
}

/** 设备入口联动：从遥测设备预填，并自动挂接本站点最新一条待处置故障。 */
export function repairDraftFromDevice(deviceId: number): RepairDraft | null {
  const device = listRows('telemetry').find((row) => Number(row.id) === deviceId)
  if (!device) {
    return null
  }
  const stationCode = String(device['所属站点'] ?? '').trim()
  const view = buildInspectionView(listRows('inspection'), listRows('station'))
  const linked = view
    .filter((row) => row.status === PENDING_FAULT_STATUS && row.站点编号 === stationCode)
    .slice(-1)[0]
  return {
    设备编号: String(device['设备编号'] ?? ''),
    所属站点: stationCode,
    故障描述: linked?.发现问题 ?? '',
    来源巡检记录: linked?.recordCodes.join('、') ?? '',
    检修人员: '',
    登记日期: new Date().toISOString().slice(0, 10),
  }
}

const REPAIR_KEY = 'repair'

function nextRepairCode(rows: EntryRow[]): string {
  const max = rows.reduce((maxValue, row) => {
    const match = String(row['事项编号'] ?? '').match(/REP-(\d+)/)
    return match ? Math.max(maxValue, Number(match[1])) : maxValue
  }, 0)
  return `REP-${String(max + 1).padStart(4, '0')}`
}

/**
 * 登记检修事项：同一来源巡检记录只允许一条未闭环事项（幂等），
 * 在途并发由锁拦截；没有来源记录的手动登记也不允许相同设备+故障描述重复落库。
 */
export async function createRepair(draft: RepairDraft): Promise<RepairCreated> {
  const lock = `repair:create:${draft.来源巡检记录 || `${draft.设备编号}:${draft.故障描述}`}`
  if (inflightKeys.has(lock)) {
    return { ok: false, message: '检修事项正在登记中，请勿重复提交', duplicated: true }
  }
  inflightKeys.add(lock)
  try {
    await delay(300)
    const rows = listRows(REPAIR_KEY)
    const sourceCode = draft.来源巡检记录.trim()
    const duplicate = rows.find((row) => {
      if (String(row.status) === '已完成') {
        return false
      }
      if (sourceCode) {
        const existing = String(row['来源巡检记录'] ?? '').split(/[、,，]/).map((item) => item.trim())
        return sourceCode.split(/[、,，]/).some((code) => code && existing.includes(code.trim()))
      }
      return (
        String(row['设备编号'] ?? '') === draft.设备编号.trim() &&
        String(row['故障描述'] ?? '') === draft.故障描述.trim()
      )
    })
    if (duplicate) {
      return {
        ok: false,
        duplicated: true,
        id: Number(duplicate.id),
        message: `该故障已登记检修事项 ${duplicate['事项编号'] ?? ''}，无需重复登记`,
      }
    }
    const now: EntryRow = {
      id: rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1,
      status: '待安排',
      pending: true,
      abnormal: false,
      事项编号: nextRepairCode(rows),
      设备编号: draft.设备编号.trim(),
      所属站点: draft.所属站点.trim(),
      故障描述: draft.故障描述.trim(),
      来源巡检记录: sourceCode,
      检修人员: draft.检修人员.trim(),
      登记日期: draft.登记日期.trim(),
      事项状态: '待安排',
    }
    saveRows(REPAIR_KEY, [...rows, now])
    return { ok: true, id: Number(now.id), message: `检修事项 ${now['事项编号']} 已登记` }
  } finally {
    inflightKeys.delete(lock)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
