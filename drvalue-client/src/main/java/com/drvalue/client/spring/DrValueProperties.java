package com.drvalue.client.spring;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * Spring Boot {@code application.yml} 바인딩용 속성.
 *
 * <pre>
 * drvalue:
 *   broker-url: tcp://server:1883
 *   rest-api-url: http://server:3000
 *   tenant-id: tenant-1
 *   client-id: team1-${random.uuid}    # 옵션
 *   qos: 1                              # 옵션
 *   rest-timeout: 10s                   # 옵션
 *   auto-start: true                    # 옵션 (기본 true)
 * </pre>
 */
@ConfigurationProperties(prefix = "drvalue")
public class DrValueProperties {

    private String brokerUrl;
    private String restApiUrl;
    private String tenantId;
    private String clientId;
    private int qos = 1;
    private Duration restTimeout = Duration.ofSeconds(10);
    private boolean autoStart = true;

    public String getBrokerUrl() { return brokerUrl; }
    public void setBrokerUrl(String v) { this.brokerUrl = v; }

    public String getRestApiUrl() { return restApiUrl; }
    public void setRestApiUrl(String v) { this.restApiUrl = v; }

    public String getTenantId() { return tenantId; }
    public void setTenantId(String v) { this.tenantId = v; }

    public String getClientId() { return clientId; }
    public void setClientId(String v) { this.clientId = v; }

    public int getQos() { return qos; }
    public void setQos(int v) { this.qos = v; }

    public Duration getRestTimeout() { return restTimeout; }
    public void setRestTimeout(Duration v) { this.restTimeout = v; }

    public boolean isAutoStart() { return autoStart; }
    public void setAutoStart(boolean v) { this.autoStart = v; }
}
