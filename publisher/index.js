const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const mqtt = require("mqtt");
const db = require("./db");
const store = require("./store");
const sim = require("./simulator");
const adminRouter = require("./admin");

const BROKER_URL = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const PORT = process.env.PORT || 3000;
const TOPIC_PREFIX = "drvalue";

const app = express();
app.use(express.json());
app.use("/admin", adminRouter);

const mqttClient = mqtt.connect(BROKER_URL);

mqttClient.on("connect", () => {
  console.log(`[MQTT] 브로커 연결 완료: ${BROKER_URL}`);
});

mqttClient.on("error", (err) => {
  console.error("[MQTT] 연결 오류:", err.message);
});

function publish(tenantId, payload) {
  const topic = `${TOPIC_PREFIX}/${tenantId}`;
  const data = JSON.stringify(payload);
  mqttClient.publish(topic, data, { qos: 1 });
  console.log(`[MQTT] → ${topic} (${payload.type}/${payload.deviceId})`);

  // 발행 메세지 영속화 (강사 모니터링/채점용)
  store.persistMessage(payload).catch(() => {});
}

function startDevice(tenantId, deviceId, modelName, intervalMs) {
  const state = sim.initDeviceState(deviceId);
  state.intervalMs = intervalMs;

  // 신규 등록 시에만 poweron 발행 (재기동 복원 시엔 호출하지 않음)
  return state;
}

function attachIntervals(tenantId, deviceId, modelName, intervalMs) {
  const state = store.deviceStates.get(deviceId);
  if (!state) return;

  if (state.intervalId) clearInterval(state.intervalId);
  if (state.emergencyIntervalId) clearInterval(state.emergencyIntervalId);

  state.intervalId = setInterval(() => {
    const report = sim.generateReport(deviceId, tenantId, modelName);
    if (report) publish(tenantId, report);
  }, intervalMs);

  state.emergencyIntervalId = setInterval(() => {
    if (Math.random() < 0.015) {
      const emergency = sim.generateEmergency(deviceId, tenantId);
      if (emergency) {
        publish(tenantId, emergency);
        console.log(`[MQTT] 🚨 응급 이벤트: ${emergency.emergencyLabel} (${deviceId})`);
      }
    }
  }, 1000);
}

async function restoreDevicesOnStartup() {
  const rows = await store.loadAllFromDb();
  let restored = 0;
  for (const row of rows) {
    store.hydrateState(row.device_id, row);
    sim.initDeviceState(row.device_id); // 누적값 있으면 그대로, 없으면 초기화
    const state = store.deviceStates.get(row.device_id);
    if (state) state.intervalMs = row.interval_ms;
    attachIntervals(row.tenant_id, row.device_id, row.model_name, row.interval_ms);
    restored++;
  }
  if (restored > 0) {
    console.log(`[Server] 재기동 복원: 디바이스 ${restored}개 발행 재개`);
  }
}

// --- REST API ---

app.get("/api/health", async (req, res) => {
  try {
    await db.pool.query("SELECT 1");
    res.json({ status: "ok", db: "ok", mqtt: mqttClient.connected ? "ok" : "disconnected" });
  } catch (e) {
    res.status(500).json({ status: "degraded", db: "error", error: e.code || e.message });
  }
});

app.get("/api/tenants", (req, res) => {
  res.json(store.getAllTenants());
});

app.get("/api/tenants/:tenantId/devices", (req, res) => {
  const devices = store.getDevices(req.params.tenantId);
  if (devices === null) {
    return res.status(404).json({ error: "존재하지 않는 테넌트입니다" });
  }
  res.json(devices);
});

app.get("/api/tenants/:tenantId/devices/:deviceId", (req, res) => {
  const device = store.getDevice(req.params.tenantId, req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: "디바이스를 찾을 수 없습니다" });
  }
  res.json(device);
});

app.post("/api/tenants/:tenantId/devices", async (req, res) => {
  const { tenantId } = req.params;
  const { deviceId, modelName = "WF100", intervalMs = 5000 } = req.body;

  if (!deviceId) {
    return res.status(400).json({ error: "deviceId는 필수입니다" });
  }
  if (!store.getTenant(tenantId)) {
    return res.status(404).json({ error: "존재하지 않는 테넌트입니다" });
  }
  if (store.getDevice(tenantId, deviceId)) {
    return res.status(409).json({ error: "이미 등록된 디바이스입니다" });
  }

  const device = {
    deviceId,
    tenantId,
    modelName,
    intervalMs,
    topic: `${TOPIC_PREFIX}/${tenantId}`,
    status: "publishing",
    registeredAt: new Date().toISOString(),
  };

  try {
    store.addDevice(tenantId, device);
    await store.persistDevice(device);

    startDevice(tenantId, deviceId, modelName, intervalMs);
    publish(tenantId, sim.generatePoweron(deviceId, tenantId, modelName));
    attachIntervals(tenantId, deviceId, modelName, intervalMs);

    console.log(`[API] 디바이스 등록: ${deviceId} → ${tenantId} (${intervalMs}ms 간격)`);
    res.status(201).json(device);
  } catch (e) {
    // 메모리 롤백
    store.removeDevice(tenantId, deviceId);
    sim.clearDeviceState(deviceId);
    console.error("[API] 등록 실패:", e.code || e.message);
    res.status(500).json({ error: "등록 중 DB 오류", detail: e.code || e.message });
  }
});

app.delete("/api/tenants/:tenantId/devices/:deviceId", async (req, res) => {
  const { tenantId, deviceId } = req.params;

  const device = store.getDevice(tenantId, deviceId);
  if (!device) {
    return res.status(404).json({ error: "디바이스를 찾을 수 없습니다" });
  }

  try {
    sim.clearDeviceState(deviceId);
    store.removeDevice(tenantId, deviceId);
    await store.removePersistedDevice(tenantId, deviceId);

    console.log(`[API] 디바이스 제거: ${deviceId} ← ${tenantId}`);
    res.json({ deviceId, tenantId, status: "removed" });
  } catch (e) {
    console.error("[API] 제거 실패:", e.code || e.message);
    res.status(500).json({ error: "제거 중 DB 오류", detail: e.code || e.message });
  }
});

// --- 서버 시작 ---

(async () => {
  try {
    await db.init();
    await restoreDevicesOnStartup();
  } catch (e) {
    console.error("[Server] 초기화 실패:", e.code || e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`[Server] REST API 실행: http://localhost:${PORT}`);
    console.log(`[Server] 프리셋 테넌트: ${store.PRESET_TENANTS.join(", ")}`);
    console.log(`[Server] 디바이스 등록: POST /api/tenants/:tenantId/devices`);
    console.log(`[Server] 헬스체크: GET /api/health`);
    console.log(`[Server] 강사 대시보드: http://localhost:${PORT}/admin/  (Basic Auth)`);
  });
})();

// 종료 시그널 처리 (pm2 graceful)
function shutdown(signal) {
  console.log(`[Server] ${signal} 수신, 종료 중...`);
  for (const [, state] of store.deviceStates) {
    if (state.intervalId) clearInterval(state.intervalId);
    if (state.emergencyIntervalId) clearInterval(state.emergencyIntervalId);
  }
  mqttClient.end(false, {}, () => {
    db.pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
