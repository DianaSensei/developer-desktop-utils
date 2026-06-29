"""Publishes to the "demo.topic" exchange with rotating routing keys every 3s.

Routing keys starting with "orders." also match the "orders.*" binding
(demo.topic.orders); everything matches the "#" binding (demo.topic.all).
"""
import json
import time
from common import connect

EXCHANGE = "demo.topic"
KEYS = ["orders.created", "orders.shipped", "payments.captured", "users.signup"]


def main() -> None:
    conn = connect()
    ch = conn.channel()
    ch.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)

    i = 0
    while True:
        key = KEYS[i % len(KEYS)]
        i += 1
        body = json.dumps({"id": i, "ts": time.time(), "key": key})
        ch.basic_publish(exchange=EXCHANGE, routing_key=key, body=body)
        print(f"[topic] sent key={key} {body}", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
