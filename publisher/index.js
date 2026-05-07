const express = require("express");
const mqtt = require("mqtt");
const store = require("./store");
const sim = require("./simulator");

const BROKER_URL = process.env.MQTT_BROKER || "mqtt://localhost:1883";
const PORT = process.env.PORT || 3000;
const TOPIC_PREFIX = "drvalue";

const app = express();
app.use(express.json());

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
}

function startDevice(tenantId, deviceId, modelName, intervalMs) {
  const state = sim.initDeviceState(deviceId);

  publish(tenantId, sim.generatePoweron(deviceId, tenantId, modelName));

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

// --- REST API ---

// GET /api/tenants — 전체 테넌트 현황
app.get("/api/tenants", (req, res) => {
  res.json(store.getAllTenants());
});

// GET /api/tenants/:tenantId/devices — 디바이스 목록
app.get("/api/tenants/:tenantId/devices", (req, res) => {
  const devices = store.getDevices(req.params.tenantId);
  if (devices === null) {
    return res.status(404).json({ error: "존재하지 않는 테넌트입니다" });
  }
  res.json(devices);
});

// GET /api/tenants/:tenantId/devices/:deviceId — 디바이스 상세
app.get("/api/tenants/:tenantId/devices/:deviceId", (req, res) => {
  const device = store.getDevice(req.params.tenantId, req.params.deviceId);
  if (!device) {
    return res.status(404).json({ error: "디바이스를 찾을 수 없습니다" });
  }
  res.json(device);
});

// POST /api/tenants/:tenantId/devices — 디바이스 등록
app.post("/api/tenants/:tenantId/devices", (req, res) => {
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

  store.addDevice(tenantId, device);
  startDevice(tenantId, deviceId, modelName, intervalMs);

  console.log(`[API] 디바이스 등록: ${deviceId} → ${tenantId} (${intervalMs}ms 간격)`);
  res.status(201).json(device);
});

// DELETE /api/tenants/:tenantId/devices/:deviceId — 디바이스 제거
app.delete("/api/tenants/:tenantId/devices/:deviceId", (req, res) => {
  const { tenantId, deviceId } = req.params;

  const device = store.getDevice(tenantId, deviceId);
  if (!device) {
    return res.status(404).json({ error: "디바이스를 찾을 수 없습니다" });
  }

  sim.clearDeviceState(deviceId);
  store.removeDevice(tenantId, deviceId);

  console.log(`[API] 디바이스 제거: ${deviceId} ← ${tenantId}`);
  res.json({ deviceId, tenantId, status: "removed" });
});

// --- 서버 시작 ---

app.listen(PORT, () => {
  console.log(`[Server] REST API 실행: http://localhost:${PORT}`);
  console.log(`[Server] 프리셋 테넌트: ${store.PRESET_TENANTS.join(", ")}`);
  console.log(`[Server] 디바이스 등록: POST /api/tenants/:tenantId/devices`);
});
