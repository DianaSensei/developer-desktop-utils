FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir pika==1.3.2
COPY *.py /app/
# Default command; each compose service overrides this.
CMD ["python", "consumer.py"]
