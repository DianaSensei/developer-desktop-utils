"""Publishes a JSON message to the durable "demo.work" queue every 2 seconds."""
import json
import time
import pika
from common import connect

QUEUE = "demo.work"


def main() -> None:
    conn = connect()
    ch = conn.channel()
    ch.queue_declare(queue=QUEUE, durable=True)

    i = 0
    while True:
        i += 1
        body = json.dumps({"id": i, "ts": time.time(), "msg": f"hello #{i}"})
        ch.basic_publish(
            exchange="",            # default exchange routes by queue name
            routing_key=QUEUE,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,    # persistent
                content_type="application/json",
            ),
        )
        print(f"[producer] sent {body}", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    main()
