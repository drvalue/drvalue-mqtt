const mysql = require("mysql2/promise");

const config = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "publisher",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "drvalue",
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "+09:00",
  dateStrings: false,
};

const pool = mysql.createPool(config);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS devices (
    tenant_id     VARCHAR(64)  NOT NULL,
    device_id     VARCHAR(128) NOT NULL,
    model_name    VARCHAR(64)  NOT NULL,
    interval_ms   INT          NOT NULL,
    registered_at DATETIME(3)  NOT NULL,
    PRIMARY KEY (tenant_id, device_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS device_states (
    device_id          VARCHAR(128) NOT NULL PRIMARY KEY,
    battery            DOUBLE       NOT NULL,
    step_count         BIGINT       NOT NULL,
    lma_count          BIGINT       NOT NULL,
    calories           DOUBLE       NOT NULL,
    usage_time_seconds BIGINT       NOT NULL,
    base_lat           DOUBLE       NOT NULL,
    base_lng           DOUBLE       NOT NULL,
    updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS messages (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id     VARCHAR(64)  NOT NULL,
    device_id     VARCHAR(128) NOT NULL,
    type          VARCHAR(32)  NOT NULL,
    payload       JSON         NOT NULL,
    published_at  DATETIME(3)  NOT NULL,
    INDEX idx_tenant_time (tenant_id, published_at),
    INDEX idx_device_time (device_id, published_at),
    INDEX idx_type_time   (type, published_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function waitForConnection(retries = 30, delayMs = 2000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      console.log(`[DB] 연결 성공 (${config.user}@${config.host}:${config.port}/${config.database})`);
      return;
    } catch (err) {
      console.log(`[DB] 연결 대기 ${i}/${retries} — ${err.code || err.message}`);
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function ensureSchema() {
  for (const stmt of SCHEMA) {
    await pool.query(stmt);
  }
  console.log("[DB] 스키마 확인 완료 (devices / device_states / messages)");
}

async function init() {
  await waitForConnection();
  await ensureSchema();
}

module.exports = { pool, init };
