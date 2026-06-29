"""RPC server: serves "rpc_queue", replies to each request's reply_to queue.

Implements the classic RabbitMQ request/response pattern — the reply carries the
same correlation_id the client sent, so the client can match responses.
"""
import pika
from common import connect

RPC_QUEUE = "rpc_queue"


def on_request(ch, method, props, body) -> None:
    request = body.decode()
    print(f"[rpc-server] request: {request}", flush=True)

    # Trivial "work": echo the request back uppercased.
    response = f"reply to '{request}' -> {request.upper()}"

    ch.basic_publish(
        exchange="",
        routing_key=props.reply_to,
        properties=pika.BasicProperties(correlation_id=props.correlation_id),
        body=response,
    )
    ch.basic_ack(delivery_tag=method.delivery_tag)


def main() -> None:
    conn = connect()
    ch = conn.channel()
    ch.queue_declare(queue=RPC_QUEUE)
    ch.basic_qos(prefetch_count=1)
    ch.basic_consume(queue=RPC_QUEUE, on_message_callback=on_request)
    print("[rpc-server] awaiting RPC requests…", flush=True)
    ch.start_consuming()


if __name__ == "__main__":
    main()
