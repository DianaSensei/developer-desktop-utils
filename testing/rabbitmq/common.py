"""Shared connection helper: connect to RabbitMQ with retry."""
import os
import time
import pika


def connect() -> pika.BlockingConnection:
    host = os.environ.get("RABBITMQ_HOST", "rabbitmq")
    user = os.environ.get("RABBITMQ_USER", "guest")
    password = os.environ.get("RABBITMQ_PASS", "guest")
    params = pika.ConnectionParameters(
        host=host,
        credentials=pika.PlainCredentials(user, password),
        heartbeat=30,
        blocked_connection_timeout=30,
    )
    # depends_on waits for the healthcheck, but retry anyway so a slow boot
    # (or a `docker compose restart rabbitmq`) doesn't kill the workers.
    for attempt in range(1, 31):
        try:
            return pika.BlockingConnection(params)
        except pika.exceptions.AMQPConnectionError:
            print(f"[wait] RabbitMQ not ready (attempt {attempt}); retrying in 2s", flush=True)
            time.sleep(2)
    raise SystemExit("Could not connect to RabbitMQ after 30 attempts")
