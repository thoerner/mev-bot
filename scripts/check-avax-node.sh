#!/bin/bash

AVAX_RPC="http://127.0.0.1:9650/ext/health"

# Query health endpoint
response=$(curl -s --max-time 5 "$AVAX_RPC")

# Check if curl succeeded
if [ $? -ne 0 ]; then
  echo "[❌] Avalanche node: RPC unreachable"
  exit 1
fi

# Check if 'healthy' is true in the response
is_healthy=$(echo "$response" | jq -r '.result.healthy')

if [ "$is_healthy" == "true" ]; then
  echo "[✅] Avalanche node is healthy"
  exit 0
else
  echo "[⚠️] Avalanche node is running but not healthy"
  echo "$response" | jq
  exit 2
fi
