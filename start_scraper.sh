#!/bin/bash

echo "Starting Naukri job scraper at $(date)"

# Create directory for Chrome user data if it doesn't exist
mkdir -p chrome_user_data

# Environment variables for the scraper
export JOB_SEARCH_QUERY="Frontend Developer"
export LOCATION="Bangalore"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Run the scraper
node ec2scraper.js

# Check if script ran successfully
if [ $? -eq 0 ]; then
  echo "Scraper completed successfully."
  
  # Count the number of jobs
  JOBS_COUNT=$(grep -o "Job Title" naukri_jobs.json | wc -l)
  echo "Found $JOBS_COUNT jobs."
  
  # Display the first few job titles
  echo "Sample jobs found:"
  grep -A 1 "Job Title" naukri_jobs.json | head -10
else
  echo "Scraper failed with error code $?"
fi

echo "Scraper execution completed at $(date)"
