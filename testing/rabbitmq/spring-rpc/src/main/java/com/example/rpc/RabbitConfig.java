package com.example.rpc;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Declares the request topology on startup:
 *   exchange "spring.rpc.exchange" --(rpc.request)--> queue "spring.rpc.requests"
 *
 * Plain String payloads are used (the default SimpleMessageConverter), so you can
 * publish a request from the DevTool RabbitMQ tool without any __TypeId__ header.
 */
@Configuration
public class RabbitConfig {
    public static final String EXCHANGE = "spring.rpc.exchange";
    public static final String QUEUE = "spring.rpc.requests";
    public static final String ROUTING_KEY = "rpc.request";

    @Bean
    Queue requestQueue() {
        return new Queue(QUEUE, true);
    }

    @Bean
    DirectExchange rpcExchange() {
        return new DirectExchange(EXCHANGE, true, false);
    }

    @Bean
    Binding rpcBinding(Queue requestQueue, DirectExchange rpcExchange) {
        return BindingBuilder.bind(requestQueue).to(rpcExchange).with(ROUTING_KEY);
    }
}
