const { pool } = require("./db");

const PRESET_TENANTS = ["tenant-1", "tenant-2", "tenant-3", "tenant-4", "tenant-5"];

const tenants = new Map();
PRESET_TENANTS.forEach((id) => tenants.set(id, new Map()));

// 디바이스별 시뮬레이션 상태 (interval ID, 누적값 등) — 메모리 + DB 미러링
const deviceStates = new Map();

// --- 메모리 헬퍼 ---

function getTenant(tenantId) {
  return tenants.get(tenantId);
}

function getAllTenants() {
  const result = [];
  for (const [tenantId, devices] of tenants) {
    result.push({
      tenantId,
      deviceCount: devices.size,
      devices: Array.from(devices.keys()),
    });
  }
  return result;
}

function addDevice(tenantId, device) {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  tenant.set(device.deviceId, device);
  return device;
}

function getDevice(tenantId, deviceId) {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  return tenant.get(deviceId) || null;
}

function removeDevice(tenantId, deviceId) {
  const tenant = tenants.get(tenantId);
  if (!tenant) return false;
  return tenant.delete(deviceId);
}

function getDevices(tenantId) {
  const tenant = tenants.get(tenantId);
  if (!tenant) return null;
  return Array.from(tenant.values());
}

// --- DB 영속화 ---

async function persistDevice(device) {
  await pool.query(
    `INSERT INTO devices (tenant_id, device_id, model_name, interval_ms, registered_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       model_name    = VALUES(model_name),
       interval_ms   = VALUES(interval_ms),
       registered_at = VALUES(registered_at)`,
    [
      device.tenantId,
      device.deviceId,
      device.modelName,
      device.intervalMs,
      new Date(device.registeredAt),
    ]
  );
}

async function removePersistedDevice(tenantId, deviceId) {
  await pool.query("DELETE FROM device_states WHERE device_id = ?", [deviceId]);
  await pool.query("DELETE FROM devices WHERE tenant_id = ? AND device_id = ?", [tenantId, deviceId]);
}

async function persistState(deviceId, state) {
  await pool.query(
    `INSERT INTO device_states
       (device_id, battery, step_count, lma_count, calories, usage_time_seconds, base_lat, base_lng)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       battery            = VALUES(battery),
       step_count         = VALUES(step_count),
       lma_count          = VALUES(lma_count),
       calories           = VALUES(calories),
       usage_time_seconds = VALUES(usage_time_seconds),
       base_lat           = VALUES(base_lat),
       base_lng           = VALUES(base_lng)`,
    [
      deviceId,
      state.battery,
      state.stepCount,
      state.lmaCount,
      state.calories,
      state.usageTimeSeconds,
      state.baseLat,
      state.baseLng,
    ]
  );
}

async function persistMessage(payload) {
  // 핫패스이므로 fire-and-forget. 에러는 로깅만.
  try {
    await pool.query(
      `INSERT INTO messages (tenant_id, device_id, type, payload, published_at)
       VALUES (?, ?, ?, CAST(? AS JSON), ?)`,
      [
        payload.tenantId,
        payload.deviceId,
        payload.type,
        JSON.stringify(payload),
        new Date(payload.timestamp),
      ]
    );
  } catch (err) {
    console.error("[DB] message persist 오류:", err.code || err.message);
  }
}

async function loadAllFromDb() {
  const [rows] = await pool.query(`
    SELECT d.tenant_id, d.device_id, d.model_name, d.interval_ms, d.registered_at,
           s.battery, s.step_count, s.lma_count, s.calories, s.usage_time_seconds,
           s.base_lat, s.base_lng
    FROM devices d
    LEFT JOIN device_states s ON s.device_id = d.device_id
  `);

  for (const row of rows) {
    if (!tenants.has(row.tenant_id)) {
      tenants.set(row.tenant_id, new Map());
    }
    tenants.get(row.tenant_id).set(row.device_id, {
      deviceId: row.device_id,
      tenantId: row.tenant_id,
      modelName: row.model_name,
      intervalMs: row.interval_ms,
      topic: `drvalue/${row.tenant_id}`,
      status: "publishing",
      registeredAt: new Date(row.registered_at).toISOString(),
    });
  }
  console.log(`[DB] 디바이스 ${rows.length}개 로드 완료`);
  return rows;
}

function hydrateState(deviceId, row) {
  // DB에 누적 상태가 있으면 그 값으로, 없으면 init은 simulator가 처리
  if (row.battery == null) return null;
  const state = {
    battery: parseFloat(row.battery),
    stepCount: Number(row.step_count),
    lmaCount: Number(row.lma_count),
    calories: parseFloat(row.calories),
    usageTimeSeconds: Number(row.usage_time_seconds),
    baseLat: parseFloat(row.base_lat),
    baseLng: parseFloat(row.base_lng),
    intervalId: null,
    emergencyIntervalId: null,
  };
  deviceStates.set(deviceId, state);
  return state;
}

module.exports = {
  PRESET_TENANTS,
  tenants,
  deviceStates,
  // 메모리
  getTenant,
  getAllTenants,
  addDevice,
  getDevice,
  removeDevice,
  getDevices,
  // 영속화
  persistDevice,
  removePersistedDevice,
  persistState,
  persistMessage,
  loadAllFromDb,
  hydrateState,
};
