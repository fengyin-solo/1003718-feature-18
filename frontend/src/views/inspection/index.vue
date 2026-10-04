<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">
          围绕巡检日期、巡检人员、发现问题联合定位巡检记录，可切换只看待处置故障；
          同站点同日期的重复登记自动合并，故障可联动遥测设备登记检修事项。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

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
      <label class="filter-item">
        <span>巡检日期</span>
        <input v-model="filters.巡检日期" placeholder="如 2026-10 或 2026-10-02" />
      </label>
      <label class="filter-item">
        <span>巡检人员</span>
        <input v-model="filters.巡检人员" placeholder="按巡检人员检索" />
      </label>
      <label class="filter-item filter-wide">
        <span>发现问题</span>
        <input v-model="filters.发现问题" placeholder="按发现问题关键词检索" />
      </label>
      <label class="filter-check">
        <input v-model="filters.onlyPending" type="checkbox" />
        <span>只看待处置故障</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="operator-bar">
      <label class="filter-item">
        <span>当前巡检身份（用于越权校验）</span>
        <select :value="session.operator" @change="switchOperator(($event.target as HTMLSelectElement).value)">
          <option v-for="preset in OPERATOR_PRESETS" :key="preset.name" :value="preset.name">
            {{ preset.name }}（{{ preset.role }}）
          </option>
        </select>
      </label>
      <span class="operator-tip">
        规则：仅「发现故障」的巡检人员本人或值班管理员可确认处置，其他身份越权处置将被拒绝。
      </span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>站点</th>
          <th>巡检日期</th>
          <th>巡检人员</th>
          <th>检查项目</th>
          <th>发现问题</th>
          <th>处理措施</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.memberIds.join('-')">
          <td>
            {{ row['记录编号'] }}
            <span v-if="row.merged" class="merge-badge" :title="`合并了 ${row.memberIds.length} 条重复登记：${row.memberIds.join('、')}`">
              合并{{ row.memberIds.length }}条
            </span>
          </td>
          <td>
            <button class="link" type="button" :title="`在遥测设备中查看站点 ${row['站点编号']}`" @click="openStationDevices(row)">
              {{ row['站点编号'] }}
            </button>
            <span class="cell-sub">{{ stationName(String(row['站点编号'])) || '—' }}</span>
          </td>
          <td>{{ row['巡检日期'] || '—' }}</td>
          <td>{{ row['巡检人员'] || '—' }}</td>
          <td>{{ row['检查项目'] || '—' }}</td>
          <td>{{ row['发现问题'] || '—' }}</td>
          <td>{{ row['处理措施'] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="row.status === '待巡检'">
              <button class="link" type="button" :disabled="busyId === row.memberIds.join('-')" @click="runAction('完成巡检', row)">
                完成巡检
              </button>
              <button class="link" type="button" :disabled="busyId === row.memberIds.join('-')" @click="runAction('报告故障', row)">
                报告故障
              </button>
            </template>
            <template v-else-if="row.status === '已巡检'">
              <button class="link" type="button" :disabled="busyId === row.memberIds.join('-')" @click="runAction('报告故障', row)">
                报告故障
              </button>
            </template>
            <template v-else-if="row.status === '发现故障'">
              <button
                class="link"
                type="button"
                :disabled="busyId === row.memberIds.join('-')"
                :title="canDisposeRow(row) ? '' : '当前身份无权处置（需本人或值班管理员）'"
                @click="runAction('确认处置', row)"
              >
                确认处置
              </button>
              <button class="link link-strong" type="button" @click="goDevices(row)">
                联动新增检修事项
              </button>
            </template>
            <span v-else class="cell-sub">流程已闭环</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">
            {{ filters.onlyPending ? '当前筛选下没有待处置故障' : '暂无符合条件的巡检记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录（重复登记已按同站点同日期合并）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  moduleMeta,
} from '@/api/local-service'
import {
  canDispose,
  inspectionStats,
  listInspection,
  runInspectionAction,
  type Operator,
} from '@/api/inspection-service'
import { listRows } from '@/data/local-store'
import type { InspectionFilter, InspectionRow } from '@/data/types'
import { useInspectionLinkStore, EMPTY_INSPECTION_FILTER } from '@/stores/inspection-link'
import { OPERATOR_PRESETS, useSessionStore } from '@/stores/session'

const meta = moduleMeta('inspection')
const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const linkStore = useInspectionLinkStore()

const statuses = ['待巡检', '已巡检', '发现故障', '已处置']
const rows = ref<InspectionRow[]>([])
const groups = ref<InspectionRow[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
// 某一组巡检动作在途时上锁：重复点击/并发确认在 UI 层先拦一道。
const busyId = ref('')
const filters = ref<InspectionFilter>({ ...EMPTY_INSPECTION_FILTER })

const stats = computed(() => inspectionStats(groups.value))
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: groups.value.filter((row) => row.status === status).length,
  })),
)

