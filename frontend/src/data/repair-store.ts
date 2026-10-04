import type { RepairItem } from './types'

// 检修事项独立持久化：由巡检「发现故障」经遥测设备入口联动产生，和模块记录分开存。
const REPAIR_STORAGE_KEY = 'hydrology-monitor-station:repair-items:v1'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const SEED_REPAIR_ITEMS: RepairItem[] = []

let cache: RepairItem[] | null = null

function readStorage(): RepairItem[] {
  const fallback = clone(SEED_REPAIR_ITEMS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(REPAIR_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as RepairItem[]
  } catch {
    window.localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

export function listRepairItems(): RepairItem[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function saveRepairItems(items: RepairItem[]): void {
  cache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(items))
  }
}
