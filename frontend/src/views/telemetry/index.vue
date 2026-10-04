<template>
  <section class="page" data-module="telemetry">
    <header class="page-head">
      <div>
        <h2>遥测设备管理</h2>
        <p class="page-desc">维护遥测设备，围绕设备编号、设备类型、所属站点、通讯方式做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button v-if="fromInspection" class="btn primary" type="button" @click="backToInspection">
          返回巡检记录（保留筛选）
        </button>
        <button class="btn primary" type="button" @click="openCreate">登记遥测设备</button>
        <button class="btn" type="button" @click="exportRows">导出遥测设备清单</button>
      </div>
    </header>

    <div v-if="fromInspection" class="link-banner">
      <strong>巡检联动：</strong>
      <template v-if="linkStore.pendingRecordNo">
        巡检记录 {{ linkStore.pendingRecordNo }} 在站点
        <em>{{ linkStore.pendingStation }}</em> 发现故障——{{ linkStore.pendingProblem || '（未填写具体问题）' }}。
        请在该站点设备上「新增检修事项」。
      </template>
      <template v-else>
        已定位到站点 <em>{{ linkStore.pendingStation }}</em> 的设备，可直接登记检修事项。
      </template>
    </div>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>检修事项</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <button class="link" type="button" @click="openRepairs(row)">查看检修单</button>
            <span v-if="repairCount(String(row['设备编号']))" class="cell-sub">
              已登记 {{ repairCount(String(row['设备编号'])) }} 项
            </span>
          </td>
          <td class="row-actions">
            <template v-if="fromInspection">
              <button
                class="link link-strong"
                type="button"
                :disabled="busyDeviceId === Number(row.id)"
                @click="addRepair(row)"
              >
                {{ busyDeviceId === Number(row.id) ? '提交中…' : '新增检修事项' }}
              </button>
              <button class="link" type="button" @click="applyActionAndReload('报修设备', row)">报修设备</button>
            </template>
            <template v-else>
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="applyActionAndReload(action, row)"
              >
                {{ action }}
              </button>
            </template>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            {{ fromInspection && filters['所属站点'] ? `站点 ${filters['所属站点']} 下暂无遥测设备` : '暂无遥测设备数据，可先登记遥测设备' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条遥测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { createRepairFromInspection, repairItemsForDevice } from '@/api/inspection-service'
import { listRepairItems } from '@/data/repair-store'
import type { EntryRow } from '@/data/types'
import { useInspectionLinkStore } from '@/stores/inspection-link'

const meta = moduleMeta('telemetry')
const router = useRouter()
const route = useRoute()
const linkStore = useInspectionLinkStore()

const columns = ['设备编号', '设备类型', '所属站点', '通讯方式', '安装日期', '最近维护日', '电池余量', '设备状态']
const actions = ['报修设备', '确认修复', '停用设备']
const statuses = ['正常运行', '信号异常', '低电量', '待维修', '已停用']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const busyDeviceId = ref<number | null>(null)
// 从巡检故障联动进来：路由带 station 即成立，横幅文案再看是否带具体故障记录。
const fromInspection = ref(false)

const allDevices = computed(() => listEntries(meta.key).items)
const stats = computed(() => [
  { label: '设备总数', value: allDevices.value.length },
  { label: '正常运行数', value: allDevices.value.filter((row) => String(row.status) === '正常运行').length },
  { label: '待维修数', value: allDevices.value.filter((row) => String(row.status) === '待维修').length },
])
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allDevices.value.filter((row) => String(row.status) === status).length,
  })),
)

function repairCount(deviceNo: string): number {
  return listRepairItems().filter((item) => item.设备编号 === deviceNo).length
}

function resetFilters() {
  filters.value = fromInspection.value ? { 所属站点: linkStore.pendingStation } : {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '遥测设备登记入口尚未接入审批流'
}

function applyActionAndReload(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

/** 联动新增检修事项：服务端按设备+来源故障记录幂等，在途再上一道锁，并发只会生成一张检修单。 */
async function addRepair(row: EntryRow) {
  if (busyDeviceId.value !== null) {
    return
  }
  busyDeviceId.value = Number(row.id)
  try {
    await Promise.resolve()
    const result = createRepairFromInspection(
      Number(row.id),
      linkStore.pendingRecordNo,
      linkStore.pendingProblem,
    )
    errorMessage.value = ''
    window.alert(result.message)
    reload()
  } finally {
    busyDeviceId.value = null
  }
}

function openRepairs(row: EntryRow) {
  const items = repairItemsForDevice(String(row['设备编号']))
  if (!items.length) {
    window.alert(`设备 ${row['设备编号']} 暂无检修事项`)
    return
  }
  window.alert(
    items
      .map((item) => `${item.报修时间}｜${item.检修事项}｜${item.状态}\n问题：${item.发现问题 || '—'}\n来源：${item.来源记录编号 || '手工登记'}`)
      .join('\n\n'),
  )
}

/** 返回巡检记录：把巡检侧的筛选条件原样带回。 */
function backToInspection() {
  const saved = linkStore.returnFilter
  router.push({
    name: 'inspection',
    query: {
      from: 'device',
      date: saved.巡检日期,
      staff: saved.巡检人员,
      problem: saved.发现问题,
      pending: saved.onlyPending ? '1' : '',
    },
  })
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遥测设备列表读取失败'
  }
}

onMounted(() => {
  const station = String(route.query.station ?? '')
  fromInspection.value = String(route.query.from ?? '') === 'inspection' && station.length > 0
  if (fromInspection.value) {
    // 联动入口：自动带上站点筛选，顺着巡检记录把该站设备定位出来。
    linkStore.pendingStation = station
    filters.value = { 所属站点: station }
  }
  reload()
})
</script>

<style scoped>
.link-banner { margin-bottom: 12px; padding: 10px 14px; background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; font-size: 13px; color: #9a3412; }
.link-banner em { font-style: normal; font-weight: 600; }
.cell-sub { display: block; font-size: 11px; color: var(--muted); }
.link-strong { font-weight: 600; }
button.link:disabled { color: #9aa6b2; cursor: not-allowed; }
</style>
