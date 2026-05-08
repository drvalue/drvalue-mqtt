package com.drvalue.client.model;

import java.time.Instant;

/**
 * DrValue 시뮬레이터가 발행하는 모든 MQTT 메세지의 공통 인터페이스.
 *
 * <p>실제 메세지는 페이로드 {@code type} 필드에 따라 다음 세 가지로 디스패치됩니다:</p>
 * <ul>
 *   <li>{@link ReportMessage} — {@code type=report}, 주기적 생체 데이터</li>
 *   <li>{@link PoweronMessage} — {@code type=poweron}, 디바이스 등록 시 1회</li>
 *   <li>{@link EmergencyMessage} — {@code type=emergency}, 응급 이벤트</li>
 * </ul>
 */
public sealed interface DrValueMessage
        permits ReportMessage, PoweronMessage, EmergencyMessage {

    /** {@code report} | {@code poweron} | {@code emergency} */
    String type();

    /** 테넌트(팀) 식별자, 예: {@code tenant-1} */
    String tenantId();

    /** 디바이스 식별자, 예: {@code DEV-001} */
    String deviceId();

    /** 발행 시각 (UTC) */
    Instant timestamp();
}
