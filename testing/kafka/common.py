import os

# Inside the compose network the workers reach the broker at kafka:29092.
# (The tool on your host uses localhost:9092 — see docker-compose.yml.)
BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "kafka:29092")
