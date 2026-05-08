"use strict";

const API = "/admin/api";
const REFRESH_MS = 2000;
const MAX_LOG_ROWS = 100;

let lastMessageId = 0;
let allLogRows = [];
let activeFilter = "all";
let chart = null;

const $ = (sel) => document.querySelector(sel);

function el(tag, opts) {
  const e = document.createElement(tag);
  if (!opts) return e;
  if (opts.class) e.className = opts.class;
  if (opts.text != null) e.textContent = String(opts.text);
  if (opts.style) e.setAttribute("style", opts.style);
  if (opts.dataset) {
    for (const k of Object.keys(opts.dataset)) e.dataset[k] = opts.dataset[k];
  }
  if (opts.children) {
    for (const c of opts.children) {
      if (c) e.appendChild(c);
    }
  }
  return e;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("ko-KR", { hour12: false });
}

async function api(path, init) {
  const opts = { credentials: "include", ...(init || {}) };
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  }
  const res = await fetch(API + path, opts);
  let data = null;
  try { data = await res.json(); } catch (_) { /* ignore */ }
  if (!res.ok) {
    const msg = (data && data.error) || (res.status + " " + path);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- 통계 + 팀 카드 ----------

function tenantCard(t) {
  const live = Math.min(100, t.recentMessages5m * 2);
  const statRow = (label, value, alarm) => el("div", {
    class: "stat-row",
    children: [
      el("span", { class: "label", text: label }),
      el("span", { class: "value" + (alarm ? " alarm" : ""), text: value }),
    ],
  });
  return el("div", {
    class: "card tenant-card",
    children: [
      el("div", { class: "tenant-id", text: t.tenantId }),
      statRow("devices", t.deviceCount),
      statRow("report", t.messages.report.toLocaleString()),
      statRow("poweron", t.messages.poweron),
      statRow("emergency", t.messages.emergency, t.messages.emergency > 0),
      statRow("최근 5분", t.recentMessages5m),
      el("div", {
        class: "live-bar",
        children: [el("div", { class: "live-bar-fill", style: "width:" + live + "%" })],
      }),
    ],
  });
}

async function refreshStats() {
  try {
    const data = await api("/stats");
    $("#totalDevices").textContent = data.totals.devices;
    $("#totalMessages").textContent = data.totals.messages.toLocaleString();
    $("#totalEmergencies").textContent = data.totals.emergencies.toLocaleString();
    $("#recentMessages").textContent = data.totals.recentMessages5m.toLocaleString();

    const grid = $("#tenantGrid");
    clear(grid);
    for (const t of data.tenants) grid.appendChild(tenantCard(t));
    setHealth(true);
  } catch (e) {
    setHealth(false, e.message);
  }
}

// ---------- 디바이스 테이블 ----------

function deviceRow(r) {
  const td = (val, mono) => el("td", { class: mono ? "mono" : "", text: val == null ? "—" : String(val) });

  const editBtn = el("button", { class: "btn-icon", text: "수정" });
  editBtn.addEventListener("click", () => openEditModal(r));

  const delBtn = el("button", { class: "btn-icon danger", text: "삭제" });
  delBtn.addEventListener("click", () => confirmDeleteDevice(r));

  const actionsTd = el("td", {
    class: "td-actions",
    children: [editBtn, delBtn],
  });

  return el("tr", {
    children: [
      td(r.tenantId, true),
      td(r.deviceId, true),
      td(r.modelName),
      td(r.intervalMs + "ms", true),
      td(r.battery != null ? Number(r.battery).toFixed(1) + "%" : null, true),
      td(r.stepCount, true),
      td(r.lmaCount, true),
      td(r.calories != null ? Number(r.calories).toFixed(1) : null, true),
      td(r.usageTimeSeconds, true),
      td(r.updatedAt ? fmtTime(r.updatedAt) : null, true),
      actionsTd,
    ],
  });
}

async function refreshDevices() {
  try {
    const rows = await api("/devices");
    const tbody = $("#deviceTable tbody");
    clear(tbody);
    if (!rows.length) {
      const tr = el("tr", {
        children: [el("td", {
          class: "empty",
          text: "등록된 디바이스가 없습니다 — '+ 디바이스 추가'로 만들어보세요",
        })],
      });
      tr.firstChild.colSpan = 11;
      tbody.appendChild(tr);
      return;
    }
    for (const r of rows) tbody.appendChild(deviceRow(r));
  } catch (_) { /* skip transient */ }
}

// ---------- 메세지 로그 ----------

function logRow(r) {
  return el("div", {
    class: "log-row" + (r.isNew ? " new" : ""),
    children: [
      el("span", { class: "col-time", text: fmtTime(r.publishedAt) }),
      el("span", { class: "col-tenant", text: r.tenantId }),
      el("span", { class: "col-type " + r.type, text: r.type }),
      el("span", { class: "col-device", text: r.deviceId }),
    ],
  });
}

function renderLogs() {
  const list = $("#logList");
  clear(list);
  let filtered = allLogRows;
  if (activeFilter !== "all") {
    filtered = allLogRows.filter((r) => r.type === activeFilter || r.tenantId === activeFilter);
  }
  filtered = filtered.slice(0, MAX_LOG_ROWS);
  if (!filtered.length) {
    list.appendChild(el("div", { class: "empty", text: "표시할 메세지가 없습니다" }));
    return;
  }
  for (const r of filtered) list.appendChild(logRow(r));
}

async function refreshMessages() {
  try {
    const rows = await api("/messages?afterId=" + lastMessageId + "&limit=100");
    if (!rows.length) return;
    lastMessageId = rows[0].id;
    for (const r of rows) {
      r.isNew = true;
      allLogRows.unshift(r);
    }
    if (allLogRows.length > 500) allLogRows.length = 500;
    renderLogs();
    setTimeout(() => { allLogRows.forEach((r) => { r.isNew = false; }); }, 800);
  } catch (_) { /* skip */ }
}

// ---------- 응급 이벤트 ----------

function emergencyRow(r) {
  return el("div", {
    class: "emergency-row",
    children: [
      el("span", { class: "e-time", text: fmtTime(r.publishedAt) }),
      el("span", { class: "e-tenant", text: r.tenantId }),
      el("span", { class: "e-device", text: r.deviceId }),
      el("span", { class: "e-label", text: "🚨 " + r.emergencyLabel }),
      el("span", {
        class: "e-gps",
        text: Number(r.gpsLatitude).toFixed(4) + ", " + Number(r.gpsLongitude).toFixed(4),
      }),
    ],
  });
}

async function refreshEmergencies() {
  try {
    const rows = await api("/emergencies?limit=20");
    const list = $("#emergencyList");
    clear(list);
    if (!rows.length) {
      list.appendChild(el("div", { class: "empty", text: "최근 응급 이벤트가 없습니다" }));
      return;
    }
    for (const r of rows) list.appendChild(emergencyRow(r));
  } catch (_) { /* skip */ }
}

// ---------- 시계열 차트 ----------

async function refreshChart() {
  try {
    const rows = await api("/timeseries?minutes=60");
    const buckets = {};
    for (const r of rows) {
      if (!buckets[r.bucket]) buckets[r.bucket] = { report: 0, poweron: 0, emergency: 0 };
      buckets[r.bucket][r.type] = r.count;
    }
    const labels = Object.keys(buckets).sort();
    const labelsShort = labels.map((l) => l.slice(11, 16));
    const seriesOf = (key) => labels.map((l) => buckets[l][key] || 0);

    if (chart) {
      chart.data.labels = labelsShort;
      chart.data.datasets[0].data = seriesOf("report");
      chart.data.datasets[1].data = seriesOf("poweron");
      chart.data.datasets[2].data = seriesOf("emergency");
      chart.update("none");
      return;
    }

    chart = new Chart($("#tsChart"), {
      type: "line",
      data: {
        labels: labelsShort,
        datasets: [
          { label: "report",    data: seriesOf("report"),    borderColor: "#34d399", tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: "poweron",   data: seriesOf("poweron"),   borderColor: "#a78bfa", tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: "emergency", data: seriesOf("emergency"), borderColor: "#f87171", tension: 0.25, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { color: "#1e293b" }, ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 11 } } },
          y: { grid: { color: "#1e293b" }, ticks: { color: "#64748b", font: { family: "JetBrains Mono", size: 11 } }, beginAtZero: true },
        },
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { family: "JetBrains Mono", size: 11 } } },
          tooltip: { backgroundColor: "#0d1220", borderColor: "#1e293b", borderWidth: 1 },
        },
      },
    });
  } catch (_) { /* skip */ }
}

