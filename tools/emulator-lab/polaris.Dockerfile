# syntax=docker/dockerfile:1
FROM maven:3.9.16-eclipse-temurin-25-noble@sha256:93b8a14ea2f412782e4e842651273b4d903e35cc496284f178fbbe2d67d00976 AS build
WORKDIR /src
COPY . .
# Upstream requires Java 25 in pom.xml despite the older README saying Java 21.
RUN mvn -B -DskipTests package

FROM eclipse-temurin:25.0.4_7-jre-noble@sha256:b573af9e331196fbc42e246da4df24df9b6c556c73e7efddfde0511f1c9508c5
# Polaris refuses a pending migration when its configured backup program is absent.
RUN apt-get update && apt-get install -y --no-install-recommends mariadb-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/*-jar-with-dependencies.jar /app/polaris.jar
EXPOSE 3000 2096
ENTRYPOINT ["java", "-jar", "/app/polaris.jar"]
