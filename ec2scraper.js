const {
  Builder,
  By,
  until,
  Key,
  error: WebDriverError,
} = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
require("dotenv").config();

// --- Configuration ---
// Environment variables with default values
const EMAIL = process.env.EMAIL || "";
const PASSWORD = process.env.PASSWORD || "";
const JOB_SEARCH_QUERY = process.env.JOB_SEARCH_QUERY || "Data Analyst"; // Default to Data Analyst as per logs
const LOCATION = process.env.LOCATION || "Bangalore"; // Default to Bangalore as per logs
const EXPERIENCE = process.env.EXPERIENCE || "0"; // Default experience from logs
const INTERNAL_JOBS_LIMIT = parseInt(process.env.INTERNAL_JOBS_LIMIT || "15");
const EXTERNAL_JOBS_LIMIT = parseInt(process.env.EXTERNAL_JOBS_LIMIT || "5");
const MAX_PAGES_TO_SEARCH = parseInt(process.env.MAX_PAGES_TO_SEARCH || "2");
const OUTPUT_FILE = "./naukri_jobs.json";
const COOKIES_FILE = "./naukri_cookies.json";
const MAX_RETRIES = 3; // Retries for driver initialization
const WAIT_TIMEOUT = 25000; // Slightly increased wait timeout (milliseconds)
const SHORT_WAIT = 7000; // Slightly increased short wait
const SLEEP_INTERVAL = 2000; // Standard sleep interval
const LONG_SLEEP_INTERVAL = 5000; // Longer sleep for page loads/logins

// --- Helper Functions ---

/**
 * Attempts to restore the browser session using saved cookies.
 * @param {import('selenium-webdriver').WebDriver} driver - The Selenium WebDriver instance.
 * @returns {Promise<boolean>} - True if cookies were restored successfully, false otherwise.
 */
async function tryRestoreCookies(driver) {
  if (!fs.existsSync(COOKIES_FILE)) {
    console.log("No saved cookies file found.");
    return false;
  }
  try {
    console.log("Found saved cookies. Attempting to restore session...");
    const cookiesData = JSON.parse(fs.readFileSync(COOKIES_FILE, "utf8"));

    await driver.get("https://www.naukri.com");
    await driver.sleep(LONG_SLEEP_INTERVAL); // Increased wait time for initial load

    // Delete any existing cookies before setting new ones
    await driver.manage().deleteAllCookies();
    await driver.sleep(1000);

    // Set domain cookies first, then the rest
    const domainCookies = cookiesData.filter(c => c.domain && c.domain.includes("naukri"));
    const otherCookies = cookiesData.filter(c => !c.domain || !c.domain.includes("naukri"));
    
    // Add domain cookies first
    for (const cookie of domainCookies) {
      try {
        if (cookie.name && cookie.value) {
          await driver.manage().addCookie({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || ".naukri.com",
            path: cookie.path || "/",
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly
          });
        }
      } catch (e) {
        console.log(`Cookie error (ignored): ${cookie.name}`);
      }
    }
    
    // Then add other cookies if any
    for (const cookie of otherCookies) {
      try {
        if (cookie.name && cookie.value) {
          await driver.manage().addCookie({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || null,
            path: cookie.path || "/",
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly
          });
        }
      } catch (e) {
        // Ignore any errors for non-domain cookies
      }
    }

    console.log("Cookies applied. Refreshing page to activate session...");
    await driver.navigate().refresh();
    await driver.sleep(LONG_SLEEP_INTERVAL);
    
    // Sometimes a second refresh helps establish the session
    await driver.navigate().refresh();
    await driver.sleep(SHORT_WAIT);

    return true;
  } catch (error) {
    console.log(`Error restoring cookies: ${error.message}`);
    try {
      fs.unlinkSync(COOKIES_FILE);
      console.log("Removed potentially corrupted cookies file.");
    } catch (unlinkError) {
      console.log("Error removing cookies file:", unlinkError.message);
    }
    return false;
  }
}

/**
 * Saves the current browser session cookies to a file.
 * @param {import('selenium-webdriver').WebDriver} driver - The Selenium WebDriver instance.
 * @returns {Promise<boolean>} - True if cookies were saved successfully, false otherwise.
 */
async function saveCookies(driver) {
  try {
    console.log("Saving cookies for future sessions...");
    const cookies = await driver.manage().getCookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log("Cookies saved successfully!");
    return true;
  } catch (error) {
    console.log(`Error saving cookies: ${error.message}`);
    return false;
  }
}

/**
 * Checks if the user is logged in by looking for specific elements on the page.
 * Uses a shorter timeout for efficiency.
 * @param {import('selenium-webdriver').WebDriver} driver - The Selenium WebDriver instance.
 * @returns {Promise<boolean>} - True if the user appears to be logged in, false otherwise.
 */