// ---------- 헬스 표시 ----------

function setHealth(ok, msg) {
  const pill = $("#healthPill");
  pill.className = "pill " + (ok ? "pill-ok" : "pill-err");
  pill.textContent = ok ? "● 정상" : "● 오류" + (msg ? " — " + msg : "");
  $("#lastUpdate").textContent = fmtTime(new Date()) + " 업데이트";
}

// ---------- 필터 ----------

$("#logFilters").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  document.querySelectorAll("#logFilters button").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  activeFilter = b.dataset.filter;
  renderLogs();
});

// ---------- 메인 루프 ----------

async function tick() {
  await Promise.all([
    refreshStats(),
    refreshDevices(),
    refreshMessages(),
    refreshEmergencies(),
    refreshChart(),
  ]);
}

tick();
setInterval(tick, REFRESH_MS);

// ========== 디바이스 CRUD ==========

const modal = $("#deviceModal");
const modalTitle = $("#modalTitle");
const modalSubmit = $("#modalSubmit");
const modalError = $("#modalError");
const modalForm = $("#deviceForm");
const fieldTenant = $("#fieldTenant");
const fieldDeviceId = $("#fieldDeviceId");
const fieldModelName = $("#fieldModelName");
const fieldIntervalMs = $("#fieldIntervalMs");

