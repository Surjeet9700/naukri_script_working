#!/bin/bash

# Default values
DEFAULT_QUERY=""
DEFAULT_LOCATION=""
DEFAULT_LIMIT=50
DEFAULT_OUTPUT="./query_results_$(date +%Y%m%d).json"

# Parse command line arguments
QUERY="${1:-$DEFAULT_QUERY}"
LOCATION="${2:-$DEFAULT_LOCATION}"
LIMIT="${3:-$DEFAULT_LIMIT}"
OUTPUT="${4:-$DEFAULT_OUTPUT}"

echo "Querying jobs with:"
echo "  Query: $QUERY"
echo "  Location: $LOCATION"
echo "  Limit: $LIMIT"
echo "  Output: $OUTPUT"

# Execute the Node.js script with parameters
node query_jobs.js --query "$QUERY" --location "$LOCATION" --limit "$LIMIT" --output "$OUTPUT"
