"""Consumes "demo.work", simulates 1s of work, then acks each message."""
import time
from common import connect

QUEUE = "demo.work"


def main() -> None:
    conn = connect()
    ch = conn.channel()
    ch.queue_declare(queue=QUEUE, durable=True)
    ch.basic_qos(prefetch_count=1)

    def on_message(channel, method, _props, body) -> None:
        print(f"[consumer] got {body.decode()}", flush=True)
        time.sleep(1)  # simulate work — keeps an unacked message visible in the UI
        channel.basic_ack(delivery_tag=method.delivery_tag)

    ch.basic_consume(queue=QUEUE, on_message_callback=on_message)
    print("[consumer] waiting for messages…", flush=True)
    ch.start_consuming()


if __name__ == "__main__":
    main()
