# 배포 가이드 (Ubuntu / NCloud)

이 문서는 강사 운영자용입니다. 학생용 안내는 `docs/index.html` 참고.

## 0. 사전 요구사항

- Ubuntu 22.04 / 24.04 (NCloud / DigitalOcean / Lightsail 등 어디든)
- Public IP 할당
- ACG / Security Group 인바운드:
  - `22/tcp` SSH
  - `1883/tcp` MQTT
  - `3000/tcp` Publisher REST API
  - `3306/tcp` MySQL (학생 직접 접속용)
  - `80/tcp` (선택, docs 호스팅)

## 1. 시스템 패키지 설치

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git mosquitto-clients

# Node.js 20 LTS (NodeSource 신 방식)
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt update && sudo apt install -y nodejs

# Docker
sudo apt install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER
newgrp docker

# pm2
sudo npm install -g pm2

# 확인
node -v && npm -v && docker --version && docker compose version
```

## 2. 코드 + 비밀번호 생성

```bash
git clone <repo-url>
cd drvalue-mqtt

# 32자 랜덤 패스워드 생성, MySQL init SQL + .env + credentials.txt 만들어줌
./setup.sh
```

생성되는 파일:
- `.env` — docker-compose + publisher 공유 환경변수
- `docker/mysql/init/01-init.sql` — MySQL 첫 부팅 시 자동 실행 (DB/계정 생성)
- `credentials.txt` — 강사용 전체 자격증명 요약

> ⚠️ 세 파일 모두 git ignore되어 있고 600 권한입니다. 절대 외부 노출 금지.

## 3. 컨테이너 기동

```bash
docker compose up -d
docker compose ps           # mqtt-broker, drvalue-mysql 둘 다 Up
docker compose logs -f mysql   # init SQL 실행 로그 확인 (Ctrl+C로 빠져나오기)
```

MySQL이 `healthy` 될 때까지 30~60초 정도 걸립니다.

## 4. Publisher 기동

```bash
cd publisher
npm install --omit=dev
pm2 start index.js --name drvalue-publisher
pm2 save
pm2 startup                 # 출력되는 sudo ... 명령 그대로 실행
pm2 save                    # 한 번 더

# 로그
pm2 logs drvalue-publisher --lines 30
# 다음 라인이 나와야 정상:
#   [DB] 연결 성공 (publisher@127.0.0.1:3306/drvalue)
#   [DB] 스키마 확인 완료 ...
#   [MQTT] 브로커 연결 완료: mqtt://localhost:1883
#   [Server] REST API 실행: http://localhost:3000
```

## 4.5 강사 대시보드 접속 확인

```bash
# 브라우저에서
open "http://<서버IP>:3000/admin/"

# 또는 curl 테스트
ADMIN_PASS=$(grep ^ADMIN_PASSWORD .env | cut -d= -f2)
curl -u "admin:$ADMIN_PASS" http://localhost:3000/admin/api/health
```

브라우저에서 첫 접속 시 Basic Auth 다이얼로그가 뜹니다. `credentials.txt`의 `[강사 모니터링 대시보드]` 항목 사용.

## 5. 외부에서 검증 (본인 노트북에서)

```bash
SERVER=<서버 공인 IP>

# REST 도달
curl http://$SERVER:3000/api/health
curl http://$SERVER:3000/api/tenants

# 디바이스 등록
curl -X POST http://$SERVER:3000/api/tenants/tenant-1/devices \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"SMOKE-1","modelName":"WF100","intervalMs":3000}'

# MQTT 도달
mosquitto_sub -h $SERVER -p 1883 -t 'drvalue/tenant-1' -v

# MySQL 도달 (team1로)
T1_PASS=$(grep -A4 '## team1' credentials.txt | grep password | awk '{print $2}')
mysql -h $SERVER -P 3306 -u team1 -p"$T1_PASS" team1 -e "SELECT VERSION();"

# 정리
curl -X DELETE http://$SERVER:3000/api/tenants/tenant-1/devices/SMOKE-1
```

전부 통과하면 학생들에게도 됩니다.

## 6. 학생에게 전달할 정보

`credentials.txt`에서 각 팀 항목만 잘라서 전달. 예시 (team1):

```
[MQTT]
  Broker:    tcp://<서버IP>:1883
  Topic:     drvalue/tenant-1
  REST API:  http://<서버IP>:3000

