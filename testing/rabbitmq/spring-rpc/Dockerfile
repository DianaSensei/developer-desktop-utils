# Multi-stage build: compile the fat jar with Maven, then run it on a JRE.
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY pom.xml .
# Cache dependencies in their own layer so source changes don't re-download them.
RUN mvn -q -B -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /build/target/spring-rpc-1.0.0.jar app.jar
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
