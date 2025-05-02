const { Builder, By, Key, until } = require('selenium-webdriver');
const fs = require('fs');
const chrome = require('selenium-webdriver/chrome');
const path = require('path');
const os = require('os');

// Load environment variables - add dotenv package
require('dotenv').config();

// Configuration from environment variables
const EMAIL = process.env.EMAIL || '';
const PASSWORD = process.env.PASSWORD || '';
const JOB_SEARCH_QUERY = process.env.JOB_SEARCH_QUERY || 'Frontend Developer';
const LOCATION = process.env.LOCATION || 'Bangalore';
const NUMBER_OF_JOBS = parseInt(process.env.NUMBER_OF_JOBS || '20');
const OUTPUT_FILE = './naukri_jobs.json';

// Cookie/session storage file
const COOKIES_FILE = './naukri_cookies.json';

// Custom user data directory for persistent sessions
const USER_DATA_DIR = path.join(__dirname, 'chrome_user_data');

async function scrapeNaukriJobs() {
  console.log('Starting Naukri.com job scraper with Chrome browser...');
  console.log(`Using persistent user data directory: ${USER_DATA_DIR}`);
  
  // Setup Chrome options for persistent session
  const options = new chrome.Options();
  // Disable GPU acceleration to avoid graphics issues
  options.addArguments('--disable-gpu');
  options.addArguments('--disable-software-rasterizer');
  options.addArguments('--disable-dev-shm-usage');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-extensions');
  // Use persistent user data directory
  options.addArguments(`--user-data-dir=${USER_DATA_DIR}`);
  // Disable Vulkan (which was causing errors)
  options.addArguments('--disable-vulkan');
  options.addArguments('--disable-vulkan-surface');
  options.addArguments('--use-gl=swiftshader');
  options.addArguments('--disable-accelerated-2d-canvas');
  
  // Initialize the WebDriver with Chrome
  let driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // First, navigate to Naukri.com and login
    console.log('Navigating to Naukri.com to log in first...');
    await driver.get('https://www.naukri.com/');
    await driver.sleep(2000);
    
    // Try to restore cookies first if available
    const cookiesRestored = await tryRestoreCookies(driver);
    
    // Check if already logged in
    const isLoggedIn = await checkIfLoggedIn(driver);
    
    if (!isLoggedIn && !cookiesRestored) {
      console.log('Not logged in. Proceeding with login...');
      await loginToNaukri(driver, EMAIL, PASSWORD);
      
      // Save cookies after successful login
      await saveCookies(driver);
    } else {
      console.log('Already logged in or session restored. Proceeding with job search...');
    }

    // Construct search URL based on provided job search query and location
    const formattedQuery = JOB_SEARCH_QUERY.toLowerCase().replace(/\s+/g, '-');
    const formattedLocation = LOCATION.toLowerCase();
    
    // Now navigate to the search results page
    console.log(`Searching for ${JOB_SEARCH_QUERY} jobs in ${LOCATION}...`);
    const searchUrl = `https://www.naukri.com/${formattedQuery}-jobs-in-${formattedLocation}?experience=0`;
    console.log(`Navigating to: ${searchUrl}`);
    
    await driver.get(searchUrl);
    await driver.sleep(3000);

    console.log('Looking for job listings...');
    
    // Get all job links from the page
    let jobUrls = await getAllJobLinks(driver);
    
    console.log(`Found ${jobUrls.length} job URLs on the page`);
    
    // Limit to requested number of jobs
    jobUrls = jobUrls.slice(0, NUMBER_OF_JOBS);
    
    // Process each job URL to extract details
    const jobsData = await processJobUrls(driver, jobUrls);

    // Save results to JSON file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsData, null, 2));
    console.log(`Successfully scraped ${jobsData.length} jobs and saved to ${OUTPUT_FILE}`);

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    // Close the browser
    await driver.quit();
  }
}

// Try to restore cookies from file
async function tryRestoreCookies(driver) {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      console.log('Found saved cookies. Attempting to restore session...');
      const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
      
      // Get current domain to apply cookies
      const currentUrl = await driver.getCurrentUrl();
      const domain = new URL(currentUrl).hostname;
      
      for (const cookie of cookiesData) {
        try {
          // Some cookies might not be valid for the current domain
          await driver.manage().addCookie(cookie);
        } catch (e) {
          // Skip cookies that can't be added
          console.log(`Couldn't add cookie: ${e.message}`);
        }
      }
      
      // Refresh page to apply cookies
      await driver.navigate().refresh();
      await driver.sleep(2000);
      
      return true;
    }
  } catch (error) {
    console.log('Error restoring cookies:', error.message);
  }
  return false;
}

