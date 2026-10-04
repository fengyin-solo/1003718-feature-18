import { defineStore } from 'pinia'

// 巡检处置的越权校验用「身份 + 角色」：值班管理员可处置全部，巡检人员只能处置本人发现的故障。
type OperatorPreset = { name: string; role: string }

export const OPERATOR_PRESETS: OperatorPreset[] = [
  { name: '值班管理员', role: '值班管理员' },
  { name: '李伟', role: '巡检人员' },
  { name: '王芳', role: '巡检人员' },
  { name: '周强', role: '巡检人员' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    operatorRole: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '水文监测站网管理系统',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    switchOperator(name: string) {
      const preset = OPERATOR_PRESETS.find((item) => item.name === name) ?? OPERATOR_PRESETS[0]
      this.operator = preset.name
      this.operatorRole = preset.role
    },
  },
})
