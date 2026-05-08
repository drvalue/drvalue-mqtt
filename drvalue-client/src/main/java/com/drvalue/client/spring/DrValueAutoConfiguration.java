package com.drvalue.client.spring;

import com.drvalue.client.SihunClient;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.Bean;

/**
 * Spring Boot 자동 설정.
 *
 * <p>{@code application.yml}의 {@code drvalue.broker-url}, {@code rest-api-url},
 * {@code tenant-id}가 모두 있으면 {@link SihunClient} 빈을 자동 등록합니다.</p>
 *
 * <p>학생들은 이 빈을 주입받아 핸들러만 붙이면 됩니다 — 시작은 자동:</p>
 *
 * <pre>{@code
 * @Component
 * @RequiredArgsConstructor
 * public class DrValueIntegration {
 *     private final SihunClient client;
 *     private final ReportRepository reportRepo;
 *
 *     @PostConstruct
 *     public void wire() {
 *         client.onReport(reportRepo::saveFromMessage);
 *         client.onEmergency(e -> log.warn("응급 {}", e.emergencyLabel()));
 *     }
 * }
 * }</pre>
 *
 * <p>핸들러 등록은 {@code @PostConstruct}에 둡니다. 자동 시작 ({@code drvalue.auto-start=true},
 * 기본값)은 모든 빈의 {@code @PostConstruct}가 끝난 후 {@link SmartLifecycle#start()} 단계에서
 * 호출되므로 핸들러 누락 걱정이 없습니다.</p>
 *
 * <p>자동 시작을 끄려면 {@code drvalue.auto-start=false}로 두고 직접 {@code client.start()}.</p>
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "drvalue", name = {"broker-url", "rest-api-url", "tenant-id"})
@EnableConfigurationProperties(DrValueProperties.class)
public class DrValueAutoConfiguration {

    @Bean(destroyMethod = "close")
    @ConditionalOnMissingBean
    public SihunClient sihunClient(DrValueProperties props) {
        SihunClient.Builder b = SihunClient.builder()
                .brokerUrl(props.getBrokerUrl())
                .restApiUrl(props.getRestApiUrl())
                .tenantId(props.getTenantId())
                .qos(props.getQos())
                .restTimeout(props.getRestTimeout());
        if (props.getClientId() != null) b.clientId(props.getClientId());
        return b.build();
    }

    @Bean
    @ConditionalOnProperty(prefix = "drvalue", name = "auto-start", havingValue = "true", matchIfMissing = true)
    public SmartLifecycle drValueAutoStarter(SihunClient client) {
        return new DrValueLifecycle(client);
    }

    /**
     * 모든 빈의 {@code @PostConstruct}가 끝난 후 한 박자 늦게 시작 → 학생이 핸들러를
     * {@code @PostConstruct}에서 등록할 시간을 확보합니다. 컨텍스트 종료 시 자동으로 close.
     */
    static class DrValueLifecycle implements SmartLifecycle {
        private final SihunClient client;
        private volatile boolean running = false;

        DrValueLifecycle(SihunClient client) { this.client = client; }

        @Override public void start() { client.start(); running = true; }
        @Override public void stop()  { running = false; /* close()는 destroyMethod로 처리 */ }
        @Override public boolean isRunning() { return running; }
        @Override public int getPhase() { return Integer.MAX_VALUE - 100; } // 늦게 시작, 일찍 정지
    }
}
