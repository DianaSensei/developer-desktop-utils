FROM python:3.12-slim
# kafka-python-ng is the maintained fork of kafka-python (same `kafka` import API)
# that works on Python 3.12 — the old kafka-python 2.0.2 crashes on its vendored six.
RUN pip install --no-cache-dir kafka-python-ng==2.2.3
WORKDIR /app
COPY . /app
