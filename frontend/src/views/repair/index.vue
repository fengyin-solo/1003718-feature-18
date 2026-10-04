<template>
  <section class="page" data-module="repair">
    <header class="page-head">
      <div>
        <h2>检修事项管理</h2>
        <p class="page-desc">
          巡检故障与遥测设备入口联动登记检修事项；同一故障重复登记只生效一次，处理闭环后回写巡检待处置故障。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回（保留筛选）</button>
        <button class="btn primary" type="button" @click="openCreate()">登记检修事项</button>
        <button class="btn" type="button" @click="exportRows">导出检修事项清单</button>
      </div>
    </header>

    <p v-if="entryHint" class="entry-banner">{{ entryHint }}</p>

    <div v-if="showForm" class="create-panel">
      <h3>登记检修事项</h3>
      <form class="create-form" @submit.prevent="submitCreate">
        <label>
          <span>设备编号</span>
          <input v-model="form.设备编号" list="repair-devices" placeholder="联动自设备入口，可手工补充" />
          <datalist id="repair-devices">
            <option v-for="device in deviceOptions" :key="device.id" :value="device.code">
              {{ device.station }} · {{ device.type }}
            </option>
          </datalist>
        </label>
        <label>
          <span>所属站点</span>
          <input v-model="form.所属站点" list="repair-stations" required />
          <datalist id="repair-stations">
            <option v-for="station in stationOptions" :key="station" :value="station" />
          </datalist>
        </label>
        <label class="wide">
          <span>故障描述</span>
          <textarea v-model="form.故障描述" rows="2" required placeholder="描述故障现象与现场处置情况" />
        </label>
        <label>
          <span>来源巡检记录</span>
          <input v-model="form.来源巡检记录" list="repair-sources" placeholder="联动自待处置故障，可留空" />
          <datalist id="repair-sources">
            <option v-for="code in pendingFaultCodes" :key="code" :value="code" />
          </datalist>
        </label>
        <label>
          <span>检修人员</span>
          <input v-model="form.检修人员" required placeholder="如 设备班·孙磊" />
        </label>
        <label>
          <span>登记日期</span>
          <input v-model="form.登记日期" required type="date" />
        </label>
        <div class="form-actions wide">
          <button class="btn primary" type="submit" :disabled="submitting">
            {{ submitting ? '提交中…' : '提交登记' }}
          </button>
          <button class="btn ghost" type="button" :disabled="submitting" @click="cancelCreate">取消</button>
          <span v-if="formError" class="error-text">{{ formError }}</span>
          <span v-if="formSuccess" class="success-text">{{ formSuccess }}</span>
        </div>
      </form>
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

    <form class="filter-bar" @submit.prevent="applySearch">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="draftFilters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
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
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busyId === Number(row.id)"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无检修事项，可由巡检故障或设备入口联动登记</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条检修事项记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  createRepair,
  downloadEntries,
  listEntries,
  moduleMeta,
  repairDraftFromDevice,
  repairDraftFromInspection,
  runActionAsync,
} from '@/api/local-service'
import type { EntryRow, RepairDraft } from '@/data/types'
import { useFilterStore } from '@/stores/filters'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('repair')
const columns = ['事项编号', '设备编号', '所属站点', '故障描述', '来源巡检记录', '检修人员', '登记日期']
const actions = ['安排检修', '开始检修', '完成检修']
const statuses = ['待安排', '已安排', '检修中', '已完成']
const filterFields = ['所属站点', '设备编号', '来源巡检记录']

const MODULE_KEY = meta.key

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const filterStore = useFilterStore()

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const busyId = ref<number | null>(null)

const saved = filterStore.stateOf(MODULE_KEY)
const draftFilters = ref<Record<string, string>>({ ...saved.values })
const appliedFilters = ref<Record<string, string>>({ ...saved.values })

const showForm = ref(false)
const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')
const emptyForm = (): RepairDraft => ({
  设备编号: '',
  所属站点: '',
  故障描述: '',
  来源巡检记录: '',
  检修人员: '',
  登记日期: new Date().toISOString().slice(0, 10),
})
const form = ref<RepairDraft>(emptyForm())

const entryHint = ref('')

