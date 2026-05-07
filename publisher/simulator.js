const { deviceStates } = require("./store");

const SEOUL_LAT = 37.5665;
const SEOUL_LNG = 126.978;

function gaussianRandom(mean, std) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z * std;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function initDeviceState(deviceId) {
  const state = {
    battery: 100,
    stepCount: 0,
    lmaCount: 0,
    calories: 0,
    usageTimeSeconds: 0,
    baseLat: SEOUL_LAT + (Math.random() - 0.5) * 0.01,
    baseLng: SEOUL_LNG + (Math.random() - 0.5) * 0.01,
    intervalId: null,
    emergencyIntervalId: null,
  };
  deviceStates.set(deviceId, state);
  return state;
}

function generateReport(deviceId, tenantId, modelName) {
  const state = deviceStates.get(deviceId);
  if (!state) return null;

  state.battery = clamp(state.battery - (Math.random() * 0.4 + 0.1), 0, 100);

  const breathRate = clamp(Math.round(gaussianRandom(17, 3)), 12, 25);

  const stepDelta = Math.floor(Math.random() * 50);
  state.stepCount += stepDelta;

  const lmaDelta = Math.floor(Math.random() * 10);
  state.lmaCount += lmaDelta;

  state.calories += 0.2 * lmaDelta + 0.06 * stepDelta;

  const torsoAngleMean = clamp(+(Math.random() * 35 + 5).toFixed(1), 5, 40);
  const torsoAngleMin = clamp(+(torsoAngleMean - Math.random() * 5).toFixed(1), 0, 50);
  const bentDuration = Math.floor(Math.random() * 120);

  state.usageTimeSeconds += 5;

  return {
    type: "report",
    deviceId,
    tenantId,
    modelName,
    battery: +state.battery.toFixed(1),
    breathRate,
    stepCount: state.stepCount,
    lmaCount: state.lmaCount,
    torsoAngleMean,
    torsoAngleMin,
    bentDuration,
    calories: +state.calories.toFixed(1),
    gpsLatitude: +(state.baseLat + (Math.random() - 0.5) * 0.002).toFixed(6),
    gpsLongitude: +(state.baseLng + (Math.random() - 0.5) * 0.002).toFixed(6),
    usageTimeSeconds: state.usageTimeSeconds,
    timestamp: new Date().toISOString(),
  };
}

const EMERGENCY_TYPES = [
  { type: 0, label: "낙상" },
  { type: 1, label: "과호흡" },
  { type: 2, label: "과활동" },
  { type: 3, label: "과작업" },
];

function generateEmergency(deviceId, tenantId) {
  const state = deviceStates.get(deviceId);
  if (!state) return null;

  const emergency = EMERGENCY_TYPES[Math.floor(Math.random() * EMERGENCY_TYPES.length)];
  return {
    type: "emergency",
    deviceId,
    tenantId,
    emergencyType: emergency.type,
    emergencyLabel: emergency.label,
    gpsLatitude: +(state.baseLat + (Math.random() - 0.5) * 0.002).toFixed(6),
    gpsLongitude: +(state.baseLng + (Math.random() - 0.5) * 0.002).toFixed(6),
    timestamp: new Date().toISOString(),
  };
}

function generatePoweron(deviceId, tenantId, modelName) {
  return {
    type: "poweron",
    deviceId,
    tenantId,
    modelName,
    firmwareVersion: "1.0.0",
    timestamp: new Date().toISOString(),
  };
}

function clearDeviceState(deviceId) {
  const state = deviceStates.get(deviceId);
  if (state) {
    if (state.intervalId) clearInterval(state.intervalId);
    if (state.emergencyIntervalId) clearInterval(state.emergencyIntervalId);
    deviceStates.delete(deviceId);
  }
}

module.exports = {
  initDeviceState,
  generateReport,
  generateEmergency,
  generatePoweron,
  clearDeviceState,
};
