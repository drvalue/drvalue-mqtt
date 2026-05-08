const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const express = require("express");
const mqtt = require("mqtt");
const db = require("./db");
const store = require("./store");
const dm = require("./deviceManager");
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
  store.persistMessage(payload).catch(() => {});
}

dm.setPublisher(publish);

async function restoreDevicesOnStartup() {
  const rows = await store.loadAllFromDb();
  let restored = 0;
  for (const row of rows) {
    store.hydrateState(row.device_id, row);
    require("./simulator").initDeviceState(row.device_id);
    const state = store.deviceStates.get(row.device_id);
    if (state) state.intervalMs = row.interval_ms;
    dm.attachIntervals(row.tenant_id, row.device_id, row.model_name, row.interval_ms);
    restored++;
  }
  if (restored > 0) {
    console.log(`[Server] 재기동 복원: 디바이스 ${restored}개 발행 재개`);
  }
}

// --- 학생용 REST API ---

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
  try {
    const device = await dm.create(
      req.params.tenantId,
      req.body.deviceId,
      req.body.modelName,
      req.body.intervalMs
    );
    res.status(201).json(device);
  } catch (e) {
    const { status, message } = dm.errorToHttp(e);
    res.status(status).json({ error: message });
  }
});

app.delete("/api/tenants/:tenantId/devices/:deviceId", async (req, res) => {
  try {
    const result = await dm.remove(req.params.tenantId, req.params.deviceId);
    res.json(result);
  } catch (e) {
    const { status, message } = dm.errorToHttp(e);
    res.status(status).json({ error: message });
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
