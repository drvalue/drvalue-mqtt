package com.drvalue.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;

/**
 * 응급 이벤트. 매초 1.5% 확률로 랜덤 발생합니다.
 *
 * <p>{@code emergencyType}:</p>
 * <ul>
 *   <li>0 — 낙상</li>
 *   <li>1 — 과호흡</li>
 *   <li>2 — 과활동</li>
 *   <li>3 — 과작업</li>
 * </ul>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EmergencyMessage(
        String type,
        String tenantId,
        String deviceId,
        int emergencyType,
        String emergencyLabel,
        double gpsLatitude,
        double gpsLongitude,
        Instant timestamp
) implements DrValueMessage {

    public enum Kind {
        FALL(0, "낙상"),
        HYPERVENTILATION(1, "과호흡"),
        OVERACTIVITY(2, "과활동"),
        OVERWORK(3, "과작업");

        public final int code;
        public final String label;
        Kind(int code, String label) { this.code = code; this.label = label; }

        public static Kind of(int code) {
            for (Kind k : values()) if (k.code == code) return k;
            throw new IllegalArgumentException("Unknown emergencyType: " + code);
        }
    }

    public Kind kind() { return Kind.of(emergencyType); }
}