async function checkIfLoggedIn(driver) {
  console.log("Checking login status...");
  
  // First check the current URL - this is a quick way to determine login status
  try {
    const currentUrl = await driver.getCurrentUrl();
    if (currentUrl.includes("mynaukri") || currentUrl.includes("/home")) {
      console.log(`User appears to be logged in (URL indicates logged-in area: ${currentUrl}).`);
      return true;
    }
  } catch (e) {
    // Continue with element checks if URL check fails
  }
  
  // Expanded robust selectors for logged-in state
  const loggedInIndicators = [
    // Header elements
    By.css("div.nI-gNb-bar1"),
    By.css("a.user-name"),
    By.css("div.user-name"),
    By.css("div.nI-gNb-nav__visible"),
    By.css("img.user-pic"),
    By.css('[data-ga-track*="My Naukri"]'),
    By.css('a[href*="mynaukri.naukri.com"]'),
    By.css(".nI-gNb-info"),
    
    // Profile-related elements
    By.css("div.user-info"),
    By.css("div.user-avatar"),
    By.css("div.profile-section"),
    
    // Text-based indicators using XPath
    By.xpath("//*[contains(text(), 'My Naukri')]"),
    By.xpath("//*[contains(text(), 'My Profile')]"),
    By.xpath("//*[contains(text(), 'Logout')]"),
    
    // Dashboard elements
    By.css(".dashboard-container"),
    By.css(".profile-completion"),
    By.css(".recommended-jobs")
  ];

  for (const locator of loggedInIndicators) {
    try {
      const element = await driver.findElement(locator);
      if (await element.isDisplayed()) {
        console.log(`User is logged in (found indicator: ${locator.toString()}).`);
        return true;
      }
    } catch (e) {
      // Element not found or not visible, continue checking
    }
  }
  
  // Check for login/register buttons to confirm not logged in
  const loggedOutIndicators = [
    By.css('a#login_Layer'),
    By.css('a.loginButton'),
    By.css('a.nI-gNb-lg-rg__login'),
    By.xpath("//a[contains(text(), 'Login')]"),
    By.xpath("//button[contains(text(), 'Login')]")
  ];
  
  for (const locator of loggedOutIndicators) {
    try {
      const element = await driver.findElement(locator);
      if (await element.isDisplayed()) {
        console.log(`User is definitely not logged in (found login button: ${locator.toString()}).`);
        return false;
      }
    } catch (e) {
      // Element not found or not visible, continue checking
    }
  }
  
  // Take a screenshot of the current state for debugging
  try {
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync("login_check_state.png", screenshot, "base64");
    console.log("Saved screenshot of page during login check as login_check_state.png");
  } catch (e) {
    // Ignore screenshot errors
  }

  console.log("Could not definitively determine login status. Assuming not logged in.");
  return false;
}

/**
 * Attempts to log in to Naukri.com.
 * @param {import('selenium-webdriver').WebDriver} driver - The Selenium WebDriver instance.
 * @param {string} email - The user's email address.
 * @param {string} password - The user's password.
 * @returns {Promise<boolean>} - True if login was successful, false otherwise.
 */
