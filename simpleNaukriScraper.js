const { Builder, By } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Configuration
const JOB_SEARCH_QUERY = process.env.JOB_SEARCH_QUERY || 'Frontend Developer';
const LOCATION = process.env.LOCATION || 'Bangalore';
const NUMBER_OF_JOBS = parseInt(process.env.NUMBER_OF_JOBS || '20');
const OUTPUT_FILE = './naukri_jobs.json';

async function scrapeNaukriJobs() {
  console.log('Starting simple Naukri.com job scraper...');
  
  // Setup Chrome options
  const options = new chrome.Options();
  options.addArguments('--headless');
  options.addArguments('--disable-gpu');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');
  
  // Initialize WebDriver
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // Skip login and navigate directly to search results
    const formattedQuery = JOB_SEARCH_QUERY.toLowerCase().replace(/\s+/g, '-');
    const formattedLocation = LOCATION.toLowerCase();
    
    const searchUrl = `https://www.naukri.com/${formattedQuery}-jobs-in-${formattedLocation}?experience=0`;
    console.log(`Navigating directly to: ${searchUrl}`);
    
    await driver.get(searchUrl);
    await driver.sleep(5000);
    
    // Get job links
    console.log('Finding job links...');
    const jobUrls = [];
    const links = await driver.findElements(By.css('a'));
    
    for (const link of links) {
      try {
        const href = await link.getAttribute('href') || '';
        if (href.includes('job-listings')) {
          jobUrls.push(href);
        }
      } catch (e) {
        // Skip problematic links
      }
    }
    
    console.log(`Found ${jobUrls.length} job URLs`);
    
    // Limit to requested number
    const limitedJobUrls = jobUrls.slice(0, NUMBER_OF_JOBS);
    
    // Process job URLs
    const jobsData = [];
    for (let i = 0; i < limitedJobUrls.length; i++) {
      const jobUrl = limitedJobUrls[i];
      console.log(`Processing job ${i + 1}/${limitedJobUrls.length}: ${jobUrl}`);
      
      // Visit job page
      await driver.executeScript('window.open(arguments[0])', jobUrl);
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);
      await driver.sleep(3000);
      
      // Extract basic job details
      let jobTitle = 'Not found';
      let companyName = 'Not found';
      let location = 'Not found';
      
      try {
        jobTitle = await driver.findElement(By.css('h1')).getText();
      } catch (e) {}
      
      try {
        companyName = await driver.findElement(By.css('.company-name, [class*="company"]')).getText();
      } catch (e) {}
      
      try {
        location = await driver.findElement(By.css('.location, [class*="location"]')).getText();
      } catch (e) {}
      
      // Simple approach to determine application type
      // For now we'll just record the URL since we can't click "Apply" without login
      const jobData = {
        "Job Title": jobTitle,
        "Company Name": companyName,
        "Location": location,
        "Job URL": jobUrl,
        "Scraped Date": new Date().toISOString()
      };
      
      jobsData.push(jobData);
      
      // Close job tab and return to results
      await driver.close();
      await driver.switchTo().window(tabs[0]);
    }
    
    // Save results
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsData, null, 2));
    console.log(`Saved ${jobsData.length} jobs to ${OUTPUT_FILE}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await driver.quit();
  }
}

// Run the scraper
scrapeNaukriJobs();