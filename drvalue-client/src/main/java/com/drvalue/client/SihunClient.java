package com.drvalue.client;

import com.drvalue.client.model.DeviceInfo;
import com.drvalue.client.model.DrValueMessage;
import com.drvalue.client.model.EmergencyMessage;
import com.drvalue.client.model.PoweronMessage;
import com.drvalue.client.model.ReportMessage;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * DrValue MQTT 시뮬레이터에 통합하는 학생용 클라이언트.
 *
 * <h2>사용 예시</h2>
 * <pre>{@code
 * SihunClient client = SihunClient.builder()
 *     .brokerUrl("tcp://server:1883")
 *     .restApiUrl("http://server:3000")
 *     .tenantId("tenant-1")
 *     .clientId("team1-" + UUID.randomUUID())
 *     .build();
 *
 * client.onReport(report -> repo.save(report));
 * client.onEmergency(emer -> alertService.notify(emer));
 * client.onPoweron(pwr -> deviceRepo.markOnline(pwr.deviceId()));
 *
 * client.start();          // MQTT 연결 + 구독
 * client.registerDevice("DEV-001", "WF100", 5000);   // 임대 시작 시
 * // ...
 * client.unregisterDevice("DEV-001");                 // 임대 종료 시
 * client.close();
 * }</pre>
 *
 * <h2>스레드 안전성</h2>
 * <p>핸들러는 Paho MQTT 콜백 스레드에서 호출됩니다. 핸들러 안에서 무거운 작업을 하면
 * 후속 메세지 처리가 지연되니, 필요하면 별도 큐/Executor로 위임하세요.</p>
 */
