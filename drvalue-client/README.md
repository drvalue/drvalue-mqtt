# DrValue Client (Java / Spring Boot)

DrValue MQTT 시뮬레이터에 통합하는 학생용 클라이언트 라이브러리.

- **REST**: 디바이스 등록/제거 (`POST/DELETE /api/tenants/{tenantId}/devices`)
- **MQTT**: 본인 팀 토픽(`drvalue/{tenantId}`) 구독 + 메세지 type별 디스패치
- **Spring Boot 자동 설정**: `application.yml`만 채우면 빈 자동 생성

Java 17+ / Spring Boot 3.x 기준.

---

## 1. 설치

학생용 단축 가이드는 [`STUDENT-INSTALL.md`](./STUDENT-INSTALL.md). 강사용 배포 흐름은
이 문서 마지막 섹션 [**강사 — 배포 워크플로우**](#강사--배포-워크플로우) 참고.

### A. JitPack — 권장 (추천: 5팀 동시 진행)

```groovy
repositories {
    mavenCentral()
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.<github-user>:drvalue-mqtt:<tag>'
}
```

좌표는 강사가 공지 (예: `com.github.drvalue:drvalue-mqtt:v1.0.0`).
JitPack이 첫 요청 시 빌드 → 캐시 → 이후엔 즉시.

### B. JAR 직접 (오프라인)

본인 프로젝트의 `libs/`에 강사가 공유한 `drvalue-client-<버전>.jar` 복사 후:

```groovy
dependencies {
    implementation files('libs/drvalue-client-1.0.0.jar')
    implementation 'org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5'
    // Spring Boot면 jackson은 이미 있음
}
```

### C. 강사 머신 로컬 Maven

```bash
cd drvalue-mqtt/drvalue-client
./gradlew publishToMavenLocal     # ~/.m2/repository
```
```groovy
repositories { mavenLocal() }
dependencies { implementation 'com.drvalue:drvalue-client:1.0.0' }
```

---

## 2. Spring Boot에서 사용 (가장 권장)

### `application.yml`

```yaml
drvalue:
  broker-url:   tcp://<강사 서버 IP>:1883
  rest-api-url: http://<강사 서버 IP>:3000
  tenant-id:    tenant-1                # 본인 팀
  client-id:    team1-${random.uuid}    # 옵션 (미지정 시 자동 생성)
  qos:          1
  rest-timeout: 10s
  auto-start:   true                    # 빈 생성 후 자동으로 connect+subscribe
```

### 핸들러 빈 작성

```java
import com.drvalue.client.SihunClient;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class DrValueIntegration {

    private final SihunClient client;
    private final ReportRepository reportRepo;
    private final EmergencyService emergencyService;
    private final DeviceRepository deviceRepo;

    @PostConstruct
    public void wire() {
        client.onReport(report -> {
            reportRepo.save(toEntity(report));
        });
        client.onPoweron(pwr -> {
            deviceRepo.markOnline(pwr.deviceId(), pwr.timestamp());
        });
        client.onEmergency(emer -> {
            log.warn("🚨 응급 {} {} ({}, {})",
                    emer.deviceId(), emer.emergencyLabel(),
                    emer.gpsLatitude(), emer.gpsLongitude());
            emergencyService.notify(emer);
        });
    }
}
```

### 임대 시작/종료 로직

```java
@Service
@RequiredArgsConstructor
public class RentalService {
    private final SihunClient drValue;
    private final RentalRepository rentals;

    public void startRental(String studentId, String deviceId) {
        rentals.save(new Rental(studentId, deviceId, Instant.now()));
        drValue.registerDevice(deviceId, "WF100", 5000);   // → MQTT 발행 시작
    }

    public void endRental(String deviceId) {
        rentals.markEnded(deviceId);
        drValue.unregisterDevice(deviceId);                 // → MQTT 발행 중지
    }
}
```

이게 끝. **Spring이 알아서**:
1. `application.yml` 읽음
2. `SihunClient` 빈 생성
3. 모든 빈 초기화 후 자동으로 MQTT 연결 + 구독 시작
4. 앱 종료 시 `client.close()` 자동 호출

---

## 3. Spring 없이 쓰기 (또는 수동 빈 등록)

```java
SihunClient client = SihunClient.builder()
        .brokerUrl("tcp://server:1883")
        .restApiUrl("http://server:3000")
        .tenantId("tenant-1")
        .clientId("team1-" + UUID.randomUUID())
        .build();

client.onReport(r -> System.out.println(r));
client.onEmergency(e -> System.err.println("🚨 " + e.emergencyLabel()));

client.start();                                 // MQTT 연결 + 구독
client.registerDevice("DEV-001", "WF100", 5000);

// ... 앱 동작 중

client.unregisterDevice("DEV-001");
client.close();
```

---

## 4. 메세지 모델

| 클래스 | type | 발생 시점 | 주요 필드 |
|---|---|---|---|
| `ReportMessage`    | `report`    | `intervalMs` 주기 | battery, breathRate, stepCount, lmaCount, calories, gps... |
| `PoweronMessage`   | `poweron`   | 등록 직후 1회 | firmwareVersion |
| `EmergencyMessage` | `emergency` | 매초 1.5% 확률 | emergencyType (0~3), emergencyLabel |

모든 메세지는 `DrValueMessage` sealed interface 구현체입니다.

**Java 17 호환 (instanceof 패턴):**
```java
client.onMessage(msg -> {
    if (msg instanceof ReportMessage r)         reportRepo.save(r);
    else if (msg instanceof PoweronMessage p)   deviceRepo.markOnline(p.deviceId());
    else if (msg instanceof EmergencyMessage e) emergencyService.notify(e);
});
```

**Java 21+ (switch 패턴):**
```java
client.onMessage(msg -> {
    switch (msg) {
        case ReportMessage r    -> reportRepo.save(r);
        case PoweronMessage p   -> deviceRepo.markOnline(p.deviceId());
        case EmergencyMessage e -> emergencyService.notify(e);
    }
});
```

> **권장**: 위처럼 한 핸들러로 받기보다 `client.onReport(...)`/`onEmergency(...)`처럼
> type별 핸들러를 따로 등록하면 타입 캐스팅 없이 깔끔합니다.

응급 타입을 enum으로:
```java
client.onEmergency(emer -> {
    switch (emer.kind()) {
        case FALL              -> /* 낙상 */;
        case HYPERVENTILATION  -> /* 과호흡 */;
        case OVERACTIVITY      -> /* 과활동 */;
        case OVERWORK          -> /* 과작업 */;
    }
});
```

---

## 5. 예외 처리

```java
try {
    drValue.registerDevice(deviceId, "WF100", 5000);
} catch (DrValueException e) {
    if (e.statusCode() == 409) {
        // 이미 등록된 디바이스 — 임대관리 DB와 publisher 상태가 어긋난 상황
        // 보통 publisher 재시작 후 재등록할 때 발생
        log.warn("이미 등록됨, 무시: {}", deviceId);
    } else if (e.statusCode() == 404) {
        log.error("tenant-id 잘못 설정됨: {}", drValue);
        throw e;
    } else {
        throw e;
    }
}
```

핸들러 내부 예외 처리:
```java
client.onError(err -> log.error("핸들러 처리 중 오류", err));
```

---

## 6. 자주 묻는 함정

- **`client-id` 충돌**: 같은 ID로 두 인스턴스가 붙으면 먼저 붙어있던 쪽이 끊깁니다.
  팀원과 동시 개발 시 반드시 유니크하게 (`${random.uuid}` 권장).
- **핸들러 등록 시점**: `auto-start: true`(기본)면 모든 빈의 `@PostConstruct`가 끝난 뒤에 시작됩니다.
  핸들러 등록은 반드시 `@PostConstruct` 안에 (생성자 주입 단계는 너무 이를 수 있음).
- **Publisher 재시작**: 강사가 publisher를 재시작하면 등록된 디바이스가 모두 사라집니다.
  본인 임대 DB에서 활성 임대를 읽어 다시 `registerDevice`로 등록하는 복구 로직을 추가하면 안전.
- **무거운 핸들러**: Paho 콜백 스레드는 한 개라 핸들러가 느리면 다음 메세지가 밀립니다.
  DB I/O가 무거우면 `@Async`나 `BlockingQueue`로 위임하세요.
- **시간대**: `timestamp`는 UTC ISO-8601. `Instant`로 그대로 받아 KST가 필요할 때만 변환.

---

## 7. 자가 검증

```java
@SpringBootTest
class SihunClientIntegrationTest {
    @Autowired SihunClient client;

    @Test
    void registerAndUnregister() {
        DeviceInfo info = client.registerDevice("TEST-1", "WF100", 1000);
        assertThat(info.deviceId()).isEqualTo("TEST-1");

        // 잠시 대기 후 메세지 수신 확인 (CountDownLatch 등)

        client.unregisterDevice("TEST-1");
    }
}
```

---

## 8. 다음 단계

이 라이브러리가 처리하는 일:
- ✅ MQTT 연결/구독/재연결 (`automatic reconnect`)
- ✅ JSON 파싱 + type별 디스패치
- ✅ REST 호출 + 에러 변환
- ✅ Spring Boot 자동 설정

**처리하지 않는 일** (학생 책임):
- ❌ 수신한 데이터를 DB에 저장
- ❌ 응급 알림 채널 (Slack/이메일/푸시)
- ❌ 임대 관리 비즈니스 로직
- ❌ 디바이스 등록 권한 검사

`@PostConstruct`에 본인 비즈니스 로직을 연결해 시작하세요.

---

## 강사 — 배포 워크플로우

### 1) 코드 변경 후 GitHub에 태그 push

```bash
# 변경 커밋
git add drvalue-client/
git commit -m "feat(client): ..."
git push

# 새 버전 태그
git tag v1.0.1
git push origin v1.0.1
```

JitPack이 처음 요청 받을 때 자동 빌드. 학생들은 `build.gradle`에서 버전만 올리면 됨.

### 2) JitPack 빌드 검증 (학생 안내 전)

브라우저로:
```
https://jitpack.io/com/github/<github-user>/drvalue-mqtt/<tag>/build.log
```

`BUILD SUCCESS` 떠야 학생들 사용 가능. 처음엔 1~3분 걸립니다.

### 3) 학생들에게 좌표 공지

```
implementation 'com.github.<github-user>:drvalue-mqtt:<tag>'
```

### 4) (백업) JAR 직접 배포

```bash
cd drvalue-client
./gradlew clean build
# build/libs/drvalue-client-1.0.0.jar 생성
# Slack/구글드라이브/USB로 학생들에게 배포
```

`./gradlew publishToMavenLocal` → 서버 자체에서 임시 Maven 호스팅도 가능 (학생들이 서버
원격 저장소를 mavenRepo로 추가).

### 5) 로컬 빌드 검증

```bash
cd drvalue-client
./gradlew clean build javadoc
ls build/libs/        # drvalue-client-1.0.0.jar, ...sources.jar, ...javadoc.jar
```

빌드 시 javadoc에 한글 사용 가능 (UTF-8 + Xdoclint:none 설정됨).
