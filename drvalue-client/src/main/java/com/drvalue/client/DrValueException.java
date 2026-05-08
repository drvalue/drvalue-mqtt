package com.drvalue.client;

/**
 * DrValue 클라이언트의 모든 런타임 예외.
 * REST 에러, MQTT 연결 실패, JSON 파싱 오류 등을 한 종류로 묶어 처리하기 쉽게 합니다.
 */
public class DrValueException extends RuntimeException {

    private final int statusCode;

    public DrValueException(String message) {
        super(message);
        this.statusCode = -1;
    }

    public DrValueException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = -1;
    }

    public DrValueException(String message, int statusCode) {
        super(message);
        this.statusCode = statusCode;
    }

    /** REST 응답의 HTTP 상태코드. 비-HTTP 오류면 {@code -1}. */
    public int statusCode() {
        return statusCode;
    }
}
