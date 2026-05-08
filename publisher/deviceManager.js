const store = require("./store");
const sim = require("./simulator");

const TOPIC_PREFIX = "drvalue";

let publishFn = null;
function setPublisher(fn) { publishFn = fn; }

function ensurePublisher() {
  if (!publishFn) throw new Error("publishFn not set — setPublisher() 호출 필요");
}

function attachIntervals(tenantId, deviceId, modelName, intervalMs) {
  const state = store.deviceStates.get(deviceId);
  if (!state) return;

  if (state.intervalId) clearInterval(state.intervalId);
  if (state.emergencyIntervalId) clearInterval(state.emergencyIntervalId);

  state.intervalMs = intervalMs;

  state.intervalId = setInterval(() => {
    const report = sim.generateReport(deviceId, tenantId, modelName);
    if (report) publishFn(tenantId, report);
  }, intervalMs);

  state.emergencyIntervalId = setInterval(() => {
    if (Math.random() < 0.015) {
      const emergency = sim.generateEmergency(deviceId, tenantId);
      if (emergency) {
        publishFn(tenantId, emergency);
        console.log(`[MQTT] 🚨 응급 이벤트: ${emergency.emergencyLabel} (${deviceId})`);
      }
    }
  }, 1000);
}

function detachIntervals(deviceId) {
  const state = store.deviceStates.get(deviceId);
  if (!state) return;
  if (state.intervalId) clearInterval(state.intervalId);
  if (state.emergencyIntervalId) clearInterval(state.emergencyIntervalId);
  state.intervalId = null;
  state.emergencyIntervalId = null;
}

async function create(tenantId, deviceId, modelName, intervalMs) {
  ensurePublisher();
  if (!deviceId) throw new Error("DEVICE_ID_REQUIRED");
  if (!store.getTenant(tenantId)) throw new Error("TENANT_NOT_FOUND");
  if (store.getDevice(tenantId, deviceId)) throw new Error("DEVICE_EXISTS");

  const device = {
    deviceId,
    tenantId,
    modelName: modelName || "WF100",
    intervalMs: Number(intervalMs) || 5000,
    topic: `${TOPIC_PREFIX}/${tenantId}`,
    status: "publishing",
    registeredAt: new Date().toISOString(),
  };

  if (device.intervalMs < 100 || device.intervalMs > 600000) {
    throw new Error("INVALID_INTERVAL");
  }

  try {
    store.addDevice(tenantId, device);
    await store.persistDevice(device);

    const state = sim.initDeviceState(deviceId);
    state.intervalMs = device.intervalMs;

    publishFn(tenantId, sim.generatePoweron(deviceId, tenantId, device.modelName));
    attachIntervals(tenantId, deviceId, device.modelName, device.intervalMs);

    console.log(`[Manager] 디바이스 생성: ${deviceId} → ${tenantId} (${device.intervalMs}ms)`);
    return device;
  } catch (err) {
    store.removeDevice(tenantId, deviceId);
    sim.clearDeviceState(deviceId);
    throw err;
  }
}

async function update(tenantId, deviceId, fields) {
  ensurePublisher();
  const device = store.getDevice(tenantId, deviceId);
  if (!device) throw new Error("DEVICE_NOT_FOUND");

  let needsRestart = false;
  if (fields.modelName != null && fields.modelName !== device.modelName) {
    device.modelName = String(fields.modelName);
  }
  if (fields.intervalMs != null) {
    const ms = Number(fields.intervalMs);
    if (!ms || ms < 100 || ms > 600000) throw new Error("INVALID_INTERVAL");
    if (ms !== device.intervalMs) {
      device.intervalMs = ms;
      needsRestart = true;
    }
  }

  await store.persistDevice(device);

  if (needsRestart) {
    attachIntervals(tenantId, deviceId, device.modelName, device.intervalMs);
    console.log(`[Manager] 디바이스 갱신: ${deviceId} (interval=${device.intervalMs}ms)`);
  } else {
    console.log(`[Manager] 디바이스 갱신: ${deviceId}`);
  }
  return device;
}

async function remove(tenantId, deviceId) {
  const device = store.getDevice(tenantId, deviceId);
  if (!device) throw new Error("DEVICE_NOT_FOUND");

  sim.clearDeviceState(deviceId);
  store.removeDevice(tenantId, deviceId);
  await store.removePersistedDevice(tenantId, deviceId);

  console.log(`[Manager] 디바이스 제거: ${deviceId} ← ${tenantId}`);
  return { tenantId, deviceId, status: "removed" };
}

const ERROR_HTTP = {
  DEVICE_ID_REQUIRED: { status: 400, message: "deviceId는 필수입니다" },
  TENANT_NOT_FOUND:   { status: 404, message: "존재하지 않는 테넌트입니다" },
  DEVICE_NOT_FOUND:   { status: 404, message: "디바이스를 찾을 수 없습니다" },
  DEVICE_EXISTS:      { status: 409, message: "이미 등록된 디바이스입니다" },
  INVALID_INTERVAL:   { status: 400, message: "intervalMs는 100~600000 사이여야 합니다" },
};

function errorToHttp(err) {
  return ERROR_HTTP[err.message] || { status: 500, message: err.message || "internal error" };
}

module.exports = {
  setPublisher,
  attachIntervals,
  detachIntervals,
  create,
  update,
  remove,
  errorToHttp,
};
