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

async function api(path) {
  const res = await fetch(API + path, { credentials: "include" });
  if (!res.ok) throw new Error(res.status + " " + path);
  return res.json();
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
          text: "등록된 디바이스가 없습니다",
        })],
      });
      tr.firstChild.colSpan = 10;
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
