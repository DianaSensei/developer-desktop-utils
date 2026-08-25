# Multi-stage build: compile the fat jar with Maven, then run it on a JRE.
# Base images pinned by digest, not just by tag: a tag can be re-pointed at any
# time, a digest cannot. Bump tag and digest together.
FROM maven:3.9-eclipse-temurin-17@sha256:bbcab0adfb03704e65831593df63b1c6b7ee42d5d8603f0d88972e0ee81a3036 AS build
WORKDIR /build
COPY pom.xml .
# Cache dependencies in their own layer so source changes don't re-download them.
RUN mvn -q -B -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:17-jre@sha256:13cc28a6cc72a38ce1f00c906be3580c1a3e604b8984d694f369a96742abc93b
WORKDIR /app
COPY --from=build /build/target/spring-rpc-1.0.0.jar app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
