import { defineStore } from 'pinia'

import type { InspectionFilter } from '@/data/types'

// 巡检记录 → 遥测设备入口的联动上下文，以及返回巡检列表时要保留的筛选条件。
export const EMPTY_INSPECTION_FILTER: InspectionFilter = {
  巡检日期: '',
  巡检人员: '',
  发现问题: '',
  onlyPending: false,
}

export const useInspectionLinkStore = defineStore('inspectionLink', {
  state: () => ({
    // 从故障巡检跳到设备页时携带的站点编号
    pendingStation: '',
    // 设备页顶部提示用的故障上下文
    pendingRecordNo: '',
    pendingProblem: '',
    // 返回巡检列表时恢复的筛选
    returnFilter: { ...EMPTY_INSPECTION_FILTER } as InspectionFilter,
  }),
  actions: {
    startDeviceLink(
      station: string,
      recordNo: string,
      problem: string,
      returnFilter: InspectionFilter,
    ) {
      this.pendingStation = station
      this.pendingRecordNo = recordNo
      this.pendingProblem = problem
      this.returnFilter = { ...returnFilter }
    },
    clearDeviceLink() {
      this.pendingStation = ''
      this.pendingRecordNo = ''
      this.pendingProblem = ''
    },
    saveReturnFilter(filter: InspectionFilter) {
      this.returnFilter = { ...filter }
    },
  },
})