async function loginToNaukri(driver, email, password) {
  if (!email || !password) {
    console.log("Email or Password not provided. Skipping login attempt.");
    return false;
  }

  try {
    console.log("Attempting login to Naukri.com...");
    
    // Try with direct login page URL first
    await driver.get("https://www.naukri.com/nlogin/login");
    await driver.sleep(LONG_SLEEP_INTERVAL);
    
    // Additional check - sometimes we get redirected to homepage instead of login page
    const currentUrl = await driver.getCurrentUrl();
    if (!currentUrl.includes("login")) {
      console.log("Not on login page - trying alternative login path");
      
      // Try to find and click login button if on homepage
      try {
        const loginButtonSelectors = [
          'a#login_Layer',
          'a.nI-gNb-lg-rg__login',
          'a[title="Jobseeker Login"]',
          'a[href*="login"]'
        ];
        
        for (const selector of loginButtonSelectors) {
          try {
            const loginBtn = await driver.findElement(By.css(selector));
            if (await loginBtn.isDisplayed()) {
              await loginBtn.click();
              console.log("Clicked login button on homepage");
              await driver.sleep(LONG_SLEEP_INTERVAL);
              break;
            }
          } catch (e) {
            // Try next selector
          }
        }
      } catch (e) {
        console.log("Could not find login button on homepage");
      }
    }
    
    // Check if we're on a login page now
    let onLoginPage = false;
    try {
      const emailField = await driver.wait(until.elementLocated(
        By.css('input[placeholder*="Email ID"], input[placeholder*="Username"], #usernameField')
      ), SHORT_WAIT);
      
      if (await emailField.isDisplayed()) {
        onLoginPage = true;
      }
    } catch (e) {
      console.log("Not on login page after navigation attempt");
    }
    
    // If still not on login page, try one more direct URL
    if (!onLoginPage) {
      await driver.get("https://login.naukri.com/nLogin/Login.php");
      await driver.sleep(LONG_SLEEP_INTERVAL);
    }

    // --- Email Field ---
    const emailSelectors = [
      'input[placeholder*="Email ID"]',
      'input[placeholder*="Username"]',
      '#usernameField',
      '#emailTxt',
      'input[name="email"]',
      'input[type="email"]'
    ];
    
    let emailField = null;
    for (const selector of emailSelectors) {
      try {
        emailField = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
        if (await emailField.isDisplayed()) {
          console.log(`Found email field with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!emailField) {
      console.log("Failed to locate email input field");
      return false;
    }
    
    await emailField.clear();
    await emailField.sendKeys(email);
    console.log("Entered email");
    await driver.sleep(500);

    // --- Password Field ---
    const passwordSelectors = [
      'input[placeholder*="Password"]',
      'input[type="password"]',
      '#passwordField',
      'input[name="password"]'
    ];
    
    let passwordField = null;
    for (const selector of passwordSelectors) {
      try {
        passwordField = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
        if (await passwordField.isDisplayed()) {
          console.log(`Found password field with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!passwordField) {
      console.log("Failed to locate password input field");
      return false;
    }
    
    await passwordField.clear();
    await passwordField.sendKeys(password);
    console.log("Entered password");
    await driver.sleep(500);

    // --- Login Button ---
    const loginButtonSelectors = [
      'button[type="submit"]',
      'button.blue-btn',
      'button.loginButton',
      'input[type="submit"]',
      'button.btn-primary',
      'button:contains("Login")'
    ];
    
    let loginButton = null;
    for (const selector of loginButtonSelectors) {
      try {
        if (selector.includes(':contains')) {
          // Handle custom pseudo-selector using XPath
          const xpathSelector = `//button[contains(text(), 'Login')]`;
          loginButton = await driver.findElement(By.xpath(xpathSelector));
        } else {
          loginButton = await driver.findElement(By.css(selector));
        }
        
        if (await loginButton.isDisplayed() && await loginButton.isEnabled()) {
          console.log(`Found login button with selector: ${selector}`);
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }
    
    if (!loginButton) {
      console.log("Failed to locate login button");
      return false;
    }
    
    // Scroll to make sure button is in view
    await driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", loginButton);
    await driver.sleep(500);
    
    // First try normal click
    try {
      await loginButton.click();
      console.log("Clicked login button");
    } catch (clickErr) {
      console.log("Direct click failed, trying JavaScript click");
      try {
        await driver.executeScript("arguments[0].click();", loginButton);
        console.log("Clicked login button using JavaScript");
      } catch (jsClickErr) {
        console.log("JavaScript click also failed:", jsClickErr.message);
        return false;
      }
    }

    // Wait for navigation/login to complete
    await driver.sleep(LONG_SLEEP_INTERVAL * 1.5);
    
    // Handle potential captcha or additional verification
    try {
      const pageSource = await driver.getPageSource();
      if (pageSource.includes("captcha") || pageSource.includes("Captcha")) {
        console.log("CAPTCHA detected! Login requires human intervention.");
        
        // Take a screenshot to help with debugging
        try {
          const screenshot = await driver.takeScreenshot();
          fs.writeFileSync("login_captcha_screenshot.png", screenshot, "base64");
          console.log("Login CAPTCHA screenshot saved as login_captcha_screenshot.png");
        } catch (ssError) {
          console.log("Failed to take captcha screenshot:", ssError.message);
        }
        
        return false;
      }
    } catch (e) {
      // Continue with login check
    }

    // Verify login status
    const isLoggedIn = await checkIfLoggedIn(driver);
    if (isLoggedIn) {
      console.log("Login successful!");
      return true;
    } else {
      // Try checking for error messages
      try {
        const errorSelectors = [
          ".error-txt",
          ".error",
          ".errorMsg",
          "div.erLbl",
          "span.erLbl",
          ".commonErrorMsg"
        ];
        
        for (const selector of errorSelectors) {
          try {
            const errorElement = await driver.findElement(By.css(selector));
            if (await errorElement.isDisplayed()) {
              const errorText = await errorElement.getText();
              console.log(`Login failed. Error: ${errorText}`);
              break;
            }
          } catch (e) {
            // Try next selector
          }
        }
      } catch (e) {
        console.log("Login verification failed. No specific error message found on page.");
      }
      
      // One more sanity check - sometimes the login redirects to a different page than expected
      try {
        const currentUrlAfterLogin = await driver.getCurrentUrl();
        console.log(`Current URL after login attempt: ${currentUrlAfterLogin}`);
        
        if (currentUrlAfterLogin.includes("mynaukri") || 
            currentUrlAfterLogin.includes("home") || 
            !currentUrlAfterLogin.includes("login")) {
          console.log("URL suggests we might be logged in despite indicators missing. Checking redirect page...");
          
          // Try to find any user-specific elements on this page
          const possibleUserElements = [
            'div.user-name',
            'span.user-name',
            'div[class*="profile"]',
            'div.main-user-name',
            'div[class*="user"]'
          ];
          
          for (const selector of possibleUserElements) {
            try {
              const element = await driver.findElement(By.css(selector));
              if (await element.isDisplayed()) {
                const text = await element.getText();
                if (text && text.length > 0 && !text.toLowerCase().includes('login')) {
                  console.log(`Found user element with text: ${text}. Considering as logged in.`);
                  return true;
                }
              }
            } catch (e) {
              // Try next selector
            }
          }
        }
      } catch (e) {
        console.log("Error checking post-login URL:", e.message);
      }
      
      return false;
    }
  } catch (error) {
    console.log(`Error during login process: ${error.message}`);
    
    // Capture screenshot for debugging
    try {
      const screenshot = await driver.takeScreenshot();
      fs.writeFileSync("login_error_screenshot.png", screenshot, "base64");
      console.log("Screenshot saved as login_error_screenshot.png");
    } catch (ssError) {
      console.log("Failed to take screenshot:", ssError.message);
    }
    
    return false;
  }
}

/**
 * Safely finds an element within a parent, returning null if not found.
 * This version does NOT use wait, assuming the parent element is already loaded.
 * @param {import('selenium-webdriver').WebElement | import('selenium-webdriver').WebDriver} parent - The parent element or driver to search within.
 * @param {import('selenium-webdriver').By} locator - The locator strategy.
 * @returns {Promise<import('selenium-webdriver').WebElement|null>} - The found element or null.
 */
async function safeFindElement(parent, locator) {
  try {
    // Directly try to find the element within the parent
    return await parent.findElement(locator);
  } catch (e) {
    // Only return null if the element is not found; log other errors
    if (e instanceof WebDriverError.NoSuchElementError) {
      return null; // Element not found is expected in some cases
    }
    // Avoid logging StaleElementReferenceError excessively if the parent disappears
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      console.log(
        `Warning: Error finding child element ${locator.toString()}: ${
          e.message
        }`
      );
    }
    return null;
  }
}

/**
 * Safely finds multiple elements within a parent, returning an empty array if none are found.
 * @param {import('selenium-webdriver').WebElement | import('selenium-webdriver').WebDriver} parent - The parent element or driver to search within.
 * @param {import('selenium-webdriver').By} locator - The locator strategy.
 * @returns {Promise<import('selenium-webdriver').WebElement[]>} - An array of found elements.
 */
async function safeFindElements(parent, locator) {
  try {
    return await parent.findElements(locator);
  } catch (e) {
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      console.log(
        `Warning: Error finding child elements ${locator.toString()}: ${
          e.message
        }`
      );
    }
    return []; // Return empty array on error
  }
}

/**
 * Safely gets the text from an element, returning a default value if extraction fails.
 * @param {import('selenium-webdriver').WebElement} element - The Selenium WebElement.
 * @param {string} defaultValue - The value to return if text is not found.
 * @returns {Promise<string>} - The trimmed text content or the default value.
 */
async function safeGetText(element, defaultValue = "Not available") {
  if (!element) return defaultValue;
  try {
    const text = await element.getText();
    return text ? text.trim() : defaultValue;
  } catch (e) {
    // Ignore stale element errors as the element might have been removed
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      console.log(`Warning: Could not get text: ${e.message}`);
    }
    return defaultValue;
  }
}

/**
 * Safely gets an attribute value from an element, returning a default value if extraction fails.
 * @param {import('selenium-webdriver').WebElement} element - The Selenium WebElement.
 * @param {string} attributeName - The name of the attribute to get.
 * @param {string|null} defaultValue - The value to return if attribute is not found.
 * @returns {Promise<string|null>} - The attribute value or the default value.
 */
async function safeGetAttribute(element, attributeName, defaultValue = null) {
  if (!element) return defaultValue;
  try {
    const attribute = await element.getAttribute(attributeName);
    return attribute ? attribute.trim() : defaultValue;
  } catch (e) {
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      console.log(
        `Warning: Could not get attribute '${attributeName}': ${e.message}`
      );
    }
    return defaultValue;
  }
}

/**
 * Initializes the Selenium WebDriver with specified options.
 * Includes options to evade detection and improve performance.
 * @returns {Promise<import('selenium-webdriver').WebDriver>} - The initialized WebDriver instance.
 * @throws {Error} - If WebDriver initialization fails after multiple retries.
 */
async function initializeDriver() {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      console.log(
        `Initializing WebDriver (attempt ${retries + 1}/${MAX_RETRIES})...`
      );

      const options = new chrome.Options();
      // Essential headless options
      options.addArguments("--headless=new"); // Use the new headless mode
      options.addArguments("--disable-gpu"); // Often needed for headless
      options.addArguments("--window-size=1920,1080"); // Standard desktop size

      // Performance and stability options
      options.addArguments("--disable-dev-shm-usage"); // Crucial for Docker/Linux
      options.addArguments("--no-sandbox"); // Often needed for Docker/Linux
      options.addArguments("--disable-extensions");
      options.addArguments("--disable-infobars");
      options.addArguments("--disable-popup-blocking");
      options.addArguments("--disable-notifications");
      // options.addArguments("--disable-features=IsolateOrigins,site-per-process"); // Can sometimes cause issues
      // options.addArguments("--memory-pressure-off"); // Experimental
      // options.addArguments("--js-flags=--max-old-space-size=4096"); // May not be necessary

      // Anti-detection options
      options.addArguments(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      ); // Realistic user agent
      options.addArguments("--disable-blink-features=AutomationControlled"); // Key flag
      options.excludeSwitches("enable-automation"); // Another flag to disable

      // Preferences
      const prefs = {
        "profile.default_content_setting_values.notifications": 2,
        credentials_enable_service: false,
        "profile.password_manager_enabled": false,
        "profile.default_content_setting_values.geolocation": 2, // Disable geolocation prompt
        "profile.default_content_setting_values.media_stream": 2, // Disable camera/mic prompt
      };
      options.setUserPreferences(prefs);

      const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

      console.log("WebDriver created successfully");

      // Execute script to further mask automation
      await driver.executeScript(`
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); // Simulate some plugins
                window.chrome = window.chrome || {}; // Ensure chrome object exists
                window.chrome.runtime = window.chrome.runtime || {}; // Ensure runtime exists
            `);
      console.log("Executed anti-detection scripts.");

      return driver;
    } catch (error) {
      console.log(`WebDriver initialization failed: ${error.message}`);
      retries++;
      if (retries >= MAX_RETRIES) {
        throw new Error(
          `Failed to initialize WebDriver after ${MAX_RETRIES} attempts.`
        );
      }
      console.log(`Retrying in ${SHORT_WAIT / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, SHORT_WAIT)); // Wait before retrying
    }
  }
  // This line should technically be unreachable due to the throw in the loop
  throw new Error("WebDriver initialization failed unexpectedly.");
}

// --- Main Scraper Function ---

/**
 * Scrapes job information from Naukri.com based on the configured parameters.
 * @returns {Promise<number>} - The total number of jobs collected.
 */
async function scrapeNaukriJobs() {
  let driver = null;
  let jobsList = [];
  let internalCount = 0;
  let externalCount = 0;
  let page = 1;
  const scrapedUrls = new Set(); // Keep track of scraped URLs to avoid duplicates

  try {
    driver = await initializeDriver();

    // --- Login Phase ---
    console.log("\n--- Login/Session Phase ---");
    await driver.get("https://www.naukri.com/"); // Start at the base domain
    await driver.sleep(SLEEP_INTERVAL);

    let isLoggedIn = false;
    if (await tryRestoreCookies(driver)) {
      isLoggedIn = await checkIfLoggedIn(driver);
      if (isLoggedIn) {
        console.log("Successfully restored session using cookies.");
      } else {
        console.log(
          "Restored cookies, but login status check failed. Attempting manual login."
        );
        // Clear cookies if they didn't grant login status
        await driver.manage().deleteAllCookies();
      }
    } else {
      console.log("Could not restore session from cookies.");
    }

    // Attempt login if not already logged in and credentials are provided
    if (!isLoggedIn && EMAIL && PASSWORD) {
      isLoggedIn = await loginToNaukri(driver, EMAIL, PASSWORD);
      if (isLoggedIn) {
        await saveCookies(driver); // Save cookies after successful login
      } else {
        console.warn(
          "Login failed. Proceeding with scraping without login (results might be limited)."
        );
      }
    } else if (!EMAIL || !PASSWORD) {
      console.log("Email/Password not provided. Proceeding without login.");
    } else {
      console.log("Already logged in.");
    }

    // --- Search Phase ---
    console.log("\n--- Job Search Phase ---");
    // Format query and location for URL
    const formattedQuery = JOB_SEARCH_QUERY.toLowerCase().replace(/\s+/g, "-");
    const formattedLocation = LOCATION.toLowerCase().replace(/\s+/g, "-");
    // Construct base search URL - include experience if specified
    let searchUrlBase = `https://www.naukri.com/${formattedQuery}-jobs-in-${formattedLocation}`;
    if (EXPERIENCE) {
      searchUrlBase += `?experience=${EXPERIENCE}`;
    }
    const searchUrlParams = EXPERIENCE ? "&" : "?"; // Determine separator for page number

    // --- Scraping Loop ---
    while (page <= MAX_PAGES_TO_SEARCH) {
      if (
        internalCount >= INTERNAL_JOBS_LIMIT &&
        externalCount >= EXTERNAL_JOBS_LIMIT
      ) {
        console.log("Reached job limits for both types. Stopping scraping.");
        break;
      }

      const currentPageUrl = `${searchUrlBase}${
        page > 1 ? `${searchUrlParams}pageNo=${page}` : ""
      }`;
      console.log(`\n--- Scraping Page ${page} ---`);
      console.log(`Navigating to: ${currentPageUrl}`);

      try {
        await driver.get(currentPageUrl);
        await driver.sleep(LONG_SLEEP_INTERVAL); // Allow time for dynamic content loading

        // --- UPDATED SELECTORS based on latest Naukri HTML structure ---
        // Using multiple potential selectors for each element to improve robustness
        const jobListContainerSelectors = [
          "div.styles_job-listing-container__OCfZC", // New selector
          "div.list", // Alternative
          "div.listContainer", // Alternative
          "section.listContainer", // Alternative
          "div[data-testid='srp-jobList-container']", // Test ID based
          "div.srp_container", // Legacy
        ];

        const jobCardSelectors = [
          "div.srp-jobtuple-wrapper", // New selector
          "article.jobTuple", // Alternative
          "div.job-tuple", // Alternative
          "div.jobTupleHeader", // Alternative
          "div[data-job-id]", // Any div with job-id
          "div.jobTuple", // Legacy
        ];

        // Try each job list container selector until one works
        let jobListContainerElement = null;
        for (const containerSelector of jobListContainerSelectors) {
          try {
            console.log(`Trying to locate job list container using: ${containerSelector}`);
            jobListContainerElement = await driver.wait(
              until.elementLocated(By.css(containerSelector)),
              SHORT_WAIT // Use shorter wait for each attempt
            );
            console.log(`Job list container found using: ${containerSelector}`);
            break; // If found, exit loop
          } catch (e) {
            // Continue to next selector
          }
        }

        if (!jobListContainerElement) {
          console.log("Could not find job list container with any known selector.");

          // Fallback: Try to find any job cards directly on the page
          for (const cardSelector of jobCardSelectors) {
            try {
              const anyJobCard = await driver.findElement(By.css(cardSelector));
              if (anyJobCard) {
                console.log(`Found job card with selector ${cardSelector} without container. Using document as container.`);
                jobListContainerElement = driver; // Use the driver as the container
                break;
              }
            } catch (e) {
              // Continue to next selector
            }
          }

          if (!jobListContainerElement) {
            // Capture screenshot if still can't find elements
            try {
              const screenshot = await driver.takeScreenshot();
              fs.writeFileSync(`page_${page}_no_elements_found.png`, screenshot, "base64");
              console.log(`Screenshot saved as page_${page}_no_elements_found.png`);
            } catch (ssError) {
              console.log("Failed to take screenshot:", ssError.message);
            }

            // Check if we're on a captcha page
            try {
              const pageSource = await driver.getPageSource();
              if (pageSource.includes("captcha") || pageSource.includes("Captcha")) {
                console.log("CAPTCHA detected! The scraper cannot continue without human intervention.");
                throw new Error("CAPTCHA challenge detected");
              }
            } catch (sourceError) {
              console.log("Could not check for CAPTCHA:", sourceError.message);
            }

            console.log("Could not find job listings with any known selector. Page structure might have changed.");
            break; // Stop scraping pages if no jobs found
          }
        }

        // Find all job cards using found container and try each job card selector
        let jobCards = [];
        for (const cardSelector of jobCardSelectors) {
          try {
            const cards = await jobListContainerElement.findElements(By.css(cardSelector));
            if (cards.length > 0) {
              jobCards = cards;
              console.log(`Found ${cards.length} job cards using selector: ${cardSelector}`);
              break; // If found, exit loop
            }
          } catch (e) {
            // Continue to next selector
          }
        }

        console.log(`Found ${jobCards.length} potential job cards on page ${page}.`);

        if (jobCards.length === 0) {
          console.log(`No job cards found on page ${page}. Check selectors or page structure.`);

          // Try to determine if we're at the end of results
          try {
            const noMoreJobs = await driver.findElements(
              By.xpath("//*[contains(text(), 'No more jobs')]")
            );
            if (noMoreJobs.length > 0) {
              console.log("Found 'No more jobs' message. End of results reached.");
              break; // Stop scraping if end of results
            }
          } catch (e) {
            // Continue processing
          }

          // Check if page number is valid
          if (page > 1) {
            console.log("No jobs found on this page. May have reached end of results.");
            break; // Stop if no jobs and not first page
          }

          page++;
          continue;
        }

        // --- Process Each Job Card ---
        for (let i = 0; i < jobCards.length; i++) {
          if (
            internalCount >= INTERNAL_JOBS_LIMIT &&
            externalCount >= EXTERNAL_JOBS_LIMIT
          )
            break; // Check limits again

          let card;
          try {
            // Re-fetch the list of cards to avoid stale elements
            card = jobCards[i];

            // Scroll the card into view slightly before interacting
            await driver.executeScript(
              "arguments[0].scrollIntoView({ behavior: 'smooth', block: 'center' });",
              card
            );
            await driver.sleep(500); // Brief pause after scroll
          } catch (staleError) {
            console.log(
              `Error locating/scrolling to job card ${i}: ${staleError.message}. Skipping card.`
            );
            continue; // Skip this card if it becomes stale immediately
          }

          let jobTitle = "Not available";
          let jobUrl = null;
          let companyName = "Not available";
          let location = LOCATION; // Default to search location
          let experience = "Not specified";
          let salary = "Not disclosed";
          let skills = "Not available";
          let jobDescription = "Not available";
          let applicationType = "Internal"; // Assume internal unless proven otherwise

          try {
            // --- IMPROVED SELECTORS for job card elements ---
            // Use multiple possible selectors for each element with fallbacks

            // Job Title selectors
            const titleSelectors = [
              "a.title",
              "a.jobTitle",
              "a[title]",
              "div.title a",
              "div.jobTitle a"
            ];

            // Company Name selectors
            const companySelectors = [
              "a.comp-name",
              "a.companyName",
              "a.company-name",
              "div.comp-name a",
              "span.comp-name"
            ];

            // Location selectors
            const locationSelectors = [
              "span.locWdth",
              "span.location",
              "div.loc span",
              "span.location-link",
              "div.location span",
              "span[title*='location']"
            ];

            // Experience selectors
            const experienceSelectors = [
              "span.expwdth",
              "span.experience",
              "div.exp span",
              "span.exp-container",
              "li.experience"
            ];

            // Salary selectors
            const salarySelectors = [
              "span.sal-wrap span",
              "span.salary",
              "div.sal span",
              "span.salary-container",
              "span[title*='salary']"
            ];

            // Skills selectors
            const skillsSelectors = [
              "ul.tags-gt li",
              "ul.skill-tags li",
              "div.tag-li span",
              "ul.skills li",
              "div.skills-section span"
            ];

            // Job Description selectors
            const descriptionSelectors = [
              "span.job-desc",
              "div.job-description",
              "div.desc",
              "div.jobDescription",
              "p.job-desc"
            ];

            // Try each title selector
            for (const selector of titleSelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                jobTitle = await safeGetText(element, jobTitle);
                jobUrl = await safeGetAttribute(element, "href");
                break;
              }
            }

            if (!jobUrl || scrapedUrls.has(jobUrl)) {
              console.log(scrapedUrls.has(jobUrl) ?
                `Skipping duplicate job: ${jobTitle}` :
                `Skipping job card ${i} due to missing URL: ${jobTitle}`);
              continue;
            }

            // Try each company name selector
            for (const selector of companySelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                companyName = await safeGetText(element, companyName);
                break;
              }
            }

            // Try each location selector
            for (const selector of locationSelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                location = await safeGetText(element, location);
                break;
              }
            }

            // Try each experience selector
            for (const selector of experienceSelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                experience = await safeGetText(element, experience);
                break;
              }
            }

            // Try each salary selector
            for (const selector of salarySelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                salary = await safeGetText(element, salary);
                break;
              }
            }

            // Try to get skills from the card
            for (const selector of skillsSelectors) {
              const elements = await safeFindElements(card, By.css(selector));
              if (elements.length > 0) {
                skills = (await Promise.all(elements.map(el => safeGetText(el, "")))).filter(Boolean).join(", ");
                if (skills) break;
              }
            }

            // Try to get job description from the card
            for (const selector of descriptionSelectors) {
              const element = await safeFindElement(card, By.css(selector));
              if (element) {
                jobDescription = await safeGetText(element, jobDescription);
                if (jobDescription !== "Not available") break;
              }
            }

            console.log(
              `\nProcessing Job ${i + 1}/${
                jobCards.length
              }: ${jobTitle} at ${companyName}`
            );
            console.log(`  URL: ${jobUrl}`);

            // --- Navigate to Job Details Page ---
            const originalWindow = await driver.getWindowHandle();
            await driver.switchTo().newWindow("tab");
            await driver.get(jobUrl);
            await driver.sleep(LONG_SLEEP_INTERVAL); // Wait for details page

            try {
              // Try to get detailed description from job page
              const detailDescriptionSelectors = [
                "div.styles_JDC__dang-inner-html__h0K4t",
                "div.job-desc",
                "div.dang-inner-html",
                "div.JDC__dang-inner-html",
                "div.jd-desc",
                "div.description",
                "div#jdDesc",
                "div.job-description"
              ];

              for (const selector of detailDescriptionSelectors) {
                try {
                  await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
                  const descElement = await driver.findElement(By.css(selector));
                  if (descElement) {
                    const detailText = await safeGetText(descElement, "");
                    if (detailText.length > jobDescription.length) {
                      jobDescription = detailText;
                      console.log("  Found detailed job description on job page.");
                      break;
                    }
                  }
                } catch (e) {
                  // Continue to next selector
                }
              }

              // Try to get skills from job page
              const detailSkillsSelectors = [
                "div.styles_key-skill__GIPn_ a.styles_chip__7YCfG",
                "div.key-skill span",
                "div.skills-section span",
                "div.skill-section a",
                "div.keySkills span"
              ];

              for (const selector of detailSkillsSelectors) {
                try {
                  const skillElements = await driver.findElements(By.css(selector));
                  if (skillElements.length > 0) {
                    const detailSkills = (await Promise.all(skillElements.map(el => safeGetText(el, "")))).filter(Boolean).join(", ");
                    if (detailSkills.length > skills.length) {
                      skills = detailSkills;
                      console.log("  Found detailed skills on job page.");
                      break;
                    }
                  }
                } catch (e) {
                  // Continue checking
                }
              }

              // --- Check application type more robustly ---
              // 1. Check for company site button by ID
              try {
                const companySiteButton = await driver.findElement(By.id("company-site-button"));
                if (companySiteButton && await companySiteButton.isDisplayed()) {
                  applicationType = "External";
                  console.log("  → External application (company-site-button ID found)");
                }
              } catch (e) {
                // Button not found, try other methods
              }

              // 2. Check for company site button by class
              if (applicationType === "Internal") {
                try {
                  const externalButtonSelectors = [
                    ".styles_company-site-button__C_2YK",
                    ".company-site-button",
                    "button[data-site='company']",
                    "a.company-site-button",
                    "button.site-apply-button"
                  ];

                  for (const selector of externalButtonSelectors) {
                    const buttons = await driver.findElements(By.css(selector));
                    for (const btn of buttons) {
                      if (await btn.isDisplayed()) {
                        applicationType = "External";
                        console.log(`  → External application (button with selector ${selector} found)`);
                        break;
                      }
                    }
                    if (applicationType === "External") break;
                  }
                } catch (e) {
                  // Continue checking
                }
              }

              // 3. Check for text content in buttons
              if (applicationType === "Internal") {
                try {
                  const allButtons = await driver.findElements(By.css("button, a.button"));
                  for (const btn of allButtons) {
                    try {
                      if (await btn.isDisplayed()) {
                        const text = await btn.getText();
                        const lcText = text.toLowerCase();
                        // Check text content for indicators of external application
                        if ((lcText.includes("company") && lcText.includes("apply")) ||
                            lcText.includes("apply on company") ||
                            lcText.includes("external") ||
                            lcText.includes("apply externally")) {
                          applicationType = "External";
                          console.log("  → External application (based on button text)");
                          break;
                        }
                      }
                    } catch (e) {
                      // Skip this button
                    }
                  }
                } catch (e) {
                  // Continue checking
                }
              }

              // 4. Check URL for external indicators
              if (applicationType === "Internal" && jobUrl) {
                const lcUrl = jobUrl.toLowerCase();
                if (lcUrl.includes("external") || lcUrl.includes("offsite") || lcUrl.includes("redirect")) {
                  applicationType = "External";
                  console.log("  → External application (based on URL pattern)");
                }
              }

              console.log(`  Final determination: ${applicationType} application`);
            } catch (detailError) {
              console.log(
                `  Error scraping details for ${jobTitle}: ${detailError.message}`
              );
              if (detailError instanceof WebDriverError.TimeoutError) {
                jobDescription =
                  "Details page did not load correctly or structure changed.";
              }
              try {
                const ss = await driver.takeScreenshot();
                fs.writeFileSync(
                  `detail_error_${jobTitle.replace(
                    /[^a-z0-9]/gi,
                    "_"
                  )}_${Date.now()}.png`,
                  ss,
                  "base64"
                ); // Sanitize filename
                console.log("  Screenshot of detail page error saved.");
              } catch (ssErr) {
                console.log(
                  "  Failed to take screenshot of detail page:",
                  ssErr.message
                );
              }
            } finally {
              await driver.close();
              await driver.switchTo().window(originalWindow);
              await driver.sleep(500);
            }

            // --- Store Job Data ---
            const jobData = {
              "Job Title": jobTitle,
              "Company Name": companyName,
              Location: location,
              "Experience Required": experience,
              Salary: salary,
              "Application Type": applicationType, // Use the determined type
              "Job URL": jobUrl,
              "Scraped Date": new Date().toISOString(),
              Skills: skills || "Not available", // Ensure fallback
              "Job Description": jobDescription || "Not available", // Ensure fallback
            };

            // Add job to the list based on type and limit, only if needed
            if (
              applicationType === "Internal" &&
              internalCount < INTERNAL_JOBS_LIMIT
            ) {
              jobsList.push(jobData);
              scrapedUrls.add(jobUrl); // Mark URL as scraped
              internalCount++;
              console.log(
                `  Added INTERNAL job (${internalCount}/${INTERNAL_JOBS_LIMIT}): ${jobTitle}`
              );
            } else if (
              applicationType === "External" &&
              externalCount < EXTERNAL_JOBS_LIMIT
            ) {
              jobsList.push(jobData);
              scrapedUrls.add(jobUrl); // Mark URL as scraped
              externalCount++;
              console.log(
                `  Added EXTERNAL job (${externalCount}/${EXTERNAL_JOBS_LIMIT}): ${jobTitle}`
              );
            } else {
              console.log(
                `  Skipping storing job ${jobTitle} - Limits reached for type ${applicationType}.`
              );
            }
          } catch (cardError) {
            console.log(
              `Error processing job card ${i} on page ${page}: ${cardError.message}`
            );
            // Attempt to recover by refreshing or continuing
            if (
              cardError instanceof WebDriverError.StaleElementReferenceError
            ) {
              console.log(
                "  Encountered stale element, trying to continue to next card."
              );
            } else {
              // For other errors, maybe try a refresh? (Use cautiously)
              // console.log("  Attempting page refresh to recover...");
              // await driver.navigate().refresh();
              // await driver.sleep(LONG_SLEEP_INTERVAL);
              // break; // Exit inner loop for this page after refresh
            }
          }
          await driver.sleep(500); // Small delay between processing cards
        } // End of job card loop
      } catch (pageError) {
        console.log(`Error processing page ${page}: ${pageError.message}`);
        if (pageError instanceof WebDriverError.TimeoutError) {
          console.log(
            "  Timeout waiting for elements on page. Check selectors or network speed."
          );
        } else if (
          pageError.message.includes("session") ||
          pageError.message.includes("crashed")
        ) {
          console.error(
            "Session lost or browser crashed! Attempting to reinitialize..."
          );
          // Try to quit existing driver cleanly
          if (driver) {
            try {
              await driver.quit();
            } catch (qErr) {
              console.log("Error quitting old driver:", qErr.message);
            }
          }
          // Re-initialize
          try {
            driver = await initializeDriver();
            // Optional: Try to log in again if needed
            // isLoggedIn = await loginToNaukri(driver, EMAIL, PASSWORD);
            console.log("Reinitialized driver. Continuing from next page.");
            page++; // Increment page to avoid retrying the same failed page immediately
            continue; // Skip to the next iteration of the while loop
          } catch (reinitError) {
            console.error(
              `FATAL: Failed to reinitialize driver after crash: ${reinitError.message}`
            );
            throw reinitError; // Propagate fatal error
          }
        }
        // Capture screenshot on general page error
        try {
          const screenshot = await driver.takeScreenshot();
          fs.writeFileSync(
            `page_${page}_general_error_screenshot.png`,
            screenshot,
            "base64"
          );
          console.log(
            `Screenshot saved as page_${page}_general_error_screenshot.png`
          );
        } catch (ssError) {
          console.log("Failed to take screenshot:", ssError.message);
        }
      }

      // Move to the next page
      page++;
      await driver.sleep(SLEEP_INTERVAL); // Wait a bit before loading the next page
    } // End of page loop

    // --- Save Results ---
    console.log(`\n=== SCRAPING RESULTS ===`);
    console.log(`Internal jobs collected: ${internalCount}`);
    console.log(`External jobs collected: ${externalCount}`);
    console.log(`Total unique jobs collected: ${jobsList.length}`);

    if (jobsList.length > 0) {
      console.log(`Saving ${jobsList.length} jobs to ${OUTPUT_FILE}...`);
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsList, null, 2));
      console.log("Jobs saved successfully!");
    } else {
      console.log("No new jobs were collected to save.");
    }

    return jobsList.length;
  } catch (error) {
    console.error(`\n--- FATAL SCRAPER ERROR ---`);
    console.error(`Error: ${error.message}`);
    console.error(error.stack); // Print stack trace for better debugging

    // Attempt to save any partially collected data
    if (jobsList.length > 0) {
      console.log(
        `Attempting to save ${jobsList.length} partially collected jobs before exit...`
      );
      try {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsList, null, 2));
        console.log("Partial data saved successfully.");
      } catch (saveError) {
        console.error(`Failed to save partial data: ${saveError.message}`);
      }
    }
    return jobsList.length; // Return count even on error
  } finally {
    if (driver) {
      try {
        console.log("\nClosing WebDriver...");
        await driver.quit();
        console.log("WebDriver closed successfully.");
      } catch (e) {
        console.log("Error closing WebDriver:", e.message);
      }
    }
  }
}

// --- Execute Scraper ---
console.log("Starting Naukri Scraper...");
scrapeNaukriJobs()
  .then((jobCount) => {
    console.log(`\nScraping process finished!`);
    console.log(`Collected ${jobCount} jobs.`);
    process.exit(0); // Exit with success code
  })
  .catch((err) => {
    console.error(`\n--- SCRIPT EXECUTION FAILED ---`);
    console.error(`Error: ${err.message}`);
    process.exit(1); // Exit with error code
  });