const confirmModal = $("#confirmModal");
const confirmTitle = $("#confirmTitle");
const confirmMessage = $("#confirmMessage");
const confirmOk = $("#confirmOk");
const confirmCancel = $("#confirmCancel");

let modalMode = "create"; // "create" | "edit"
let editTarget = null;
let presetTenants = ["tenant-1","tenant-2","tenant-3","tenant-4","tenant-5"];

async function loadPresetTenants() {
  try {
    const data = await api("/preset-tenants");
    if (data && Array.isArray(data.tenants) && data.tenants.length) {
      presetTenants = data.tenants;
    }
  } catch (_) { /* fallback to default */ }
  clear(fieldTenant);
  for (const t of presetTenants) {
    fieldTenant.appendChild(el("option", { text: t }));
  }
}
loadPresetTenants();

function showError(msg) {
  modalError.textContent = msg;
  modalError.hidden = false;
}
function clearError() {
  modalError.textContent = "";
  modalError.hidden = true;
}

function openCreateModal() {
  modalMode = "create";
  editTarget = null;
  modalTitle.textContent = "디바이스 추가";
  modalSubmit.textContent = "추가";
  fieldTenant.disabled = false;
  fieldDeviceId.readOnly = false;
  fieldDeviceId.value = "";
  fieldModelName.value = "WF100";
  fieldIntervalMs.value = "5000";
  fieldTenant.value = presetTenants[0];
  clearError();
  modal.hidden = false;
  setTimeout(() => fieldDeviceId.focus(), 50);
}

function openEditModal(device) {
  modalMode = "edit";
  editTarget = { tenantId: device.tenantId, deviceId: device.deviceId };
  modalTitle.textContent = "디바이스 수정";
  modalSubmit.textContent = "저장";
  fieldTenant.value = device.tenantId;
  fieldTenant.disabled = true;
  fieldDeviceId.value = device.deviceId;
  fieldDeviceId.readOnly = true;
  fieldModelName.value = device.modelName || "WF100";
  fieldIntervalMs.value = device.intervalMs || 5000;
  clearError();
  modal.hidden = false;
  setTimeout(() => fieldIntervalMs.focus(), 50);
}

