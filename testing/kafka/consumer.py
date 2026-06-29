"""A real consumer group so the tool's consumer-group views have data.

Joins group "demo-consumers" on demo.events and commits offsets, so:
  - Topic -> Consumers  shows this group + its per-partition lag
  - the Group view       shows this group consuming demo.events
"""
import os

from kafka import KafkaConsumer

from common import BOOTSTRAP


def main() -> None:
    consumer = KafkaConsumer(
        "demo.events",
        bootstrap_servers=BOOTSTRAP,
        group_id="demo-consumers",
        client_id=os.environ.get("CLIENT_ID", "worker-1"),
        auto_offset_reset="earliest",
        enable_auto_commit=True,
    )
    print(f"consuming demo.events as group 'demo-consumers' from {BOOTSTRAP} …", flush=True)
    for msg in consumer:
        preview = (msg.value or b"")[:60]
        print(f"[p{msg.partition} @ {msg.offset}] {preview!r}", flush=True)


if __name__ == "__main__":
    main()
