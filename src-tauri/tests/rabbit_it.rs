//! RabbitMQ broker integration tests.
//!
//! These exercise the same AMQP flows the RabbitMQ tool relies on (publish with
//! confirms, mandatory-return, consume, and direct reply-to) against a real
//! broker. They are `#[ignore]`d so normal `cargo test` stays broker-free.
//!
//! Run against the docker-compose broker (see testing/rabbitmq):
//!     RABBIT_IT_AMQP="amqp://guest:guest@localhost:5672/%2f" \
//!         cargo test --test rabbit_it -- --ignored
//!
//! Each test uses unique, auto-deleting resources so the broker stays clean.

use std::time::Duration;

use futures_util::StreamExt;
use lapin::options::{
    BasicConsumeOptions, BasicPublishOptions, ConfirmSelectOptions, QueueDeclareOptions,
};
use lapin::types::FieldTable;
use lapin::{BasicProperties, Connection, ConnectionProperties};
use uuid::Uuid;

fn amqp_url() -> String {
    std::env::var("RABBIT_IT_AMQP")
        .unwrap_or_else(|_| "amqp://guest:guest@localhost:5672/%2f".to_string())
}

async fn connect() -> Connection {
    // lapin 4 manages the tokio runtime itself (default feature).
    Connection::connect(&amqp_url(), ConnectionProperties::default())
        .await
        .expect("connect to broker (is the docker-compose stack up?)")
}

/// Publish to a temp queue with publisher confirms, then consume it back.
#[tokio::test]
#[ignore]
async fn publish_then_consume_roundtrip() {
    let conn = connect().await;
    let ch = conn.create_channel().await.unwrap();
    ch.confirm_select(ConfirmSelectOptions::default()).await.unwrap();

    let queue = format!("devtool.it.{}", Uuid::new_v4());
    ch.queue_declare(
        queue.as_str().into(),
        QueueDeclareOptions { auto_delete: true, ..Default::default() },
        FieldTable::default(),
    )
    .await
    .unwrap();

    let body = b"hello-roundtrip";
    let confirm = ch
        .basic_publish("".into(), queue.as_str().into(), BasicPublishOptions::default(), body, BasicProperties::default())
        .await
        .unwrap()
        .await
        .unwrap();
    assert!(confirm.is_ack(), "broker should confirm the publish");

    let mut consumer = ch
        .basic_consume(queue.as_str().into(), "it".into(), BasicConsumeOptions { no_ack: true, ..Default::default() }, FieldTable::default())
        .await
        .unwrap();
    let delivery = tokio::time::timeout(Duration::from_secs(5), consumer.next())
        .await
        .expect("a message should arrive")
        .unwrap()
        .unwrap();
    assert_eq!(delivery.data, body);
}

/// A mandatory publish to a routing key with no binding must be returned (unroutable).
#[tokio::test]
#[ignore]
async fn mandatory_unroutable_is_returned() {
    let conn = connect().await;
    let ch = conn.create_channel().await.unwrap();
    ch.confirm_select(ConfirmSelectOptions::default()).await.unwrap();

    let nowhere = format!("devtool.it.nowhere.{}", Uuid::new_v4());
    let confirmation = ch
        .basic_publish(
            "".into(),
            nowhere.as_str().into(),
            BasicPublishOptions { mandatory: true, ..Default::default() },
            b"orphan",
            BasicProperties::default(),
        )
        .await
        .unwrap()
        .await
        .unwrap();

    // Confirmed by the broker, but carries the returned (unroutable) message.
    assert!(confirmation.take_message().is_some(), "unroutable mandatory publish should return the message");
}

/// Direct reply-to round-trip: a responder echoes requests back to reply_to.
#[tokio::test]
#[ignore]
async fn direct_reply_to_rpc() {
    let conn = connect().await;

    // Responder: consume a temp request queue and reply to each message's reply_to.
    let req_queue = format!("devtool.it.rpc.{}", Uuid::new_v4());
    let responder = conn.create_channel().await.unwrap();
    responder
        .queue_declare(req_queue.as_str().into(), QueueDeclareOptions { auto_delete: true, ..Default::default() }, FieldTable::default())
        .await
        .unwrap();
    let mut requests = responder
        .basic_consume(req_queue.as_str().into(), "responder".into(), BasicConsumeOptions { no_ack: true, ..Default::default() }, FieldTable::default())
        .await
        .unwrap();
    let responder_ch = responder.clone();
    tokio::spawn(async move {
        while let Some(Ok(req)) = requests.next().await {
            if let Some(reply_to) = req.properties.reply_to().as_ref() {
                let mut up = String::from_utf8_lossy(&req.data).to_string();
                up.make_ascii_uppercase();
                let props = BasicProperties::default()
                    .with_correlation_id(req.properties.correlation_id().clone().unwrap_or_default());
                let _ = responder_ch
                    .basic_publish("".into(), reply_to.as_str().into(), BasicPublishOptions::default(), up.as_bytes(), props)
                    .await;
            }
        }
    });

    // Client: consume direct reply-to, publish a request, await the reply.
    let client = conn.create_channel().await.unwrap();
    let mut replies = client
        .basic_consume("amq.rabbitmq.reply-to".into(), "client".into(), BasicConsumeOptions { no_ack: true, ..Default::default() }, FieldTable::default())
        .await
        .unwrap();
    let corr = Uuid::new_v4().to_string();
    client
        .basic_publish(
            "".into(),
            req_queue.as_str().into(),
            BasicPublishOptions::default(),
            b"ping",
            BasicProperties::default()
                .with_reply_to("amq.rabbitmq.reply-to".into())
                .with_correlation_id(corr.clone().into()),
        )
        .await
        .unwrap()
        .await
        .unwrap();

    let reply = tokio::time::timeout(Duration::from_secs(5), replies.next())
        .await
        .expect("reply should arrive")
        .unwrap()
        .unwrap();
    assert_eq!(reply.data, b"PING");
    assert_eq!(reply.properties.correlation_id().as_ref().map(|s| s.to_string()), Some(corr));
}
