# drvalue-test-app

DrValue 시뮬레이터 + SihunClient 라이브러리 통합 검증용 Spring Boot 앱.

학생들에게 보여줄 **레퍼런스 구현** 역할도 겸합니다.

## 동작 개요

1. 부팅 시 `application.yml`의 `drvalue.*` 속성으로 `SihunClient` 빈 자동 생성
2. `DrValueIntegration`이 핸들러 등록 → 메세지 카운터 누적 + 콘솔 로그
3. `RentalController`가 임대 시작/종료 REST 엔드포인트 노출
4. SmartLifecycle이 모든 빈 초기화 후 MQTT 자동 connect/subscribe

## 실행

`application.yml`에서 `drvalue.broker-url` / `rest-api-url`을 본인 서버로 수정 후:

```bash
cd drvalue-test-app
./gradlew bootRun
```

부팅 로그에 다음 라인이 떠야 정상:

```
✓ SihunClient 핸들러 등록 완료
[DrValue] 연결 완료 broker=tcp://...:1883 topic=drvalue/tenant-1 clientId=test-app-...
```

## 동작 검증

### 1) 임대 시작 (디바이스 등록)
```bash
curl -X POST http://localhost:8080/rentals \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"TEST-001","modelName":"WF100","intervalMs":3000}'
```

### 2) 메세지 흐르는 거 확인
- 콘솔에 `POWERON` 1회 → 3초마다 `REPORT` 로그
- 카운터 조회:
  ```bash
  curl http://localhost:8080/rentals/stats
  # {"report":12,"poweron":1,"emergency":0}
  ```

### 3) 응급 이벤트
1.5%/sec 확률이라 보통 1~5분 안에 한 건 옵니다 (`🚨 EMERGENCY #1 ...` 경고 로그).

### 4) 임대 종료
```bash
curl -X DELETE http://localhost:8080/rentals/TEST-001
# 발행 즉시 멈춤
```

### 5) 등록 디바이스 목록
```bash
curl http://localhost:8080/rentals
```

## 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| `[DrValue] MQTT 시작 실패: Connection refused` | `application.yml` broker-url 확인 / 서버 1883 포트 도달 가능한지 |
| `404 존재하지 않는 테넌트` | `tenant-id` 오타 — `tenant-1` ~ `tenant-5`만 가능 |
| `409 이미 등록된 디바이스` | 같은 deviceId로 두 번 등록 — DELETE 먼저 |
| 빌드 시 JitPack 다운로드 실패 | 첫 호출이면 1~3분 빌드 대기, 이후 캐시됨 |

## 학생 백엔드와 차이점

학생 본인 백엔드는 임대 비즈니스 로직과 DB 저장이 추가됩니다:

```java
private void handleReport(ReportMessage r) {
    reportRepo.save(toEntity(r));   // ← 본인 DB로 저장 추가
}
```

이 테스트 앱은 그저 콘솔에 찍기만 하므로 DB 연결 없이도 통합 동작을 확인할 수 있습니다.
