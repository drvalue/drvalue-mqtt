package com.drvalue.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.Instant;

/**
 * 디바이스 등록 직후 1회 발행되는 전원 켜짐 신호.
 * 학생 백엔드는 이 메세지를 받아 디바이스를 "온라인"으로 표시할 수 있습니다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PoweronMessage(
        String type,
        String tenantId,
        String deviceId,
        String modelName,
        String firmwareVersion,
        Instant timestamp
) implements DrValueMessage {
}
