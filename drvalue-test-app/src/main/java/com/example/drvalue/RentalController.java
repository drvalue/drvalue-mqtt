package com.example.drvalue;

import com.drvalue.client.DrValueException;
import com.drvalue.client.SihunClient;
import com.drvalue.client.model.DeviceInfo;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 임대 시작/종료를 시뮬레이션하는 단순한 REST 컨트롤러.
 *
 * <pre>
 *   POST   /rentals          { "deviceId": "...", "modelName": "...", "intervalMs": 5000 }
 *   DELETE /rentals/{id}
 *   GET    /rentals
 *   GET    /rentals/stats
 * </pre>
 */
@RestController
@RequestMapping("/rentals")
public class RentalController {

    private final SihunClient client;
    private final DrValueIntegration integration;

    public RentalController(SihunClient client, DrValueIntegration integration) {
        this.client = client;
        this.integration = integration;
    }

    @PostMapping
    public ResponseEntity<?> startRental(@RequestBody StartRequest req) {
        try {
            DeviceInfo info = client.registerDevice(
                    req.deviceId(),
                    req.modelName() != null ? req.modelName() : "WF100",
                    req.intervalMs() != null ? req.intervalMs() : 5000
            );
            return ResponseEntity.status(201).body(info);
        } catch (DrValueException e) {
            return ResponseEntity.status(e.statusCode() > 0 ? e.statusCode() : 500)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{deviceId}")
    public ResponseEntity<?> endRental(@PathVariable String deviceId) {
        try {
            client.unregisterDevice(deviceId);
            return ResponseEntity.ok(Map.of("deviceId", deviceId, "status", "unregistered"));
        } catch (DrValueException e) {
            return ResponseEntity.status(e.statusCode() > 0 ? e.statusCode() : 500)
                    .body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping
    public List<DeviceInfo> list() {
        return client.listDevices();
    }

    @GetMapping("/stats")
    public Map<String, Long> stats() {
        return Map.of(
                "report", integration.reportCount.get(),
                "poweron", integration.poweronCount.get(),
                "emergency", integration.emergencyCount.get()
        );
    }

    public record StartRequest(String deviceId, String modelName, Integer intervalMs) {}
}