[MySQL]
  Host:     <서버IP>
  Port:     3306
  Database: team1
  User:     team1
  Password: <32자 랜덤>
  JDBC:     jdbc:mysql://<서버IP>:3306/team1?useSSL=false&serverTimezone=Asia/Seoul

[문서]
  http://<서버IP>/        (docs/index.html, 별도 호스팅 시)
```

## 7. (선택) docs/index.html 정적 호스팅

학생들이 명세서를 브라우저로 보게 하려면:

```bash
sudo apt install -y nginx
sudo cp ~/drvalue-mqtt/docs/index.html /var/www/html/index.html
sudo ufw allow 80/tcp     # 클라우드 방화벽도 80 오픈
# → http://<서버IP>/ 에서 접근
```

## 8. 운영 명령

```bash
# 상태
curl http://localhost:3000/api/health
pm2 status
docker compose ps

# 로그
pm2 logs drvalue-publisher
docker logs -f mqtt-broker
docker logs -f drvalue-mysql

# 강사 모니터링
docker exec -it mqtt-broker mosquitto_sub -t 'drvalue/#' -v

# Publisher의 메세지 archive 조회
docker exec -i drvalue-mysql mysql \
  -upublisher -p"$(grep ^DB_PASSWORD .env | cut -d= -f2)" drvalue \
  -e "SELECT tenant_id, type, COUNT(*) FROM messages GROUP BY tenant_id, type;"

# 코드 업데이트 후
cd ~/drvalue-mqtt && git pull
cd publisher && npm install --omit=dev
pm2 restart drvalue-publisher --update-env

# 학생 디바이스 일괄 정리 (수업 종료 시)
for t in tenant-1 tenant-2 tenant-3 tenant-4 tenant-5; do
  curl -s http://localhost:3000/api/tenants/$t/devices | \
    jq -r '.[].deviceId' | \
    xargs -I {} curl -s -X DELETE http://localhost:3000/api/tenants/$t/devices/{}
done
```

## 9. 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `pm2 logs`에 `[DB] 연결 대기` 무한 반복 | MySQL이 아직 healthy 아님 / 비번 틀림 | `docker compose logs mysql` 확인. 처음 부팅이면 30~60초 대기. 비번 틀리면 setup.sh 재실행 (아래 항목) |
| `setup.sh` 한번 더 돌리고 싶음 | 이미 init.sql/.env 있음 | `docker compose down -v` (볼륨 삭제) → `rm .env credentials.txt docker/mysql/init/01-init.sql` → `./setup.sh` → `docker compose up -d`. **데이터 다 사라짐 주의** |
| 외부에서 1883/3306 안 닿음 | ACG/Security Group 미설정 | 클라우드 콘솔 방화벽 + 서버 ufw 둘 다 확인 |
| MySQL 외부 접속이 root로도 안 됨 | 보안상 root는 외부 차단됨 | 정상. `docker exec`로 접근. 외부에선 `team{N}` 계정만 |
| publisher 재시작 시 디바이스 다시 발행됨 | 의도된 동작 (DB 복원) | `restored: 디바이스 N개 발행 재개` 로그로 확인 |
| `messages` 테이블이 너무 커짐 | 2개월 운영 중 누적 | 주기적으로 `DELETE FROM messages WHERE published_at < NOW() - INTERVAL 7 DAY;` 또는 cron 등록 |

## 10. 보안 권고 (2개월 운영용)

- **MySQL 외부 노출**: 학생용으로 3306을 공개해야 하므로 ACG에서 가능하면 **수업 시간대만 오픈**, 또는 학생 IP CIDR로 제한
- **Mosquitto anonymous**: 의도된 설정이지만 외부에서 토픽 다 보임. 민감하면 `mosquitto.conf`에 `password_file` 추가 가능 (단 학생 작업 부담 증가)
- **`.env` / `credentials.txt`**: 권한 600, gitignore. 절대 git에 올리지 말 것
- **로그 누적**: pm2/docker 로그 주기적 rotate (`pm2 install pm2-logrotate`)
- **수업 종료 후**: VM 종료/삭제 또는 ACG 닫기
