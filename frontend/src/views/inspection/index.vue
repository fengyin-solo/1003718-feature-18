<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检记录管理</h2>
        <p class="page-desc">
          沿巡检动作与站点取数链路联合定位：巡检日期、巡检人员、发现问题与待处置故障可组合筛选；
          同站同人同日的重复登记按合并口径展示，旧日期格式自动归一。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记巡检记录</button>
        <button class="btn" type="button" @click="exportRows">导出巡检记录清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article
        v-for="item in statCards"
        :key="item.label"
        class="stat-card"
        :class="{ clickable: item.clickable, active: item.clickable && onlyPendingFaults }"
        @click="item.clickable && toggleOnlyPending()"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span v-if="mergedCount" class="legend-item merge-legend">已合并重复记录：{{ mergedCount }} 条底层登记</span>
    </p>

    <form class="filter-bar" @submit.prevent="applySearch">
      <label class="filter-item">
        <span>站点（编号 / 名称联动）</span>
        <input v-model="draftFilters.站点" list="inspection-stations" placeholder="按站点编号或名称检索" />
        <datalist id="inspection-stations">
          <option v-for="station in stationOptions" :key="station.站点编号" :value="station.站点编号">
            {{ station.站点名称 }}
          </option>
        </datalist>
      </label>
      <label class="filter-item">
        <span>巡检日期（兼容旧格式）</span>
        <input v-model="draftFilters.巡检日期" placeholder="如 2026-10-01 / 26/10/1 / 20261001" />
      </label>
      <label class="filter-item">
        <span>巡检人员</span>
        <input v-model="draftFilters.巡检人员" list="inspection-inspectors" placeholder="按巡检人员检索" />
        <datalist id="inspection-inspectors">
          <option v-for="name in inspectorOptions" :key="name" :value="name" />
        </datalist>
      </label>
      <label class="filter-item">
        <span>发现问题 / 待处置故障</span>
        <input v-model="draftFilters.发现问题" placeholder="按发现问题关键词检索" />
      </label>
      <button class="btn" type="submit">联合查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <label class="filter-check">
        <input v-model="onlyPendingFaults" type="checkbox" @change="persistAndReload" />
        只看待处置故障
      </label>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="row.key">
          <td>
            {{ row.recordCodes.join('、') }}
            <span v-if="row.mergedCount > 1" class="merge-badge" :title="`已合并 ${row.mergedCount} 条重复登记`">
              合并{{ row.mergedCount }}
            </span>
          </td>
          <td>{{ row.站点编号 }}<span v-if="row.站点名称" class="sub-text">（{{ row.站点名称 }}）</span></td>
          <td>{{ row.巡检日期 }}</td>
          <td>{{ row.巡检人员 }}</td>
          <td>{{ row.检查项目 || '—' }}</td>
          <td>{{ row.发现问题 || '—' }}</td>
          <td>{{ row.处理措施 || '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="hasRepair(row)" class="linked-badge">已建检修事项</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busyKey === String(groupKey(index)) || (action === '新增检修事项' && row.status !== '发现故障')"
              :title="actionTip(action, row)"
              @click="runAction(action, index)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ onlyPendingFaults ? '当前筛选下没有待处置故障' : '暂无巡检记录数据，可先登记巡检记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条巡检记录（合并口径）</span>
      <span>
        当前身份：{{ session.operator }} · {{ session.role
        }}<span v-if="!session.canConfirmFault" class="perm-hint">（无故障处置权限，确认处置将被拒绝）</span>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  downloadEntries,
  listEntries,
  listInspection,
  moduleMeta,
  repairDraftFromInspection,
  runActionAsync,
} from '@/api/local-service'
import type { InspectionViewRow } from '@/data/inspection'
import { useFilterStore } from '@/stores/filters'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('inspection')
const columns = ['记录编号', '站点编号', '巡检日期', '巡检人员', '检查项目', '发现问题', '处理措施']
const actions = ['完成巡检', '报告故障', '确认处置', '新增检修事项']
const statuses = ['待巡检', '已巡检', '发现故障', '已处置']

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const filterStore = useFilterStore()

const rows = ref<InspectionViewRow[]>([])
const total = ref(0)
const stats = ref({ monthCount: 0, inspectedStations: 0, pendingFaults: 0 })
const errorMessage = ref('')
const successMessage = ref('')
const busyKey = ref('')

const saved = filterStore.stateOf(meta.key)
// 站点取数链路带参跳转（站点页「巡检定位」）只在首次进入时灌一次，不覆盖已保留的筛选。
const initialValues = { ...saved.values }
if (!Object.values(saved.values).some((value) => value.trim()) && typeof route.query.站点 === 'string') {
  initialValues.站点 = route.query.站点
}
const draftFilters = ref<Record<string, string>>({
  站点: initialValues.站点 ?? '',
  巡检日期: initialValues.巡检日期 ?? '',
  巡检人员: initialValues.巡检人员 ?? '',
  发现问题: initialValues.发现问题 ?? '',
})
const appliedFilters = ref<Record<string, string>>({ ...initialValues })
const onlyPendingFaults = ref(saved.onlyPendingFaults)

const stationOptions = computed(() =>
  listEntries('station').items.map((row) => ({
    站点编号: String(row['站点编号'] ?? ''),
    站点名称: String(row['站点名称'] ?? ''),
  })),
)
const inspectorOptions = computed(() => [...new Set(rows.value.map((row) => row.巡检人员).filter(Boolean))])

const repairSources = computed(() => {
  const set = new Set<string>()
  for (const item of listEntries('repair').items) {
    if (String(item.status) === '已完成') {
      continue
    }
    String(item['来源巡检记录'] ?? '')
      .split(/[、,，]/)
      .map((code) => code.trim())
      .filter(Boolean)
      .forEach((code) => set.add(code))
  }
  return set
})

const mergedCount = computed(() => rows.value.reduce((sum, row) => sum + row.mergedCount, 0) - rows.value.length)

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

const statCards = computed(() => [
  { label: '本月巡检次数', value: stats.value.monthCount, clickable: false },
  { label: '已巡检站点', value: stats.value.inspectedStations, clickable: false },
  { label: '待处置故障', value: stats.value.pendingFaults, clickable: true },
])

function groupKey(index: number): number {
  // 合并组用负序号编码，与底层记录 id 区分；并发锁按组生效。
  return -(index + 1)
}

function hasRepair(row: InspectionViewRow): boolean {
  return row.recordCodes.some((code) => repairSources.value.has(code))
}

function actionTip(action: string, row: InspectionViewRow): string {
  if (action === '新增检修事项') {
    return row.status === '发现故障' ? '联动登记检修事项' : '只有发现故障的巡检记录可以联动检修事项'
  }
  if (action === '确认处置' && !session.canConfirmFault) {
    return '当前身份没有故障处置权限，执行将被拒绝'
  }
  return action
}

function persistFilters() {
  filterStore.setValues(meta.key, appliedFilters.value)
  filterStore.setOnlyPendingFaults(meta.key, onlyPendingFaults.value)
}

function persistAndReload() {
  applySearch()
}

function applySearch() {
  appliedFilters.value = { ...draftFilters.value }
  persistFilters()
  reload()
}

function resetFilters() {
  draftFilters.value = { 站点: '', 巡检日期: '', 巡检人员: '', 发现问题: '' }
  appliedFilters.value = { ...draftFilters.value }
  onlyPendingFaults.value = false
  filterStore.reset(meta.key)
  reload()
}

function toggleOnlyPending() {
  onlyPendingFaults.value = !onlyPendingFaults.value
  persistFilters()
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '巡检记录登记入口尚未接入审批流'
}

async function runAction(action: string, index: number) {
  errorMessage.value = ''
  successMessage.value = ''
  const id = groupKey(index)

  if (action === '新增检修事项') {
    const draft = repairDraftFromInspection(id)
    if (!draft) {
      errorMessage.value = '没有找到对应的巡检故障记录'
      return
    }
    // 进入设备入口/检修事项页：当前筛选已落在 filterStore，返回后自动还原。
    persistFilters()
    router.push({
      path: '/repair',
      query: { from: 'inspection', group: String(id), station: draft.所属站点, source: draft.来源巡检记录 },
    })
    return
  }

  busyKey.value = String(id)
  try {
    const result = await runActionAsync(
      meta.key,
      id,
      action,
      { operator: session.operator, roles: session.roles },
    )
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    successMessage.value = result.message
    reload()
  } finally {
    busyKey.value = ''
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listInspection(appliedFilters.value, onlyPendingFaults.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = payload.stats
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '巡检记录列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.stat-card.clickable {
  cursor: pointer;
  border-color: var(--brand);
}
.stat-card.active {
  box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.25);
}
.sub-text {
  color: var(--muted);
  font-size: 12px;
}
.merge-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: #e8f0fe;
  color: var(--brand);
  font-size: 12px;
}
.merge-legend {
  background: #e8f0fe;
  color: var(--brand);
}
.linked-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: #e7f6ec;
  color: #147d3c;
  font-size: 12px;
}
.filter-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  white-space: nowrap;
  padding-bottom: 6px;
}
.success-text {
  color: #147d3c;
}
.perm-hint {
  color: #b42318;
}
.link:disabled {
  color: #9aa4b2;
  cursor: not-allowed;
}
</style>
