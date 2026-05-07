# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DrValue 웨어러블 디바이스 MQTT 시뮬레이터. Node.js Publisher가 REST API로 디바이스를 등록받아 생체 데이터를 MQTT로 발행하고, Java Subscriber가 테넌트별로 구독 수신한다. Mosquitto 브로커는 Docker로 동작.

## 실행 순서

```bash
# 1. 브로커 실행
docker-compose up -d

# 2. Publisher 서버 (Express + MQTT)
cd publisher && npm install && npm start    # http://localhost:3000

# 3. 디바이스 등록 (API)
curl -X POST http://localhost:3000/api/tenants/tenant-1/devices \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"DEV-001","modelName":"WF100","intervalMs":5000}'

# 4. Subscriber (테넌트별 구독)
cd subscriber && ./gradlew run --args="tenant-1"
```

## 구조

- `publisher/` — Node.js + Express + mqtt.js
  - `index.js` — Express 서버, REST API, MQTT 발행 로직
  - `simulator.js` — 생체 데이터 시뮬레이션 (정규분포, 누적값, 응급 이벤트)
  - `store.js` — 인메모리 테넌트/디바이스 저장소 (프리셋: tenant-1~5)
- `subscriber/` — Java 17 + Eclipse Paho, 실행 인자로 tenantId 지정
- `docker/` — Mosquitto 설정

## MQTT 토픽 구조

```
drvalue/{tenantId}/device/{deviceId}/report      ← 주기적 생체 데이터
drvalue/{tenantId}/device/{deviceId}/poweron      ← 전원 켜짐 (등록 시 1회)
drvalue/{tenantId}/device/{deviceId}/emergency    ← 응급 이벤트 (1~2% 확률)
```

## REST API

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/tenants | 전체 테넌트 현황 |
| GET | /api/tenants/:tenantId/devices | 디바이스 목록 |
| GET | /api/tenants/:tenantId/devices/:deviceId | 디바이스 상세 |
| POST | /api/tenants/:tenantId/devices | 디바이스 등록 → MQTT 발행 시작 |
| DELETE | /api/tenants/:tenantId/devices/:deviceId | 디바이스 제거 → MQTT 발행 중지 |
