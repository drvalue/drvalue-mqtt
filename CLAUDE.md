# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DrValue 웨어러블 디바이스 MQTT 시뮬레이터. **대학교 백엔드 개발 수업의 통합 실습용 인프라** (2개월 운영). 5개 팀이 각자 디바이스 임대 관리 시스템을 개발했고, 본 시뮬레이터를 통해 임대된 디바이스의 생체 데이터를 MQTT로 수신해 자기 백엔드/DB에 통합한다.

- 팀당 tenant 1개: `tenant-1` ~ `tenant-5`
- 팀당 학생 DB 1개: `team1` ~ `team5` (MySQL, 자기 DB만 접근)
- Publisher는 인메모리가 아니라 **MySQL에 영속화** — 재시작 시 디바이스/누적상태 자동 복원, 발행 메세지 전부 archive
- 포함된 Java Subscriber는 **참고 예제일 뿐**, 학생들은 자기 팀 언어로 구현

## 학생용 권위 문서

`docs/index.html`이 학생 대상 풀 레퍼런스 (페이로드 스키마, REST API, 시뮬레이션 범위, 토픽 구조). 통합 관련 질문은 이 파일을 우선 참고.

## 인프라 구성

```
[학생 백엔드] ──REST POST/DELETE──▶ [Publisher (Node, pm2)] ──┬──▶ [Mosquitto :1883]
                                              │              │           │
                                              ▼              │           ▼
                                       [MySQL :3306 / drvalue] [학생 백엔드] ◀── subscribe
                                                                drvalue/{tenantId}

[학생 백엔드] ──직접 연결──▶ [MySQL :3306 / team{N}]   ← 팀 전용 DB (자유롭게 사용)
```

- Mosquitto, MySQL: docker compose (`docker-compose.yml`)
- Publisher: 호스트에서 pm2로 실행 (DB는 `127.0.0.1:3306`로 접속)
- 비밀번호 생성/관리: `setup.sh` (최초 1회)

## 셋업 / 배포 순서

상세는 `README-DEPLOY.md` 참고. 요약:

```bash
# 1. 비밀번호/초기화 SQL/.env 생성 (최초 1회)
./setup.sh

# 2. 컨테이너 기동 (Mosquitto + MySQL, MySQL은 첫 부팅 시 init.sql 자동 실행)
docker compose up -d

# 3. Publisher 의존성 + 기동
cd publisher && npm install --omit=dev
pm2 start index.js --name drvalue-publisher
pm2 save && pm2 startup    # 안내 명령 실행 후 다시 pm2 save

# 4. 학생 자격증명 확인
cat ../credentials.txt
```

## MQTT 토픽 구조

**테넌트당 단일 토픽**, QoS 1 발행. 메시지 종류는 페이로드 `type` 필드(`report` / `poweron` / `emergency`)로 구분.

```
drvalue/{tenantId}
```

전체 페이로드 스키마는 `docs/index.html`.

## REST API (Publisher)

| Method | Path | 설명 |
|--------|------|------|
| GET | /api/health | DB+MQTT 헬스체크 (모니터링용) |
| GET | /admin/ | **강사 모니터링 대시보드 (Basic Auth)** |
| GET | /admin/api/{stats,devices,messages,emergencies,timeseries} | 대시보드용 JSON API (인증 필요) |
| GET | /api/tenants | 전체 테넌트 현황 |
| GET | /api/tenants/:tenantId/devices | 디바이스 목록 |
| GET | /api/tenants/:tenantId/devices/:deviceId | 디바이스 상세 |
| POST | /api/tenants/:tenantId/devices | 디바이스 등록 → MQTT 발행 시작 + DB 저장 |
| DELETE | /api/tenants/:tenantId/devices/:deviceId | 디바이스 제거 → MQTT 발행 중지 + DB 삭제 |

환경변수 (`.env` 또는 pm2 env): `MQTT_BROKER`, `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`, `MYSQL_ROOT_PASSWORD`, `ADMIN_USER`, `ADMIN_PASSWORD`.

## 강사 모니터링 대시보드

- URL: `http://<서버IP>:3000/admin/`
- 인증: HTTP Basic Auth (`ADMIN_USER` / `ADMIN_PASSWORD`)
- `setup.sh`가 32자 랜덤 비번 생성, `credentials.txt`에 기록
- 기능: 팀별 통계 카드, 메세지 흐름 라인차트(60분 분당), 실시간 메세지 로그(2초 폴링, 필터링), 응급 이벤트 목록, 디바이스 상세 테이블
- 데이터 소스: `drvalue.messages` 테이블 + 메모리 store (디바이스 목록)
- 학생들에게 절대 공유 금지 (모든 팀 데이터 보임)

