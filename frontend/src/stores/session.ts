import { defineStore } from 'pinia'

// 越权处置的口径：只有具备「故障处置」角色的运维主管可以确认处置，值班员只能上报。
export const ROLE_LABELS: { value: string; label: string }[] = [
  { value: '值班员', label: '值班员（仅巡检上报）' },
  { value: '运维主管', label: '运维主管（可确认处置）' },
]

export const FAULT_DISPOSE_ROLE = '故障处置'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    role: '值班员',
    roles: ['巡检上报'] as string[],
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    canConfirmFault: (state) => state.roles.includes(FAULT_DISPOSE_ROLE),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: string) {
      this.role = role
      this.roles = role === '运维主管' ? ['巡检上报', FAULT_DISPOSE_ROLE] : ['巡检上报']
    },
  },
})