function closeModal() {
  modal.hidden = true;
  clearError();
}

$("#btnAddDevice").addEventListener("click", openCreateModal);
$("#modalClose").addEventListener("click", closeModal);
$("#modalCancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  modalSubmit.disabled = true;
  try {
    if (modalMode === "create") {
      await api("/devices", {
        method: "POST",
        body: {
          tenantId: fieldTenant.value,
          deviceId: fieldDeviceId.value.trim(),
          modelName: fieldModelName.value.trim() || "WF100",
          intervalMs: Number(fieldIntervalMs.value),
        },
      });
      toast("success", "디바이스 추가됨: " + fieldDeviceId.value.trim());
    } else {
      await api(`/devices/${encodeURIComponent(editTarget.tenantId)}/${encodeURIComponent(editTarget.deviceId)}`, {
        method: "PATCH",
        body: {
          modelName: fieldModelName.value.trim() || "WF100",
          intervalMs: Number(fieldIntervalMs.value),
        },
      });
      toast("success", "디바이스 갱신됨: " + editTarget.deviceId);
    }
    closeModal();
    await refreshDevices();
    await refreshStats();
  } catch (err) {
    showError(err.message);
  } finally {
    modalSubmit.disabled = false;
  }
});

// 확인 모달
let confirmHandler = null;
function openConfirm(title, message, onOk) {
  confirmTitle.textContent = title;
  clear(confirmMessage);
  for (const part of message) {
    if (typeof part === "string") confirmMessage.appendChild(document.createTextNode(part));
    else confirmMessage.appendChild(part);
  }
  confirmHandler = onOk;
  confirmModal.hidden = false;
}
function closeConfirm() {
  confirmModal.hidden = true;
  confirmHandler = null;
}
confirmCancel.addEventListener("click", closeConfirm);
confirmModal.addEventListener("click", (e) => { if (e.target === confirmModal) closeConfirm(); });
confirmOk.addEventListener("click", async () => {
  const fn = confirmHandler;
  closeConfirm();
  if (fn) await fn();
});

function confirmDeleteDevice(device) {
  openConfirm(
    "디바이스 삭제",
    [
      "다음 디바이스를 삭제합니다. 발행이 즉시 중단되고 누적 상태도 삭제됩니다.\n",
      el("br"),
      el("br"),
      el("span", { class: "target", text: `${device.tenantId} / ${device.deviceId}` }),
    ],
    async () => {
      try {
        await api(`/devices/${encodeURIComponent(device.tenantId)}/${encodeURIComponent(device.deviceId)}`, {
          method: "DELETE",
        });
        toast("success", "삭제됨: " + device.deviceId);
        await refreshDevices();
        await refreshStats();
      } catch (err) {
        toast("error", err.message);
      }
    }
  );
}

$("#btnDeleteAll").addEventListener("click", () => {
  openConfirm(
    "전체 디바이스 삭제",
    [
      "모든 테넌트의 모든 디바이스를 삭제합니다. 발행이 멈추고 학생들은 재등록이 필요합니다.\n",
      el("br"),
      el("br"),
      el("span", { class: "target", text: "되돌릴 수 없습니다." }),
    ],
    async () => {
      try {
        let total = 0;
        for (const t of presetTenants) {
          const r = await api(`/tenants/${encodeURIComponent(t)}/devices`, { method: "DELETE" });
          total += r.removedCount || 0;
        }
        toast("success", `전체 삭제 완료 (${total}개)`);
        await refreshDevices();
        await refreshStats();
      } catch (err) {
        toast("error", err.message);
      }
    }
  );
});

// ESC 닫기
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modal.hidden) closeModal();
    if (!confirmModal.hidden) closeConfirm();
  }
});

// 토스트
function toast(kind, text) {
  const stack = $("#toastStack");
  const t = el("div", { class: "toast " + (kind || ""), text });
  stack.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity 0.3s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 3000);
}