public class SihunClient implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SihunClient.class);
    private static final String TOPIC_PREFIX = "drvalue";

    private final String brokerUrl;
    private final String restApiUrl;
    private final String tenantId;
    private final String clientId;
    private final int qos;
    private final Duration restTimeout;

    private final HttpClient http;
    private final ObjectMapper mapper;

    private volatile MqttClient mqtt;

    private final Map<String, Consumer<DrValueMessage>> typeHandlers = new HashMap<>();
    private volatile Consumer<DrValueMessage> catchAllHandler;
    private volatile Consumer<Throwable> errorHandler = e -> log.error("[DrValue] 처리 오류", e);

    private SihunClient(Builder b) {
        this.brokerUrl = Objects.requireNonNull(b.brokerUrl, "brokerUrl");
        this.restApiUrl = stripTrailingSlash(Objects.requireNonNull(b.restApiUrl, "restApiUrl"));
        this.tenantId = Objects.requireNonNull(b.tenantId, "tenantId");
        this.clientId = b.clientId != null ? b.clientId : "drvalue-" + UUID.randomUUID();
        this.qos = b.qos;
        this.restTimeout = b.restTimeout;

        this.http = HttpClient.newBuilder().connectTimeout(restTimeout).build();
        this.mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    private static String stripTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    public static Builder builder() {
        return new Builder();
    }

    // ============= Public API: Handlers =============

    /** report 메세지 수신 시 호출됩니다. 같은 타입의 핸들러를 다시 호출하면 덮어씁니다. */
    public SihunClient onReport(Consumer<ReportMessage> handler) {
        typeHandlers.put("report", cast(handler));
        return this;
    }

    public SihunClient onPoweron(Consumer<PoweronMessage> handler) {
        typeHandlers.put("poweron", cast(handler));
        return this;
    }

    public SihunClient onEmergency(Consumer<EmergencyMessage> handler) {
        typeHandlers.put("emergency", cast(handler));
        return this;
    }

    /** 모든 메세지를 한 핸들러로 받고 싶을 때. type별 핸들러와 병행 사용 가능. */
    public SihunClient onMessage(Consumer<DrValueMessage> handler) {
        this.catchAllHandler = handler;
        return this;
    }

    /** 핸들러 내부 예외를 처리하고 싶을 때. 미설정 시 SLF4J에 ERROR로 로깅. */
    public SihunClient onError(Consumer<Throwable> handler) {
        this.errorHandler = Objects.requireNonNull(handler);
        return this;
    }

    @SuppressWarnings("unchecked")
    private static <T extends DrValueMessage> Consumer<DrValueMessage> cast(Consumer<T> h) {
        return msg -> h.accept((T) msg);
    }

    // ============= Public API: Lifecycle =============

    /** MQTT 브로커 연결 + 토픽 구독. 멱등하지 않으니 한 번만 호출하세요. */
    public synchronized void start() {
        if (mqtt != null && mqtt.isConnected()) {
            log.warn("[DrValue] 이미 시작됨");
            return;
        }
        try {
            mqtt = new MqttClient(brokerUrl, clientId, new MemoryPersistence());
            MqttConnectOptions opts = new MqttConnectOptions();
            opts.setCleanSession(true);
            opts.setAutomaticReconnect(true);
            opts.setConnectionTimeout(30);
            opts.setKeepAliveInterval(60);

            mqtt.setCallback(new MqttCallback() {
                @Override
                public void connectionLost(Throwable cause) {
                    log.warn("[DrValue] 연결 끊김: {}", cause != null ? cause.getMessage() : "?");
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    handleIncoming(message.getPayload());
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) { /* unused */ }
            });

            mqtt.connect(opts);
            String topic = TOPIC_PREFIX + "/" + tenantId;
            mqtt.subscribe(topic, qos);
            log.info("[DrValue] 연결 완료 broker={} topic={} clientId={}", brokerUrl, topic, clientId);
        } catch (MqttException e) {
            throw new DrValueException("MQTT 시작 실패: " + e.getMessage(), e);
        }
    }

    private void handleIncoming(byte[] payload) {
        try {
            JsonNode node = mapper.readTree(payload);
            String type = node.path("type").asText("");
            DrValueMessage msg = switch (type) {
                case "report"    -> mapper.treeToValue(node, ReportMessage.class);
                case "poweron"   -> mapper.treeToValue(node, PoweronMessage.class);
                case "emergency" -> mapper.treeToValue(node, EmergencyMessage.class);
                default -> {
                    log.warn("[DrValue] 알 수 없는 type: {}", type);
                    yield null;
                }
            };
            if (msg == null) return;

            Consumer<DrValueMessage> typed = typeHandlers.get(type);
            if (typed != null) safeRun(() -> typed.accept(msg));
            if (catchAllHandler != null) safeRun(() -> catchAllHandler.accept(msg));
        } catch (Exception e) {
            errorHandler.accept(e);
        }
    }

    private void safeRun(Runnable r) {
        try { r.run(); } catch (Exception e) { errorHandler.accept(e); }
    }

    @Override
    public synchronized void close() {
        if (mqtt == null) return;
        try {
            if (mqtt.isConnected()) mqtt.disconnect();
            mqtt.close();
        } catch (MqttException e) {
            log.warn("[DrValue] 종료 중 오류: {}", e.getMessage());
        } finally {
            mqtt = null;
        }
    }

    // ============= Public API: REST =============

    /**
     * 디바이스 임대 시작 시 호출. Publisher에 등록되면 즉시 {@link PoweronMessage}가 발행됩니다.
     *
     * @param deviceId   고유 디바이스 ID (예: {@code "DEV-001"})
     * @param modelName  디바이스 모델명 (예: {@code "WF100"})
     * @param intervalMs report 발행 주기 (100~600000)
     * @return Publisher가 반환한 디바이스 정보
     * @throws DrValueException 409 — 이미 등록된 deviceId, 404 — 잘못된 tenant, 5xx — 서버 오류
     */
    public DeviceInfo registerDevice(String deviceId, String modelName, int intervalMs) {
        Map<String, Object> body = new HashMap<>();
        body.put("deviceId", deviceId);
        body.put("modelName", modelName);
        body.put("intervalMs", intervalMs);
        return restPost("/api/tenants/" + tenantId + "/devices", body, DeviceInfo.class);
    }

    /** 디바이스 임대 종료 시 호출. Publisher의 발행이 즉시 멈춥니다. */
    public void unregisterDevice(String deviceId) {
        restDelete("/api/tenants/" + tenantId + "/devices/" + deviceId);
    }

    /** 본인 팀의 등록된 디바이스 전체 조회. */
    public List<DeviceInfo> listDevices() {
        return restGetList("/api/tenants/" + tenantId + "/devices");
    }

    /** 단건 조회. 미존재 시 {@link DrValueException}(404). */
    public DeviceInfo getDevice(String deviceId) {
        return restGet("/api/tenants/" + tenantId + "/devices/" + deviceId, DeviceInfo.class);
    }

    // ============= Internal: HTTP =============

    private <T> T restPost(String path, Object body, Class<T> type) {
        try {
            String json = mapper.writeValueAsString(body);
            HttpRequest req = HttpRequest.newBuilder(URI.create(restApiUrl + path))
                    .timeout(restTimeout)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return parseOrFail(res, type);
        } catch (DrValueException e) {
            throw e;
        } catch (Exception e) {
            throw new DrValueException("REST POST 실패: " + path + " — " + e.getMessage(), e);
        }
    }

    private void restDelete(String path) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(restApiUrl + path))
                    .timeout(restTimeout)
                    .DELETE()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() >= 300) {
                throw new DrValueException("REST DELETE 실패: " + extractError(res), res.statusCode());
            }
        } catch (DrValueException e) {
            throw e;
        } catch (Exception e) {
            throw new DrValueException("REST DELETE 실패: " + path + " — " + e.getMessage(), e);
        }
    }

    private <T> T restGet(String path, Class<T> type) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(restApiUrl + path))
                    .timeout(restTimeout)
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            return parseOrFail(res, type);
        } catch (DrValueException e) {
            throw e;
        } catch (Exception e) {
            throw new DrValueException("REST GET 실패: " + path + " — " + e.getMessage(), e);
        }
    }

    private <T> List<T> restGetList(String path) {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(restApiUrl + path))
                    .timeout(restTimeout)
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (res.statusCode() >= 300) {
                throw new DrValueException("REST GET 실패: " + extractError(res), res.statusCode());
            }
            return mapper.readValue(res.body(),
                    mapper.getTypeFactory().constructCollectionType(List.class, DeviceInfo.class));
        } catch (DrValueException e) {
            throw e;
        } catch (Exception e) {
            throw new DrValueException("REST GET 실패: " + path + " — " + e.getMessage(), e);
        }
    }

    private <T> T parseOrFail(HttpResponse<String> res, Class<T> type) throws Exception {
        if (res.statusCode() >= 300) {
            throw new DrValueException(extractError(res), res.statusCode());
        }
        return mapper.readValue(res.body(), type);
    }

    private String extractError(HttpResponse<String> res) {
        try {
            JsonNode node = mapper.readTree(res.body());
            String err = node.path("error").asText("");
            if (!err.isEmpty()) return res.statusCode() + " " + err;
        } catch (Exception ignore) { /* fall through */ }
        return res.statusCode() + " " + res.body();
    }

    // ============= Builder =============

    public static final class Builder {
        private String brokerUrl;
        private String restApiUrl;
        private String tenantId;
        private String clientId;
        private int qos = 1;
        private Duration restTimeout = Duration.ofSeconds(10);

        /** 예: {@code tcp://server:1883} */
        public Builder brokerUrl(String brokerUrl) { this.brokerUrl = brokerUrl; return this; }

        /** 예: {@code http://server:3000} (마지막 슬래시는 자동 제거) */
        public Builder restApiUrl(String restApiUrl) { this.restApiUrl = restApiUrl; return this; }

        /** 본인 팀 식별자, 예: {@code tenant-1} */
        public Builder tenantId(String tenantId) { this.tenantId = tenantId; return this; }

        /**
         * MQTT client ID. 같은 ID로 두 클라이언트가 붙으면 먼저 붙어있던 쪽이 끊깁니다.
         * 미지정 시 {@code drvalue-<UUID>}로 자동 생성됩니다.
         */
        public Builder clientId(String clientId) { this.clientId = clientId; return this; }

        /** MQTT 구독 QoS. 기본 {@code 1}. */
        public Builder qos(int qos) { this.qos = qos; return this; }

        public Builder restTimeout(Duration timeout) { this.restTimeout = timeout; return this; }

        public SihunClient build() {
            return new SihunClient(this);
        }
    }
}
