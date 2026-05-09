package com.example.drvalue;

import com.drvalue.client.SihunClient;
import com.drvalue.client.model.EmergencyMessage;
import com.drvalue.client.model.PoweronMessage;
import com.drvalue.client.model.ReportMessage;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.atomic.AtomicLong;

/**
 * SihunClient에 핸들러를 등록해 MQTT 메세지를 콘솔에 출력 + 카운터에 누적.
 *
 * 자동 시작은 SihunClient의 SmartLifecycle이 처리하므로 별도 start() 호출 불필요.
 * 핸들러 등록은 @PostConstruct에서.
 */
@Component
public class DrValueIntegration {

    private static final Logger log = LoggerFactory.getLogger(DrValueIntegration.class);

    private final SihunClient client;

    final AtomicLong reportCount = new AtomicLong();
    final AtomicLong poweronCount = new AtomicLong();
    final AtomicLong emergencyCount = new AtomicLong();

    public DrValueIntegration(SihunClient client) {
        this.client = client;
    }

    @PostConstruct
    public void wire() {
        client.onReport(this::handleReport);
        client.onPoweron(this::handlePoweron);
        client.onEmergency(this::handleEmergency);
        log.info("✓ SihunClient 핸들러 등록 완료");
    }

    private void handleReport(ReportMessage r) {
        long n = reportCount.incrementAndGet();
        log.info("REPORT #{} {} batt={}% step={} breath={} ({}, {})",
                n, r.deviceId(),
                String.format("%.1f", r.battery()),
                r.stepCount(),
                r.breathRate(),
                String.format("%.4f", r.gpsLatitude()),
                String.format("%.4f", r.gpsLongitude()));
    }

    private void handlePoweron(PoweronMessage p) {
        long n = poweronCount.incrementAndGet();
        log.info("POWERON #{} {} model={} fw={}", n, p.deviceId(), p.modelName(), p.firmwareVersion());
    }

    private void handleEmergency(EmergencyMessage e) {
        long n = emergencyCount.incrementAndGet();
        log.warn("🚨 EMERGENCY #{} {} kind={} ({}, {})",
                n, e.deviceId(),
                e.emergencyLabel(),
                String.format("%.4f", e.gpsLatitude()),
                String.format("%.4f", e.gpsLongitude()));
    }
}
