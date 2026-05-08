const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { pool } = require("./db");
const store = require("./store");

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).type("text/plain").send(
      "ADMIN_PASSWORD가 설정되지 않았습니다. setup.sh 실행 후 publisher를 재시작하세요."
    );
  }

  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="DrValue Admin", charset="UTF-8"');
    return res.status(401).type("text/plain").send("Authentication required");
  }

  let user = "", pass = "";
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    user = decoded.slice(0, idx);
    pass = decoded.slice(idx + 1);
  } catch (_) {
    res.set("WWW-Authenticate", 'Basic realm="DrValue Admin", charset="UTF-8"');
    return res.status(401).type("text/plain").send("Invalid auth header");
  }

  const ok = timingSafeEqual(user, ADMIN_USER) && timingSafeEqual(pass, ADMIN_PASSWORD);
  if (!ok) {
    res.set("WWW-Authenticate", 'Basic realm="DrValue Admin", charset="UTF-8"');
    return res.status(401).type("text/plain").send("Invalid credentials");
  }
  next();
}

const router = express.Router();
router.use(basicAuth);

// 대시보드 정적 파일
router.use("/", express.static(path.join(__dirname, "public", "admin")));

// --- API ---

router.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "ok",
      db: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ status: "degraded", db: "error", error: e.code || e.message });
  }
});

router.get("/api/stats", async (req, res) => {
  try {
    const tenants = store.getAllTenants(); // [{tenantId, deviceCount, devices}]

    // 메세지/응급 누적 (전체 기간)
    const [totalRows] = await pool.query(`
      SELECT tenant_id, type, COUNT(*) AS cnt
      FROM messages
      GROUP BY tenant_id, type
    `);

    // 최근 5분간 메세지 (활성도 지표)
    const [recentRows] = await pool.query(`
      SELECT tenant_id, COUNT(*) AS cnt
      FROM messages
      WHERE published_at > NOW() - INTERVAL 5 MINUTE
      GROUP BY tenant_id
    `);

    const totalsByTenant = {};
    for (const r of totalRows) {
      const t = r.tenant_id;
      if (!totalsByTenant[t]) totalsByTenant[t] = { report: 0, poweron: 0, emergency: 0, total: 0 };
      totalsByTenant[t][r.type] = Number(r.cnt);
      totalsByTenant[t].total += Number(r.cnt);
    }
    const recentByTenant = Object.fromEntries(recentRows.map((r) => [r.tenant_id, Number(r.cnt)]));

    const merged = tenants.map((t) => ({
      tenantId: t.tenantId,
      deviceCount: t.deviceCount,
      devices: t.devices,
      messages: totalsByTenant[t.tenantId] || { report: 0, poweron: 0, emergency: 0, total: 0 },
      recentMessages5m: recentByTenant[t.tenantId] || 0,
    }));

    const grand = {
      devices: merged.reduce((s, x) => s + x.deviceCount, 0),
      messages: merged.reduce((s, x) => s + x.messages.total, 0),
      emergencies: merged.reduce((s, x) => s + x.messages.emergency, 0),
      recentMessages5m: merged.reduce((s, x) => s + x.recentMessages5m, 0),
    };

    res.json({ tenants: merged, totals: grand });
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

router.get("/api/devices", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT d.tenant_id, d.device_id, d.model_name, d.interval_ms, d.registered_at,
             s.battery, s.step_count, s.lma_count, s.calories, s.usage_time_seconds, s.updated_at
      FROM devices d
      LEFT JOIN device_states s ON s.device_id = d.device_id
      ORDER BY d.tenant_id, d.device_id
    `);
    res.json(rows.map((r) => ({
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      modelName: r.model_name,
      intervalMs: r.interval_ms,
      registeredAt: r.registered_at,
      battery: r.battery,
      stepCount: r.step_count != null ? Number(r.step_count) : null,
      lmaCount: r.lma_count != null ? Number(r.lma_count) : null,
      calories: r.calories,
      usageTimeSeconds: r.usage_time_seconds != null ? Number(r.usage_time_seconds) : null,
      updatedAt: r.updated_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

router.get("/api/messages", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  const afterId = parseInt(req.query.afterId || "0", 10);
  const tenant = req.query.tenant;
  const type = req.query.type;

  const where = ["id > ?"];
  const params = [afterId];
  if (tenant) { where.push("tenant_id = ?"); params.push(tenant); }
  if (type)   { where.push("type = ?");      params.push(type); }

  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, device_id, type, payload, published_at
       FROM messages
       WHERE ${where.join(" AND ")}
       ORDER BY id DESC
       LIMIT ?`,
      [...params, limit]
    );
    res.json(rows.map((r) => ({
      id: Number(r.id),
      tenantId: r.tenant_id,
      deviceId: r.device_id,
      type: r.type,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      publishedAt: r.published_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

router.get("/api/emergencies", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "20", 10), 200);
  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, device_id, payload, published_at
       FROM messages
       WHERE type = 'emergency'
       ORDER BY id DESC
       LIMIT ?`,
      [limit]
    );
    res.json(rows.map((r) => {
      const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
      return {
        id: Number(r.id),
        tenantId: r.tenant_id,
        deviceId: r.device_id,
        emergencyType: p.emergencyType,
        emergencyLabel: p.emergencyLabel,
        gpsLatitude: p.gpsLatitude,
        gpsLongitude: p.gpsLongitude,
        publishedAt: r.published_at,
      };
    }));
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

// 분 단위 시계열 (지정 분 동안, 기본 60분)
router.get("/api/timeseries", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes || "60", 10), 720);
  try {
    const [rows] = await pool.query(
      `SELECT
         DATE_FORMAT(published_at, '%Y-%m-%d %H:%i:00') AS bucket,
         type,
         COUNT(*) AS cnt
       FROM messages
       WHERE published_at > NOW() - INTERVAL ? MINUTE
       GROUP BY bucket, type
       ORDER BY bucket`,
      [minutes]
    );
    res.json(rows.map((r) => ({
      bucket: r.bucket,
      type: r.type,
      count: Number(r.cnt),
    })));
  } catch (e) {
    res.status(500).json({ error: e.code || e.message });
  }
});

module.exports = router;