## DB 스키마 (Publisher: drvalue 데이터베이스)

부팅 시 `publisher/db.js`가 `CREATE TABLE IF NOT EXISTS`로 보장:

- `devices` — 등록된 디바이스 (tenant_id+device_id PK)
- `device_states` — 시뮬레이터 누적 상태 (battery, stepCount, lmaCount, calories, usageTimeSeconds, baseLat/Lng)
- `messages` — 모든 발행 메세지 archive (`payload` JSON 컬럼, `tenant_id`/`type`/`published_at` 인덱스)

`messages`는 강사 모니터링/채점용. 학생들은 자기 `team{N}` DB만 사용.

## 학생 DB (team1 ~ team5)

- `setup.sh`가 5개 팀 DB + 계정을 자동 생성
- 각 팀 계정은 자기 DB만 ALL PRIVILEGES, 다른 팀 DB는 접근 불가
- 외부 접속 허용 (`'team1'@'%'`)
- root 계정은 외부 차단 (`docker exec`로만 접근)

연결 정보는 `credentials.txt`에 자동 생성됨.

## 구조

- `publisher/` — Node.js + Express + mqtt.js + mysql2
  - `index.js` — Express, REST API, MQTT 발행, 부팅 시 DB 복원
  - `simulator.js` — 생체 데이터 시뮬레이션 (정규분포, 누적값) + 누적상태 영속화
  - `store.js` — 메모리 캐시 + DB write-through
  - `db.js` — MySQL 풀 + 재연결 재시도 + 스키마 부트스트랩
  - `admin.js` — 강사 대시보드 라우터 (Basic Auth + 모니터링 API)
  - `public/admin/` — 대시보드 SPA (index.html + style.css + app.js, Chart.js CDN)
- `subscriber/` — Java 17 + Eclipse Paho + Gradle, 참고용 예제
- `docker/`
  - `mosquitto.conf` — 1883 포트, anonymous
  - `mysql/init/` — `setup.sh`가 생성한 SQL이 들어감 (gitignored)
- `docs/index.html` — 학생용 통합 레퍼런스 문서
- `setup.sh` — 비밀번호/초기화 생성기 (최초 1회)
- `credentials.txt` — 강사용 자격증명 요약 (gitignored)
- `.env` — docker-compose + publisher 공유 환경변수 (gitignored)

## 학생 통합 시 자주 부딪히는 함정

- **CLIENT_ID 충돌**: `subscriber/`의 `CLIENT_ID="java-subscriber"`가 하드코딩 ([MqttSubscriber.java:11](subscriber/src/main/java/MqttSubscriber.java:11)). 자기 백엔드로 옮길 때는 팀id+호스트별로 유니크하게.
- **테넌트 격리는 컨벤션**: 브로커 anonymous → 다른 팀 토픽도 기술적으로 구독 가능. 자기 팀만.
- **Publisher 재시작은 안전**: 디바이스/누적상태 모두 DB 복원됨. 단, 재시작 직후 ~몇 초간 발행 끊길 수 있음.
- **MySQL 첫 부팅 + `setup.sh` 미실행**: `docker compose up`을 setup.sh 없이 먼저 돌리면 init SQL이 없어서 DB/계정이 안 만들어짐. `docker compose down -v` 후 setup.sh 다시.
- **시뮬레이터의 GPS는 서울 고정** ± 미세 변동, 실제 이동 궤적 아님.
- **응급 이벤트 빈도**: 매초 1.5% 확률 (`Math.random() < 0.015`, [index.js](publisher/index.js)).

## 운영 명령

```bash
# 헬스체크
curl http://localhost:3000/api/health
curl http://localhost:3000/api/tenants | jq

# 모든 토픽 모니터링
docker exec -it mqtt-broker mosquitto_sub -t 'drvalue/#' -v

# DB 직접 접근 (root, 컨테이너 내부)
docker exec -it drvalue-mysql mysql -uroot -p"$(grep MYSQL_ROOT_PASSWORD .env | cut -d= -f2)"

# Publisher 재시작 (env 갱신)
pm2 restart drvalue-publisher --update-env
pm2 logs drvalue-publisher

# 메세지 archive 조회 (drvalue.messages)
docker exec -i drvalue-mysql mysql -upublisher -p"$(grep ^DB_PASSWORD .env | cut -d= -f2)" drvalue \
  -e "SELECT tenant_id, type, COUNT(*) FROM messages GROUP BY tenant_id, type;"

# 전체 종료
pm2 stop drvalue-publisher
docker compose down               # 데이터 유지
docker compose down -v            # 데이터까지 삭제 (root 비번도 초기화됨, 주의)
```
