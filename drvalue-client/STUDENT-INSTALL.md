# 학생용 — DrValue Client 한 페이지 설치 가이드

본인 Spring Boot 백엔드에 DrValue 시뮬레이터 통합 코드를 끼우는 방법.
**JitPack 방식**과 **JAR 직접 방식** 둘 중 하나 선택.

---

## ✅ 방법 1 — JitPack (권장)

### `build.gradle` 수정

```groovy
repositories {
    mavenCentral()
    maven { url 'https://jitpack.io' }       // ← 추가
}

dependencies {
    // 기존 의존성들...
    implementation 'com.github.<강사 GitHub 사용자>:drvalue-mqtt:<태그>'
    //                          ^^^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^
    //                            예: drvalue              예: v1.0.0
}
```

> 정확한 좌표(`<사용자>:<repo>:<태그>`)는 강사가 공지합니다.

### `application.yml`

```yaml
drvalue:
  broker-url:   tcp://<서버IP>:1883
  rest-api-url: http://<서버IP>:3000
  tenant-id:    tenant-1                # 본인 팀 (강사 배정)
  client-id:    team1-${random.uuid}    # 옵션
```

### 빌드 한 번 (Gradle이 JitPack에서 다운로드)

```bash
./gradlew build
```

처음 받을 때 JitPack이 빌드하느라 30~120초 걸릴 수 있습니다 (이후엔 캐시).

---

## ✅ 방법 2 — JAR 직접 (인터넷 제약 시)

강사가 `drvalue-client-<버전>.jar` 파일을 공유합니다 (Slack/USB/메일).

### 1) `libs/drvalue-client-1.0.0.jar` 로 저장

본인 프로젝트 루트에 `libs/` 폴더 만들고 JAR 복사.

### 2) `build.gradle` 수정

```groovy
dependencies {
    implementation files('libs/drvalue-client-1.0.0.jar')

    // JAR엔 transitive 의존성 정보가 없으니 직접 추가
    implementation 'org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5'
    // Spring Boot 프로젝트라면 jackson은 이미 있음. 아니라면:
    // implementation 'com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.17.2'
}
```

### 3) `application.yml` — 방법 1과 동일

---

## 통합 코드 작성 (방법 무관)

```java
import com.drvalue.client.SihunClient;
import com.drvalue.client.model.ReportMessage;
import com.drvalue.client.model.PoweronMessage;
import com.drvalue.client.model.EmergencyMessage;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class DrValueIntegration {

    private final SihunClient client;
    // 본인 Repository, Service 주입
    // private final ReportRepository reportRepo;
    // private final EmergencyService emergencyService;

    @PostConstruct
    public void wire() {
        client.onReport(this::handleReport);
        client.onPoweron(this::handlePoweron);
        client.onEmergency(this::handleEmergency);
    }

    private void handleReport(ReportMessage r) {
        log.debug("report {} {} batt={}", r.deviceId(), r.timestamp(), r.battery());
        // reportRepo.save(toEntity(r));
    }

    private void handlePoweron(PoweronMessage p) {
        log.info("디바이스 ON: {}", p.deviceId());
        // deviceRepo.markOnline(p.deviceId(), p.timestamp());
    }

    private void handleEmergency(EmergencyMessage e) {
        log.warn("🚨 응급 {} {} ({}, {})",
                e.deviceId(), e.emergencyLabel(), e.gpsLatitude(), e.gpsLongitude());
        // emergencyService.notify(e);
    }
}
```

## 임대 시작/종료 — 본인 RentalService에서

```java
@Service
@RequiredArgsConstructor
public class RentalService {

    private final SihunClient drValue;
    private final RentalRepository rentals;

    public void startRental(Long studentId, String deviceId) {
        rentals.save(new Rental(studentId, deviceId, Instant.now()));
        drValue.registerDevice(deviceId, "WF100", 5000);   // → 시뮬레이터 발행 시작
    }

    public void endRental(String deviceId) {
        rentals.markEnded(deviceId);
        drValue.unregisterDevice(deviceId);                 // → 발행 중지
    }
}
```

---

## 동작 확인

1. 앱 부팅 시 로그:
   ```
   [DrValue] 연결 완료 broker=tcp://...:1883 topic=drvalue/tenant-1 clientId=team1-...
   ```
2. 디바이스 등록 후 5초 이내 `report` 핸들러 호출되는지 (로그 또는 디버거)
3. `application.yml`의 `tenant-id`가 본인 팀과 일치하는지

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| `[DrValue] MQTT 시작 실패` | 브로커 IP/방화벽 | `application.yml` broker-url 확인, telnet 테스트 |
| `404 존재하지 않는 테넌트` | tenant-id 오타 | `tenant-1`~`tenant-5` 정확히 |
| `409 이미 등록된 디바이스` | publisher가 기억 중 | 본인 임대 DB와 동기화 — 부팅 시 활성 임대만 재등록 |
| 메세지 0건 | 디바이스 미등록 / 토픽 다름 | `client.listDevices()`로 확인 |
| 받다가 끊김 | client-id 충돌 | `${random.uuid}` 사용으로 유니크화 |
| 부팅 시 핸들러 등록 누락 | 핸들러 등록 위치 | `@PostConstruct` 안에서 등록 (생성자 X) |
| `자동 시작` 끄고 수동 제어 | `auto-start: false` | `client.start()` / `client.close()` 직접 호출 |

---

## 안 쓰고 싶다면

자동 시작을 끄고 수동으로:

```yaml
drvalue:
  auto-start: false
```

```java
@PostConstruct void wire() {
    client.onReport(...);
    client.start();        // 직접 시작
}
```
