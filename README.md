# Naukri Job Scraper

A Node.js script that automates job searching on Naukri.com and determines whether job applications are internal or external.

## Features

- Automatically logs in to Naukri.com (with session persistence)
- Searches for jobs based on configurable job title and location
- Scrapes job details including:
  - Job title
  - Company name
  - Location
  - Experience required
  - Salary
  - Application type (Internal/External)
- Saves results to JSON file

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a `.env` file with your credentials:
   ```
   EMAIL=your_email@example.com
   PASSWORD=your_password
   JOB_SEARCH_QUERY=Frontend Developer
   LOCATION=Bangalore
   ```

## Usage

Run the script with:

```
npm start
```

The script will:
1. Log in to Naukri.com (if not already logged in)
2. Search for jobs based on your query and location
3. Scrape details for the specified number of jobs
4. Save results to `naukri_jobs.json`

## Note

This is for educational purposes only. Please respect Naukri.com's terms of service and robots.txt when using this script.# naukri_script_working
# naukri_script_working
# naukri_script_working
