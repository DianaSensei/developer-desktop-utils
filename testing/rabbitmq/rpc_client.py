"""RPC client: sends a request to "rpc_queue" every 5s and prints the reply.

Declares an exclusive callback queue, tags each request with a correlation_id,
and waits for the matching response on the callback queue.
"""
import time
import uuid
import pika
from common import connect

RPC_QUEUE = "rpc_queue"


class RpcClient:
    def __init__(self) -> None:
        self.conn = connect()
        self.ch = self.conn.channel()

        # Exclusive, auto-named, server-deleted reply queue.
        result = self.ch.queue_declare(queue="", exclusive=True)
        self.callback_queue = result.method.queue
        self.ch.basic_consume(
            queue=self.callback_queue,
            on_message_callback=self._on_response,
            auto_ack=True,
        )
        self.response = None
        self.corr_id = None

    def _on_response(self, _ch, _method, props, body) -> None:
        if self.corr_id == props.correlation_id:
            self.response = body

    def call(self, payload: str) -> str:
        self.response = None
        self.corr_id = str(uuid.uuid4())
        self.ch.basic_publish(
            exchange="",
            routing_key=RPC_QUEUE,
            properties=pika.BasicProperties(
                reply_to=self.callback_queue,
                correlation_id=self.corr_id,
            ),
            body=payload,
        )
        while self.response is None:
            self.conn.process_data_events(time_limit=1)
        return self.response.decode()


def main() -> None:
    client = RpcClient()
    i = 0
    while True:
        i += 1
        payload = f"ping-{i}"
        print(f"[rpc-client] -> {payload}", flush=True)
        reply = client.call(payload)
        print(f"[rpc-client] <- {reply}", flush=True)
        time.sleep(5)


if __name__ == "__main__":
    main()
