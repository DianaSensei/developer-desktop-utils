# Base image pinned by digest, not just by tag: a tag can be re-pointed at any
# time, a digest cannot. Bump both together when moving to a new Python patch.
FROM python:3.12-slim@sha256:2c941e860699f878900b0edc2403613c234d4b32eda3cc9fa7036991a2a63c4a
WORKDIR /app
COPY requirements.txt /app/
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY . /app
