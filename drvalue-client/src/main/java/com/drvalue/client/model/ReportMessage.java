package com.drvalue.client.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;

/**
 * 디바이스의 주기적 생체 데이터.
 *
 * <p>발행 주기는 {@code intervalMs}로 조절되며 (기본 5초), 등록 후
 * {@link com.drvalue.client.SihunClient#unregisterDevice} 호출 전까지 계속 흐릅니다.</p>
 *
 * <p>누적 필드({@code stepCount}, {@code lmaCount}, {@code calories},
 * {@code usageTimeSeconds})는 시뮬레이터 부팅 후 누적되며, 디바이스 삭제 시 0으로 초기화됩니다.</p>
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record ReportMessage(
        String type,
        @JsonProperty("tenantId") String tenantId,
        @JsonProperty("deviceId") String deviceId,
        @JsonProperty("modelName") String modelName,

        /** 0~100, 점진 감소 */
        double battery,

        /** 분당 호흡수 (12~25) */
        int breathRate,

        /** 누적 걸음수 */
        long stepCount,

        /** 누적 LMA(Low-back Movement Activity) */
        long lmaCount,

        /** 몸통 평균 각도 (도, 5~40) */
        double torsoAngleMean,

        /** 몸통 최소 각도 (도, 0~50) */
        double torsoAngleMin,

        /** 굽힘 지속 시간 (초, 0~120) */
        int bentDuration,

        /** 누적 칼로리 */
        double calories,

        double gpsLatitude,
        double gpsLongitude,

        /** 누적 사용 시간 (초) */
        long usageTimeSeconds,

        Instant timestamp
) implements DrValueMessage {
}
