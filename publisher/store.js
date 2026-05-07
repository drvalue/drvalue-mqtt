const PRESET_TENANTS = ["tenant-1", "tenant-2", "tenant-3", "tenant-4", "tenant-5"];

const tenants = new Map();
PRESET_TENANTS.forEach((id) => tenants.set(id, new Map()));

// 디바이스별 시뮬레이션 상태 (interval ID, 누적값 등)
const deviceStates = new Map();

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

module.exports = {
  PRESET_TENANTS,
  tenants,
  deviceStates,
  getTenant,
  getAllTenants,
  addDevice,
  getDevice,
  removeDevice,
  getDevices,
};
