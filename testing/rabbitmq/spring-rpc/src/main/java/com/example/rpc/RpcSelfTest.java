package com.example.rpc;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every 10s, sends a request through the broker and waits for the reply using
 * {@link RabbitTemplate#convertSendAndReceive} — the same call Spring services
 * make for RPC. Proves the round-trip works end to end and generates live traffic
 * you can watch in the DevTool RabbitMQ tool. Disable with RPC_SELFTEST=false.
 */
@Component
@ConditionalOnProperty(name = "rpc.selftest.enabled", havingValue = "true", matchIfMissing = true)
public class RpcSelfTest {
    private static final Logger log = LoggerFactory.getLogger(RpcSelfTest.class);

    private final RabbitTemplate rabbitTemplate;
    private int counter = 0;

    public RpcSelfTest(RabbitTemplate rabbitTemplate) {
        this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 5_000)
    public void ping() {
        String request = "ping-" + (++counter);
        log.info("RPC self-test -> {}", request);
        Object reply = rabbitTemplate.convertSendAndReceive(
                RabbitConfig.EXCHANGE, RabbitConfig.ROUTING_KEY, request);
        log.info("RPC self-test <- {}", reply);
    }
}