const stationMap = computed(() => {
  const map = new Map<string, string>()
  for (const station of listRows('station')) {
    map.set(String(station['站点编号'] ?? ''), String(station['站点名称'] ?? ''))
  }
  return map
})

function stationName(stationNo: string): string {
  return stationMap.value.get(stationNo) ?? ''
}

function canDisposeRow(row: InspectionRow): boolean {
  return canDispose(row, currentOperator())
}

function currentOperator(): Operator {
  return { name: session.operator, role: session.operatorRole }
}

function switchOperator(name: string) {
  session.switchOperator(name)
}

function notify(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function reload() {
  message.value = ''
  try {
    const payload = listInspection(filters.value)
    rows.value = payload.items
    groups.value = payload.groups
    total.value = payload.total
    // 筛选条件是返回巡检页时要恢复的状态，顺手存进联动 store。
    linkStore.saveReturnFilter(filters.value)
  } catch (error) {
    notify(false, error instanceof Error ? error.message : '巡检记录列表读取失败')
  }
}

function resetFilters() {
  filters.value = { ...EMPTY_INSPECTION_FILTER }
  router.replace({ name: 'inspection', query: {} })
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  notify(false, '巡检记录登记入口尚未接入审批流')
}

async function runAction(action: string, row: InspectionRow) {
  const groupKey = row.memberIds.join('-')
  if (busyId.value) {
    return
  }
  busyId.value = groupKey
  try {
    // 服务端以实时存储状态做 CAS 判定；这里刻意让出一帧，保证连点两次时第二次能读到已落库的新状态。
    await Promise.resolve()
    const result = runInspectionAction(row, action, currentOperator())
    notify(result.ok, result.message)
    if (result.ok) {
      reload()
    }
  } finally {
    busyId.value = ''
  }
}

/** 顺着「站点取数链路」跳到遥测设备：自动带站点筛选与故障上下文，返回时恢复当前筛选。 */
function goDevices(row: InspectionRow) {
  const station = String(row['站点编号'] ?? '')
  const recordNo = String(row['记录编号'] ?? '')
  const problem = String(row['发现问题'] ?? '')
  linkStore.startDeviceLink(station, recordNo, problem, filters.value)
  router.push({
    name: 'telemetry',
    query: {
      station,
      from: 'inspection',
      date: filters.value.巡检日期,
      staff: filters.value.巡检人员,
      problem: filters.value.发现问题,
      pending: filters.value.onlyPending ? '1' : '',
    },
  })
}

/** 从站点编号直接联动到设备（非故障记录也可看该站设备）。 */
function openStationDevices(row: InspectionRow) {
  linkStore.startDeviceLink(
    String(row['站点编号'] ?? ''),
    '',
    '',
    filters.value,
  )
  router.push({ name: 'telemetry', query: { station: String(row['站点编号'] ?? ''), from: 'inspection' } })
}

function restoreFiltersFromRoute() {
  // 从设备入口返回：优先用路由 query（整页刷新也在），缺失字段回退到联动 store 里的快照。
  const saved = linkStore.returnFilter
  const query = route.query
  filters.value = {
    巡检日期: typeof query.date === 'string' ? query.date : saved.巡检日期,
    巡检人员: typeof query.staff === 'string' ? query.staff : saved.巡检人员,
    发现问题: typeof query.problem === 'string' ? query.problem : saved.发现问题,
    onlyPending: query.pending === '1' || (!('pending' in query) && saved.onlyPending),
  }
}

onMounted(() => {
  if (route.name === 'inspection' && Object.keys(route.query).length > 0) {
    restoreFiltersFromRoute()
  }
  reload()
})
</script>

<style scoped>
.filter-wide { flex: 1.4; min-width: 200px; }
.filter-wide input,
.filter-item input,
.filter-item select { width: 100%; }
.filter-check { display: flex; align-items: center; gap: 6px; font-size: 13px; padding-bottom: 6px; white-space: nowrap; }
.operator-bar { display: flex; align-items: flex-end; gap: 16px; margin: 0 0 12px; padding: 8px 12px; background: #eef4ff; border: 1px solid #cdddff; border-radius: 8px; }
.operator-tip { font-size: 12px; color: #3d5a96; padding-bottom: 8px; }
.merge-badge { display: inline-block; margin-left: 6px; font-size: 11px; color: #92400e; background: #fef3c7; border-radius: 999px; padding: 1px 8px; }
.cell-sub { display: block; font-size: 11px; color: var(--muted); }
.link-strong { font-weight: 600; }
.ok-text { color: #15803d; }
button.link:disabled { color: #9aa6b2; cursor: not-allowed; }
</style>
