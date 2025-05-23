#!/bin/bash

# Default values
DEFAULT_QUERY="Full stack developer"
DEFAULT_LOCATION="Hyderabad"

# Parse command line arguments
QUERY="${1:-$DEFAULT_QUERY}"
LOCATION="${2:-$DEFAULT_LOCATION}"
EXPERIENCE="${3:-0}"

echo "Starting scraper at $(date)"
echo "Parameters:"
echo "  Query: $QUERY"
echo "  Location: $LOCATION"
echo "  Experience: $EXPERIENCE"

# Run the Node.js script with parameters
node dynamic_scraper.js --query "$QUERY" --location "$LOCATION" --experience "$EXPERIENCE"

EXIT_CODE=$?
echo "Scraper finished at $(date) with exit code $EXIT_CODE"
exit $EXIT_CODE