// Save cookies to file
async function saveCookies(driver) {
  try {
    console.log('Saving cookies for future sessions...');
    const cookies = await driver.manage().getCookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies), 'utf8');
    console.log(`Saved ${cookies.length} cookies to ${COOKIES_FILE}`);
  } catch (error) {
    console.log('Error saving cookies:', error.message);
  }
}

async function checkIfLoggedIn(driver) {
  try {
    // Check for login button (if it exists, user is not logged in)
    const loginElements = await driver.findElements(By.css('#login_Layer, .nI-gNb-lg-rg__login'));
    
    // Check for profile icon or username (if it exists, user is logged in)
    const profileElements = await driver.findElements(By.css('.nI-gNb-user, .user-name, .nI-gNb-software'));
    
    console.log(`Login elements found: ${loginElements.length}, Profile elements found: ${profileElements.length}`);
    
    return loginElements.length === 0 && profileElements.length > 0;
  } catch (error) {
    console.log('Error checking login status:', error);
    return false;
  }
}

async function loginToNaukri(driver, email, password) {
  try {
    console.log('Starting login process...');
    
    // Click on the login button on the homepage
    await driver.findElement(By.css('#login_Layer, .nI-gNb-lg-rg__login')).click();
    console.log('Clicked login button');
    
    // Wait for the login form to appear
    await driver.sleep(2000);
    
    // Enter email and password
    console.log('Entering login credentials...');
    await driver.findElement(By.css('#usernameField, input[placeholder*="Email ID"]')).sendKeys(email);
    await driver.findElement(By.css('#passwordField, input[type="password"]')).sendKeys(password);
    
    // Click login button
    await driver.findElement(By.css('button[type="submit"], .btn-primary, .loginButton')).click();
    console.log('Clicked submit button');
    
    // Wait for login to complete
    await driver.sleep(5000);
    
    // Verify login success
    const isNowLoggedIn = await checkIfLoggedIn(driver);
    if (isNowLoggedIn) {
      console.log('Successfully logged in to Naukri.com');
    } else {
      console.log('Login might have failed. Continuing anyway...');
    }
  } catch (error) {
    console.error('Error during login:', error);
    throw new Error('Failed to login to Naukri.com');
  }
}

async function getAllJobLinks(driver) {
  const jobUrls = [];
  
  try {
    // Look for all anchor elements with href containing job listings
    const allLinks = await driver.findElements(By.css('a'));
    
    for (const link of allLinks) {
      try {
        const href = await link.getAttribute('href') || '';
        
        // Filter for job listing URLs
        if (href.includes('job-listings')) {
          jobUrls.push(href);
        }
      } catch (e) {
        // Skip problematic links
      }
    }
    
    console.log(`Found ${jobUrls.length} job links on the page`);
    return jobUrls;
    
  } catch (error) {
    console.error('Error getting job links:', error);
    return jobUrls;
  }
}

async function processJobUrls(driver, jobUrls) {
  console.log(`Processing ${jobUrls.length} job URLs...`);
  const jobsData = [];
  
  for (let i = 0; i < jobUrls.length; i++) {
    const jobUrl = jobUrls[i];
    console.log(`Processing job ${i + 1}/${jobUrls.length}: ${jobUrl}`);
    
    try {
      // Open job URL in a new tab
      await driver.executeScript('window.open(arguments[0])', jobUrl);
      
      // Switch to the new tab
      const tabs = await driver.getAllWindowHandles();
      await driver.switchTo().window(tabs[1]);
      
      // Wait for job details page to load
      await driver.sleep(3000);
      
      // Extract job details
      const jobDetails = await extractJobDetails(driver, jobUrl);
      
      // Add to results
      jobsData.push(jobDetails);
      
      // Close the tab and switch back to the main tab
      await driver.close();
      await driver.switchTo().window(tabs[0]);
      
    } catch (error) {
      console.error(`Error processing job URL ${jobUrl}:`, error);
      
      // Try to recover by closing extra tabs and returning to the main tab
      try {
        const tabs = await driver.getAllWindowHandles();
        if (tabs.length > 1) {
          await driver.close();
          await driver.switchTo().window(tabs[0]);
        }
      } catch (recoveryError) {
        console.error('Error during tab recovery:', recoveryError);
      }
    }
  }
  
  return jobsData;
}

