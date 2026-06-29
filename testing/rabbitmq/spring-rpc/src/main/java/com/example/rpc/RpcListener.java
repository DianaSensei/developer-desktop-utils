package com.example.rpc;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * The RPC responder. Returning a value from a {@code @RabbitListener} method makes
 * Spring AMQP publish the result to the request's {@code reply_to} queue, reusing
 * the same {@code correlation_id} — the standard request/response pattern.
 */
@Component
public class RpcListener {
    private static final Logger log = LoggerFactory.getLogger(RpcListener.class);

    @RabbitListener(queues = RabbitConfig.QUEUE)
    public String handle(String request) {
        log.info("Received request: {}", request);
        String response = "reply to '" + request + "' -> " + request.toUpperCase();
        log.info("Replying: {}", response);
        return response;
    }
}