const stationOptions = computed(() =>
  listEntries('station').items.map((row) => String(row['站点编号'] ?? '')).filter(Boolean),
)
const deviceOptions = computed(() =>
  listEntries('telemetry').items.map((row) => ({
    id: Number(row.id),
    code: String(row['设备编号'] ?? ''),
    station: String(row['所属站点'] ?? ''),
    type: String(row['设备类型'] ?? ''),
  })),
)
const pendingFaultCodes = computed(() => {
  // 待处置故障的记录编号来自巡检合并视图，通过来源字段反查。
  return listEntries('inspection')
    .items.filter((row) => String(row.status) === '发现故障')
    .map((row) => String(row['记录编号'] ?? ''))
    .filter(Boolean)
})

const stats = computed(() => [
  { label: '检修事项总数', value: listEntries(MODULE_KEY).total },
  { label: '待安排', value: listEntries(MODULE_KEY).items.filter((row) => String(row.status) === '待安排').length },
  { label: '检修中', value: listEntries(MODULE_KEY).items.filter((row) => String(row.status) === '检修中').length },
])

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function applySearch() {
  appliedFilters.value = { ...draftFilters.value }
  filterStore.setValues(MODULE_KEY, appliedFilters.value)
  reload()
}

function resetFilters() {
  draftFilters.value = {}
  appliedFilters.value = {}
  filterStore.reset(MODULE_KEY)
  reload()
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function openCreate(draft?: RepairDraft) {
  form.value = draft ? { ...emptyForm(), ...draft } : emptyForm()
  formError.value = ''
  formSuccess.value = ''
  showForm.value = true
}

function cancelCreate() {
  showForm.value = false
}

async function submitCreate() {
  formError.value = ''
  formSuccess.value = ''
  submitting.value = true
  try {
    const result = await createRepair(form.value)
    if (!result.ok) {
      formError.value = result.message
      return
    }
    formSuccess.value = result.message
    showForm.value = false
    reload()
  } finally {
    submitting.value = false
  }
}

async function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  busyId.value = Number(row.id)
  try {
    const result = await runActionAsync(
      MODULE_KEY,
      Number(row.id),
      action,
      { operator: session.operator, roles: session.roles },
    )
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  } finally {
    busyId.value = null
  }
}

function goBack() {
  // 返回来源页：该页筛选已落在 filterStore，返回时自动还原。
  if (typeof route.query.from === 'string') {
    router.push({ path: route.query.from === 'telemetry' ? '/telemetry' : '/inspection' })
    return
  }
  router.push('/inspection')
}

function consumeEntry(): void {
  const from = typeof route.query.from === 'string' ? route.query.from : ''
  const deviceId = Number(route.query.device ?? NaN)
  const group = Number(route.query.group ?? NaN)

  let draft: RepairDraft | null = null
  if (from === 'telemetry' && Number.isFinite(deviceId)) {
    draft = repairDraftFromDevice(deviceId)
    entryHint.value = draft
      ? `已从设备入口带入 ${draft.设备编号}（${draft.所属站点}）${draft.来源巡检记录 ? `，并挂接待处置故障 ${draft.来源巡检记录}` : '，本站点暂无待处置巡检故障'}。`
      : ''
  } else if (from === 'inspection' && Number.isFinite(group)) {
    draft = repairDraftFromInspection(group)
    entryHint.value = draft ? `已从巡检故障带入：${draft.来源巡检记录}（${draft.所属站点}），请补充设备与检修人员。` : ''
  }
  if (draft) {
    openCreate(draft)
  }
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(MODULE_KEY, appliedFilters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '检修事项列表读取失败'
  }
}

onMounted(() => {
  reload()
  consumeEntry()
})
</script>

<style scoped>
.entry-banner {
  background: #e8f0fe;
  border: 1px solid #b9d2fb;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  color: #1d4f9e;
  margin: 0 0 12px;
}
.create-panel {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.create-panel h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.create-form {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 12px;
}
.create-form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--muted);
}
.create-form .wide {
  grid-column: 1 / -1;
}
.create-form input,
.create-form textarea {
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: #1f2937;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.success-text {
  color: #147d3c;
}
.link:disabled {
  color: #9aa4b2;
  cursor: not-allowed;
}
</style>
