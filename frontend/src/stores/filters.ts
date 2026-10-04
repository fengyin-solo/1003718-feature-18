import { defineStore } from 'pinia'

// 跨页面返回后保留筛选：巡检 -> 检修事项 -> 返回，以及设备入口联动返回都能还原原列表。
export type FilterState = {
  values: Record<string, string>
  onlyPendingFaults: boolean
}

function emptyState(): FilterState {
  return { values: {}, onlyPendingFaults: false }
}

export const useFilterStore = defineStore('filters', {
  state: () => ({
    byModule: {} as Record<string, FilterState>,
  }),
  getters: {
    stateOf: (state) => (key: string): FilterState => state.byModule[key] ?? emptyState(),
  },
  actions: {
    ensure(key: string): FilterState {
      if (!this.byModule[key]) {
        this.byModule[key] = emptyState()
      }
      return this.byModule[key]
    },
    setValues(key: string, values: Record<string, string>) {
      this.ensure(key).values = { ...values }
    },
    setOnlyPendingFaults(key: string, value: boolean) {
      this.ensure(key).onlyPendingFaults = value
    },
    reset(key: string) {
      this.byModule[key] = emptyState()
    },
  },
})
