"""Publishes to the "demo.fanout" exchange every 3s — fans out to both bound queues."""
import json
import time
from common import connect

EXCHANGE = "demo.fanout"


def main() -> None:
    conn = connect()
    ch = conn.channel()
    # Exchange is preloaded via definitions.json; declare passively-compatible to be safe.
    ch.exchange_declare(exchange=EXCHANGE, exchange_type="fanout", durable=True)

    i = 0
    while True:
        i += 1
        body = json.dumps({"id": i, "ts": time.time(), "kind": "fanout"})
        ch.basic_publish(exchange=EXCHANGE, routing_key="", body=body)
        print(f"[fanout] sent {body}", flush=True)
        time.sleep(3)


if __name__ == "__main__":
    main()
