"""Continuously produce demo traffic so the Kafka Explorer always has something live.

- demo.events : JSON events with a key (3 partitions — watch key-based routing)
- demo.json   : plain JSON values (good for the JSON value view)
- demo.bytes  : raw binary values (exercises the Hex value view)
"""
import json
import random
import struct
import time

from kafka import KafkaProducer

from common import BOOTSTRAP


def main() -> None:
    producer = KafkaProducer(bootstrap_servers=BOOTSTRAP, retries=5, linger_ms=50)
    print(f"producing to {BOOTSTRAP} …", flush=True)
    i = 0
    while True:
        i += 1
        event = {
            "id": i,
            "type": random.choice(["click", "view", "purchase", "signup"]),
            "user": f"user-{random.randint(1, 50)}",
            "amount": round(random.random() * 100, 2),
            "ts": time.time(),
        }
        producer.send("demo.events", key=str(event["user"]).encode(), value=json.dumps(event).encode())
        producer.send("demo.json", value=json.dumps({"seq": i, "msg": "hello kafka", "ok": True}).encode())
        # Non-UTF8 binary payload — switch the realtime consumer's value format to Hex.
        producer.send("demo.bytes", value=struct.pack(">IIf", i, 0xDEADBEEF, random.random()))
        producer.flush()
        if i % 5 == 0:
            print(f"produced {i} batches", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    main()
