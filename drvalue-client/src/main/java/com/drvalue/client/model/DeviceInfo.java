package com.drvalue.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;

/**
 * Publisher REST API의 디바이스 표현.
 *
 * <p>{@link com.drvalue.client.SihunClient#registerDevice} 응답과 {@code listDevices} 결과에 사용됩니다.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record DeviceInfo(
        String tenantId,
        String deviceId,
        String modelName,
        long intervalMs,
        String topic,
        String status,
        Instant registeredAt
) {
}
