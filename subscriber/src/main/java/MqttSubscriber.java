import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttClient;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttMessage;

public class MqttSubscriber {

    private static final String BROKER_URL = "tcp://localhost:1883";
    private static final String CLIENT_ID = "java-subscriber";

    public static void main(String[] args) {
        String tenantId = args.length > 0 ? args[0] : "tenant-1";
        String topic = "drvalue/" + tenantId;

        try {
            MqttClient client = new MqttClient(BROKER_URL, CLIENT_ID);

            MqttConnectOptions options = new MqttConnectOptions();
            options.setCleanSession(true);
            options.setAutomaticReconnect(true);

            client.setCallback(new MqttCallback() {
                @Override
                public void connectionLost(Throwable cause) {
                    System.out.println("[Subscriber] 연결 끊김: " + cause.getMessage());
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    String payload = new String(message.getPayload());
                    String prefix = payload.contains("\"type\":\"emergency\"") ? "🚨 " : "";
                    System.out.println("[Subscriber] " + prefix + "수신 ← " + payload);
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                }
            });

            client.connect(options);
            System.out.println("[Subscriber] 브로커 연결 완료: " + BROKER_URL);
            System.out.println("[Subscriber] 토픽 구독: " + topic);
            System.out.println("[Subscriber] 메시지 대기 중...");

            client.subscribe(topic, 1);

        } catch (MqttException e) {
            System.err.println("[Subscriber] 오류: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
