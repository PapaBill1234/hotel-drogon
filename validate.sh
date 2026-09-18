#!/bin/bash
# Check runtime container dependencies
docker exec hotel_backend dpkg -l | grep -i json
docker exec hotel_backend apt-get update && apt-get install -y libjsoncpp1 || true
docker exec hotel_backend dpkg -l | grep -i json