async function extractJobDetails(driver, jobUrl) {
  console.log('Extracting job details from URL:', jobUrl);
  
  let jobTitle = '';
  let companyName = '';
  let location = '';
  let experience = '';
  let salary = '';
  let applicationType = 'Unknown';
  
  try {
    // Extract job title - try multiple selectors
    try {
      for (const selector of [
        'h1.jd-header-title', // Primary selector
        '.jd-header h1',
        '.jd-title',
        'h1',
        '.title'
      ]) {
        try {
          const elements = await driver.findElements(By.css(selector));
          if (elements.length > 0) {
            jobTitle = await elements[0].getText();
            console.log(`Found job title: "${jobTitle}" using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
    } catch (e) {
      console.log('Error extracting job title:', e.message);
      jobTitle = 'Title not found';
    }
    
    // Extract company name - improved extraction logic
    try {
      for (const selector of [
        '.jd-header-comp-name a',
        '.comp-name',
        '.company-name',
        '[class*="company"]',
        '.jd-header span'
      ]) {
        try {
          const elements = await driver.findElements(By.css(selector));
          if (elements.length > 0) {
            companyName = await elements[0].getText();
            console.log(`Found company name: "${companyName}" using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      // If company name not found or looks wrong, extract from URL
      if (!companyName || companyName === 'Company not found') {
        // Parse company name from URL pattern job-listings-title-COMPANY-location-experience
        const urlParts = jobUrl.split('-');
        
        // Better company name extraction from URL
        // First, find the position where "job-listings" appears
        const listingsIndex = urlParts.findIndex(part => part === "listings");
        
        if (listingsIndex >= 0) {
          // Skip job title parts (variable number)
          let startIndex = listingsIndex + 1;
          while (startIndex < urlParts.length && 
                 (urlParts[startIndex].includes("full") || 
                  urlParts[startIndex].includes("stack") ||
                  urlParts[startIndex].includes("developer") ||
                  urlParts[startIndex].includes("frontend") ||
                  urlParts[startIndex].includes("backend") ||
                  urlParts[startIndex].includes("software") ||
                  urlParts[startIndex].includes("engineer") ||
                  urlParts[startIndex].includes("web"))) {
            startIndex++;
          }
          
          // Now find company name parts until we hit location or years
          const companyParts = [];
          let i = startIndex;
          
          // Common Indian cities to detect end of company name
          const cities = ["hyderabad", "bangalore", "bengaluru", "mumbai", "pune", "delhi", 
                         "chennai", "kolkata", "noida", "gurgaon", "ahmedabad"];
          
          while (i < urlParts.length && 
                 !urlParts[i].match(/^\d/) && 
                 !urlParts[i].includes("years") && 
                 !cities.includes(urlParts[i].toLowerCase())) {
            companyParts.push(urlParts[i]);
            i++;
          }
          
          if (companyParts.length > 0) {
            // Format each word with first letter capitalized
            companyName = companyParts.join(' ')
              .replace(/\b\w/g, l => l.toUpperCase())
              .replace(/Pvt Ltd|Private Limited/i, '(P) Ltd');
            
            console.log(`Extracted company name from URL: "${companyName}"`);
          }
        }
      }
    } catch (e) {
      console.log('Error extracting company name:', e.message);
      companyName = 'Company not found';
    }
    
    // Extract location - try multiple selectors
    try {
      for (const selector of [
        '.loc',
        '.location',
        '.jd-header-loc',
        '[class*="location"]',
        'span.location'
      ]) {
        try {
          const elements = await driver.findElements(By.css(selector));
          if (elements.length > 0) {
            location = await elements[0].getText();
            console.log(`Found location: "${location}" using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
      
      // If location not found, try to extract from URL
      if (!location || location === 'Location not found') {
        // Try to parse location from the URL
        if (jobUrl.includes('hyderabad')) {
          location = 'Hyderabad';
        } else if (jobUrl.includes('bengaluru') || jobUrl.includes('bangalore')) {
          location = 'Bengaluru';
        } else if (jobUrl.includes('mumbai')) {
          location = 'Mumbai';
        } else if (jobUrl.includes('delhi') || jobUrl.includes('noida') || jobUrl.includes('gurgaon')) {
          location = 'Delhi NCR';
        } else if (jobUrl.includes('chennai')) {
          location = 'Chennai';
        } else if (jobUrl.includes('pune')) {
          location = 'Pune';
        }
        
        if (location) {
          console.log(`Extracted location from URL: "${location}"`);
        }
      }
    } catch (e) {
      console.log('Error extracting location:', e.message);
      location = 'Location not found';
    }
    
    // Fix for experience and salary - completely separate them
    let experienceText = '';
    let salaryText = '';
    
    // Try to extract experience
    try {
      for (const selector of [
        '.exp',
        '.experience',
        '[class*="experience"]',
        'span.exp'
      ]) {
        try {
          const elements = await driver.findElements(By.css(selector));
          if (elements.length > 0) {
            experienceText = await elements[0].getText();
            console.log(`Found experience: "${experienceText}" using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
    } catch (e) {
      console.log('Error extracting experience:', e.message);
    }
    
    // Try to extract salary
    try {
      for (const selector of [
        '.salary',
        '.sal',
        '[class*="salary"]',
        'span.salary'
      ]) {
        try {
          const elements = await driver.findElements(By.css(selector));
          if (elements.length > 0) {
            salaryText = await elements[0].getText();
            console.log(`Found salary: "${salaryText}" using selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
    } catch (e) {
      console.log('Error extracting salary:', e.message);
    }
    
    // Process experience
    if (experienceText) {
      // Extract just the experience part (e.g. "0 - 5 years")
      const expMatch = experienceText.match(/(\d+\s*-\s*\d+\s*years|\d+\+?\s*years)/i);
      if (expMatch) {
        experience = expMatch[0];
      } else {
        experience = experienceText;
      }
    }
    
    // If we still don't have experience, try to extract from URL
    if (!experience || experience === 'Experience not found') {
      const expMatch = jobUrl.match(/(\d+)-to-(\d+)-years/);
      if (expMatch && expMatch.length >= 3) {
        experience = `${expMatch[1]} - ${expMatch[2]} years`;
        console.log(`Extracted experience from URL: "${experience}"`);
      }
    }
    
    // Process salary - make sure it doesn't contain experience info
    if (salaryText) {
      // Remove any experience information from salary text
      salaryText = salaryText.replace(/\d+\s*-\s*\d+\s*years|\d+\+?\s*years/gi, '').trim();
      
      if (salaryText.includes('Lacs') || 
          salaryText.includes('PA') || 
          salaryText.includes('Lakhs') || 
          salaryText.toLowerCase().includes('not disclosed')) {
        salary = salaryText;
      } else if (!salaryText || salaryText === '') {
        salary = 'Not Disclosed';
      } else {
        salary = salaryText;
      }
    } else {
      salary = 'Not Disclosed';
    }
    
    // Determine application type
    try {
      for (const selector of [
        '.apply-button',
        'button[type="button"].waves-effect',
        '.jd-btn',
        '[class*="apply"]',
        'button.waves-effect'
      ]) {
        try {
          const applyButtons = await driver.findElements(By.css(selector));
          
          for (const button of applyButtons) {
            const buttonText = await button.getText();
            console.log(`Found button with text: "${buttonText}"`);
            
            if (buttonText.toLowerCase().includes('apply')) {
              if (buttonText.toLowerCase().includes('company website') || 
                  buttonText.toLowerCase().includes('company site') || 
                  buttonText.toLowerCase().includes('on company')) {
                applicationType = 'External';
                console.log('Determined application type: External');
              } else {
                applicationType = 'Internal';
                console.log('Determined application type: Internal');
              }
              break;
            }
          }
          
          if (applicationType !== 'Unknown') {
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }
    } catch (e) {
      console.log('Error determining application type:', e.message);
    }
  } catch (e) {
    console.error('Error extracting job details:', e);
  }
  
  return {
    "Job Title": jobTitle || 'Title not found',
    "Company Name": companyName || 'Company not found',
    "Location": location || 'Location not found',
    "Experience Required": experience || 'Experience not found',
    "Salary": salary || 'Not Disclosed',
    "Application Type": applicationType,
    "Job URL": jobUrl,
    "Scraped Date": new Date().toISOString()
  };
}

// Create the user data directory if it doesn't exist
if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`Created persistent user data directory: ${USER_DATA_DIR}`);
}

// Run the scraper
scrapeNaukriJobs();