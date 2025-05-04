const {
  Builder,
  By,
  until,
  Key, // Key is used in the original code, ensure it's included if needed later, though not directly used in the provided snippets.
  error: WebDriverError,
} = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const { MongoClient } = require("mongodb"); // Added MongoDB client
require("dotenv").config();

// --- Command Line Argument Parsing ---
const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i += 2) {
  if (args[i].startsWith("--") && i + 1 < args.length) {
    // Simple parsing, assumes "--key value" format
    params[args[i].substring(2)] = args[i + 1];
  } else if (args[i].startsWith("--")) {
    // Handle boolean flags if needed in the future
    // params[args[i].substring(2)] = true;
  }
}

// --- Configuration ---
// Environment variables with defaults, overridden by command-line args
const EMAIL = params.email || process.env.EMAIL || "";
const PASSWORD = params.password || process.env.PASSWORD || "";
const JOB_SEARCH_QUERY = params.query || process.env.JOB_SEARCH_QUERY || "Data Analyst";
const LOCATION = params.location || process.env.LOCATION || "Bangalore";
const EXPERIENCE = params.experience || process.env.EXPERIENCE || "0"; // Default experience
const INTERNAL_JOBS_LIMIT = parseInt(params.internal || process.env.INTERNAL_JOBS_LIMIT || "15");
const EXTERNAL_JOBS_LIMIT = parseInt(params.external || process.env.EXTERNAL_JOBS_LIMIT || "5");
const MAX_PAGES_TO_SEARCH = parseInt(params.pages || process.env.MAX_PAGES_TO_SEARCH || "2");

// MongoDB configuration
const MONGODB_URI = params.mongoUri || process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = params.dbName || process.env.DB_NAME || "naukri_jobs_db";
const COLLECTION_NAME = params.collection || process.env.COLLECTION_NAME || "jobs";

// Files and paths (Dynamic filenames)
const sanitizedQuery = JOB_SEARCH_QUERY.replace(/[^a-z0-9]/gi, '_').toLowerCase();
const sanitizedLocation = LOCATION.replace(/[^a-z0-9]/gi, '_').toLowerCase();
const OUTPUT_FILE = `./naukri_jobs_${sanitizedQuery}_${sanitizedLocation}.json`;
const COOKIES_FILE = "./naukri_cookies.json";
const LOG_FILE = `./logs/scrape_log_${sanitizedQuery}_${sanitizedLocation}_${new Date().toISOString().split('T')[0]}.log`;

// --- Logging Setup ---
// Ensure logs directory exists
const logDir = './logs';
if (!fs.existsSync(logDir)) {
  try {
    fs.mkdirSync(logDir);
    console.log(`Created log directory: ${logDir}`);
  } catch (err) {
    console.error(`Error creating log directory: ${err.message}`);
    // Continue without file logging if directory creation fails
  }
}

// Redirect console output to file and terminal
let logStream;
try {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn; // Capture warnings too

    console.log = function(...args) {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      const logMessage = `[${timestamp}] [INFO] ${message}`;
      originalConsoleLog(logMessage); // Log to terminal
      if (logStream) logStream.write(logMessage + '\n'); // Log to file
    };

    console.error = function(...args) {
      const timestamp = new Date().toISOString();
      const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
      const logMessage = `[${timestamp}] [ERROR] ${message}`;
      originalConsoleError(logMessage); // Log to terminal
      if (logStream) logStream.write(logMessage + '\n'); // Log to file
    };

    console.warn = function(...args) {
        const timestamp = new Date().toISOString();
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        const logMessage = `[${timestamp}] [WARN] ${message}`;
        originalConsoleWarn(logMessage); // Log to terminal
        if (logStream) logStream.write(logMessage + '\n'); // Log to file
      };

} catch (logErr) {
    console.error(`Failed to create log file stream: ${logErr.message}. Logging to console only.`);
    logStream = null; // Ensure logStream is null if setup failed
}


// Other constants
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

    // Navigate to the base domain first to set cookies
    await driver.get("https://www.naukri.com");
    await driver.sleep(LONG_SLEEP_INTERVAL); // Wait for initial load

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
          // Ensure domain starts with a dot if it's a subdomain pattern
          let domain = cookie.domain || ".naukri.com";
          if (!domain.startsWith(".") && domain.includes("naukri.com") && domain !== "naukri.com") {
              domain = "." + domain;
          }
          await driver.manage().addCookie({
            name: cookie.name,
            value: cookie.value,
            domain: domain,
            path: cookie.path || "/",
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly,
            // expiry: cookie.expiry ? new Date(cookie.expiry * 1000) : undefined // Handle expiry if present
          });
        }
      } catch (e) {
        console.warn(`Cookie error (ignored): ${cookie.name} - ${e.message}`);
      }
    }

    // Then add other cookies if any (less critical)
    for (const cookie of otherCookies) {
      try {
        if (cookie.name && cookie.value) {
          await driver.manage().addCookie({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain || null, // Let the browser handle domain if not specified
            path: cookie.path || "/",
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly,
            // expiry: cookie.expiry ? new Date(cookie.expiry * 1000) : undefined
          });
        }
      } catch (e) {
        // Ignore any errors for non-domain cookies
         console.warn(`Non-domain cookie error (ignored): ${cookie.name} - ${e.message}`);
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
    console.error(`Error restoring cookies: ${error.message}`);
    // Attempt to remove corrupted cookies file
    try {
      fs.unlinkSync(COOKIES_FILE);
      console.log("Removed potentially corrupted cookies file.");
    } catch (unlinkError) {
      console.error("Error removing cookies file:", unlinkError.message);
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
    console.error(`Error saving cookies: ${error.message}`);
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
    if (currentUrl.includes("mynaukri") || currentUrl.includes("/v1/user/dashboard")) {
      console.log(`User appears to be logged in (URL indicates logged-in area: ${currentUrl}).`);
      return true;
    }
  } catch (e) {
      console.warn(`Could not get current URL during login check: ${e.message}`);
  }

  // Expanded robust selectors for logged-in state
  const loggedInIndicators = [
    // Header elements
    By.css("div.nI-gNb-bar1"), // Global nav bar
    By.css("a.user-name"),     // User name link (older?)
    By.css("div.user-name"),    // User name div (older?)
    By.css("div.nI-gNb-nav__visible"), // Visible part of nav
    By.css("img.user-pic"),     // User profile picture
    By.css('[data-ga-track*="My Naukri"]'), // My Naukri link
    By.css('a[href*="mynaukri.naukri.com"]'), // Link to My Naukri
    By.css(".nI-gNb-info"), // User info section in header
    By.css("div.view-profile-wrapper"), // View profile link container
    By.css("a[href*='/profile-summary']"), // Link to profile summary

    // Profile-related elements
    By.css("div.user-info"),    // Generic user info div
    By.css("div.user-avatar"),  // User avatar container
    By.css("div.profile-section"), // Any profile section

    // Text-based indicators using XPath
    By.xpath("//*[contains(text(), 'My Naukri')]"),
    By.xpath("//*[contains(text(), 'My Profile')]"),
    By.xpath("//*[contains(text(), 'Logout')]"), // Logout button presence

    // Dashboard elements
    By.css(".dashboard-container"), // Main dashboard container
    By.css(".profile-completion"), // Profile completion widget
    By.css(".recommended-jobs") // Recommended jobs section
  ];

  for (const locator of loggedInIndicators) {
    try {
      // Use a shorter wait time for checking indicators
      const element = await driver.wait(until.elementLocated(locator), SHORT_WAIT / 2);
      if (await element.isDisplayed()) {
        console.log(`User is logged in (found indicator: ${locator.toString()}).`);
        return true;
      }
    } catch (e) {
      // Element not found or not visible within the short timeout, continue checking
      if (!(e instanceof WebDriverError.TimeoutError || e instanceof WebDriverError.NoSuchElementError)) {
          console.warn(`Error checking login indicator ${locator.toString()}: ${e.message}`);
      }
    }
  }

  // Check for login/register buttons to confirm not logged in
  const loggedOutIndicators = [
    By.css('a#login_Layer'),          // Login layer link
    By.css('a.loginButton'),          // Generic login button class
    By.css('a.nI-gNb-lg-rg__login'),  // Login button in header
    By.xpath("//a[contains(text(), 'Login')]"), // Any link with text 'Login'
    By.xpath("//button[contains(text(), 'Login')]") // Any button with text 'Login'
  ];

  for (const locator of loggedOutIndicators) {
    try {
      const element = await driver.wait(until.elementLocated(locator), SHORT_WAIT / 2);
      if (await element.isDisplayed()) {
        console.log(`User is definitely not logged in (found login button: ${locator.toString()}).`);
        return false;
      }
    } catch (e) {
       if (!(e instanceof WebDriverError.TimeoutError || e instanceof WebDriverError.NoSuchElementError)) {
          console.warn(`Error checking logout indicator ${locator.toString()}: ${e.message}`);
      }
    }
  }

  // Take a screenshot if status is ambiguous
  try {
    const screenshot = await driver.takeScreenshot();
    fs.writeFileSync("login_check_state.png", screenshot, "base64");
    console.log("Saved screenshot of page during login check as login_check_state.png");
  } catch (e) {
    console.warn(`Failed to take screenshot during login check: ${e.message}`);
  }

  console.log("Could not definitively determine login status based on common indicators. Assuming not logged in.");
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
    let currentUrl = await driver.getCurrentUrl();
    if (!currentUrl.includes("login")) {
      console.log("Not on login page - trying alternative login path from homepage");

      // Try to find and click login button if on homepage
      try {
        const loginButtonSelectors = [
          'a#login_Layer',
          'a.nI-gNb-lg-rg__login',
          'a[title="Jobseeker Login"]',
          'a[href*="login"]'
        ];

        let loginButtonClicked = false;
        for (const selector of loginButtonSelectors) {
          try {
            const loginBtn = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
            if (await loginBtn.isDisplayed() && await loginBtn.isEnabled()) {
              await loginBtn.click();
              console.log(`Clicked login button on homepage using selector: ${selector}`);
              await driver.sleep(LONG_SLEEP_INTERVAL); // Wait for login modal/page
              loginButtonClicked = true;
              break;
            }
          } catch (e) {
            // Try next selector
          }
        }
        if (!loginButtonClicked) {
            console.warn("Could not find or click a visible login button on the homepage.");
        }
      } catch (e) {
        console.error("Error trying to click login button on homepage:", e.message);
      }
    }

    // Check if we're on a login page now by looking for the email field
    let onLoginPage = false;
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
          onLoginPage = true;
          break;
        }
      } catch (e) {
        // Try next selector
      }
    }

    // If still not on login page (or couldn't find email field), try another direct URL
    if (!onLoginPage) {
      console.log("Still not on login page or email field not found, trying another login URL...");
      await driver.get("https://login.naukri.com/nLogin/Login.php"); // Older login URL
      await driver.sleep(LONG_SLEEP_INTERVAL);
      // Re-check for email field
      for (const selector of emailSelectors) {
        try {
          emailField = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
          if (await emailField.isDisplayed()) {
            console.log(`Found email field with selector after second URL attempt: ${selector}`);
            onLoginPage = true;
            break;
          }
        } catch (e) { }
      }
    }

    if (!onLoginPage || !emailField) {
      console.error("Failed to navigate to login page or locate email input field after multiple attempts.");
      await takeScreenshot(driver, "login_page_fail_screenshot.png");
      return false;
    }

    // --- Enter Credentials ---
    try {
        await emailField.clear();
        await emailField.sendKeys(email);
        console.log("Entered email");
        await driver.sleep(500); // Small pause
    } catch (e) {
        console.error(`Error interacting with email field: ${e.message}`);
        return false;
    }

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
      } catch (e) { }
    }

    if (!passwordField) {
      console.error("Failed to locate password input field");
      await takeScreenshot(driver, "login_password_fail_screenshot.png");
      return false;
    }

    try {
        await passwordField.clear();
        await passwordField.sendKeys(password);
        console.log("Entered password");
        await driver.sleep(500);
    } catch (e) {
        console.error(`Error interacting with password field: ${e.message}`);
        return false;
    }

    // --- Login Button ---
    const loginButtonSelectors = [
      'button[type="submit"]',
      'button.blue-btn', // Common class
      'button.loginButton', // Another common class
      'input[type="submit"][value="Login"]', // Input submit
      'button.btn-primary', // Bootstrap style
      'button.waves-effect', // Materialize style often used
      'button:contains("Login")', // Sizzle selector (might not work directly, use XPath below)
      '//button[normalize-space()="Login"]', // XPath for button with exact text "Login"
      '//button[contains(normalize-space(),"Login")]' // XPath for button containing text "Login"
    ];
    let loginButton = null;
    for (const selector of loginButtonSelectors) {
      try {
        let locatedButton;
        if (selector.startsWith("//")) { // Check if XPath
            locatedButton = await driver.wait(until.elementLocated(By.xpath(selector)), SHORT_WAIT);
        } else if (selector.includes(':contains')) { // Handle potential pseudo-selector via XPath
             const text = selector.split(':contains("')[1].split('")')[0];
             const xpathSelector = `//button[contains(normalize-space(),'${text}')]`;
             locatedButton = await driver.wait(until.elementLocated(By.xpath(xpathSelector)), SHORT_WAIT);
        } else { // Assume CSS selector
            locatedButton = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
        }

        if (await locatedButton.isDisplayed() && await locatedButton.isEnabled()) {
          console.log(`Found login button with selector: ${selector}`);
          loginButton = locatedButton;
          break;
        }
      } catch (e) {
         if (!(e instanceof WebDriverError.TimeoutError || e instanceof WebDriverError.NoSuchElementError)) {
             console.warn(`Error checking login button selector ${selector}: ${e.message}`);
         }
      }
    }

    if (!loginButton) {
      console.error("Failed to locate a clickable login button");
      await takeScreenshot(driver, "login_button_fail_screenshot.png");
      return false;
    }

    // Scroll to make sure button is in view and click
    try {
        await driver.executeScript("arguments[0].scrollIntoView({block: 'center'});", loginButton);
        await driver.sleep(500); // Wait for scroll
        await loginButton.click();
        console.log("Clicked login button");
    } catch (clickErr) {
        console.warn(`Direct click failed (${clickErr.message}), trying JavaScript click...`);
        try {
            await driver.executeScript("arguments[0].click();", loginButton);
            console.log("Clicked login button using JavaScript");
        } catch (jsClickErr) {
            console.error("JavaScript click also failed:", jsClickErr.message);
            await takeScreenshot(driver, "login_click_fail_screenshot.png");
            return false;
        }
    }

    // Wait for navigation/login to complete
    console.log(`Waiting ${LONG_SLEEP_INTERVAL * 1.5 / 1000}s for login process...`);
    await driver.sleep(LONG_SLEEP_INTERVAL * 1.5);

    // Handle potential captcha or additional verification
    try {
      const pageSource = await driver.getPageSource();
      if (pageSource.toLowerCase().includes("captcha")) {
        console.error("CAPTCHA detected! Login requires human intervention.");
        await takeScreenshot(driver, "login_captcha_screenshot.png");
        return false; // Cannot proceed with CAPTCHA
      }
       if (pageSource.toLowerCase().includes("verify mobile") || pageSource.toLowerCase().includes("enter otp")) {
        console.error("OTP/Verification required! Login requires human intervention.");
        await takeScreenshot(driver, "login_otp_screenshot.png");
        return false; // Cannot proceed with OTP
      }
    } catch (e) {
        console.warn(`Could not check page source for CAPTCHA/OTP: ${e.message}`);
    }

    // Verify login status robustly
    const isLoggedIn = await checkIfLoggedIn(driver);
    if (isLoggedIn) {
      console.log("Login successful!");
      return true;
    } else {
      console.warn("Login verification failed after clicking button.");
      // Try checking for error messages
      try {
        const errorSelectors = [
          ".error-txt", ".error", ".errorMsg", "div.erLbl", "span.erLbl", ".commonErrorMsg",
          '[class*="error"]', // Any element with "error" in class
          '[class*="alert"]' // Any element with "alert" in class
        ];
        let errorFound = false;
        for (const selector of errorSelectors) {
          try {
            const errorElements = await driver.findElements(By.css(selector));
            for (const errorElement of errorElements) {
                if (await errorElement.isDisplayed()) {
                    const errorText = await errorElement.getText();
                    if (errorText && errorText.trim().length > 0) {
                        console.error(`Login failed. Error message found: ${errorText.trim()}`);
                        errorFound = true;
                        break;
                    }
                }
            }
            if (errorFound) break;
          } catch (e) {
            // Ignore if selector not found
          }
        }
        if (!errorFound) {
            console.warn("No specific error message found on page after failed login attempt.");
        }
      } catch (e) {
        console.warn("Could not check for login error messages:", e.message);
      }

      await takeScreenshot(driver, "login_verify_fail_screenshot.png");
      return false;
    }
  } catch (error) {
    console.error(`Error during login process: ${error.message}`);
    console.error(error.stack); // Log stack trace
    await takeScreenshot(driver, "login_fatal_error_screenshot.png");
    return false;
  }
}

/**
 * Safely finds an element within a parent, returning null if not found.
 * Does not wait implicitly, relies on parent being ready or explicit waits before calling.
 * @param {import('selenium-webdriver').WebElement | import('selenium-webdriver').WebDriver} parent - The parent element or driver to search within.
 * @param {import('selenium-webdriver').By} locator - The locator strategy.
 * @returns {Promise<import('selenium-webdriver').WebElement|null>} - The found element or null.
 */
async function safeFindElement(parent, locator) {
  try {
    return await parent.findElement(locator);
  } catch (e) {
    if (e instanceof WebDriverError.NoSuchElementError) {
      return null; // Element not found is expected in some cases
    }
    // Avoid logging StaleElementReferenceError excessively if the parent disappears
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      // Log other errors as warnings
      console.warn(
        `Warning: Error finding child element ${locator.toString()}: ${e.name} - ${
          e.message.split('\n')[0] // Keep message concise
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
       console.warn(
        `Warning: Error finding child elements ${locator.toString()}: ${e.name} - ${
          e.message.split('\n')[0]
        }`
      );
    }
    return []; // Return empty array on error
  }
}

/**
 * Safely gets the text from an element, returning a default value if extraction fails.
 * @param {import('selenium-webdriver').WebElement | null} element - The Selenium WebElement or null.
 * @param {string} defaultValue - The value to return if text is not found or element is null.
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
      console.warn(`Warning: Could not get text: ${e.name} - ${e.message.split('\n')[0]}`);
    }
    return defaultValue;
  }
}

/**
 * Safely gets an attribute value from an element, returning a default value if extraction fails.
 * @param {import('selenium-webdriver').WebElement | null} element - The Selenium WebElement or null.
 * @param {string} attributeName - The name of the attribute to get.
 * @param {string|null} defaultValue - The value to return if attribute is not found or element is null.
 * @returns {Promise<string|null>} - The attribute value or the default value.
 */
async function safeGetAttribute(element, attributeName, defaultValue = null) {
  if (!element) return defaultValue;
  try {
    const attribute = await element.getAttribute(attributeName);
    // Check for null/undefined explicitly, return defaultValue if attribute is missing
    return attribute !== null && attribute !== undefined ? attribute.trim() : defaultValue;
  } catch (e) {
    if (!(e instanceof WebDriverError.StaleElementReferenceError)) {
      console.warn(
        `Warning: Could not get attribute '${attributeName}': ${e.name} - ${e.message.split('\n')[0]}`
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
      options.addArguments("--disable-infobars"); // Deprecated but doesn't hurt
      options.addArguments("--disable-popup-blocking");
      options.addArguments("--disable-notifications");
      // options.addArguments("--disable-features=IsolateOrigins,site-per-process"); // Can sometimes cause issues
      // options.addArguments("--enable-features=NetworkService,NetworkServiceInProcess"); // May improve stability

      // Anti-detection options
      options.addArguments(
        "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" // Realistic & recent user agent
      );
      options.addArguments("--disable-blink-features=AutomationControlled"); // Key flag
      options.excludeSwitches("enable-automation"); // Another flag to disable
      options.addArguments("--disable-features=UserAgentClientHint"); // Disable client hints that might reveal automation

      // Preferences
      const prefs = {
        "profile.default_content_setting_values.notifications": 2, // 1:allow, 2:block
        "profile.default_content_setting_values.geolocation": 2, // Block geolocation
        "profile.default_content_setting_values.media_stream": 2, // Block camera/mic
        "credentials_enable_service": false, // Disable password manager prompt
        "profile.password_manager_enabled": false, // Disable password manager
      };
      options.setUserPreferences(prefs);

      // Experimental options (use with caution)
      // options.addArguments('--enable-logging'); // Enable more verbose logging from Chrome
      // options.setChromeLogFile('./chromedriver.log');

      const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .build();

      console.log("WebDriver created successfully");

      // Set implicit wait (use cautiously, explicit waits are generally preferred)
      // await driver.manage().setTimeouts({ implicit: 5000 }); // 5 seconds

      // Execute script to further mask automation
      try {
        await driver.executeScript(`
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] }); // Simulate some plugins
            // Ensure window.chrome exists before modifying
            window.chrome = window.chrome || {};
            window.chrome.runtime = window.chrome.runtime || {};
            // Overwrite permissions API to further mask automation
            if (navigator.permissions) {
              const originalQuery = navigator.permissions.query;
              navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                  Promise.resolve({ state: 'prompt' }) : // Denied or Prompt is common for notifications
                  originalQuery(parameters)
              );
            }
            // Add WebGL vendor/renderer spoofing if needed
            // try {
            //   const canvas = document.createElement('canvas');
            //   const gl = canvas.getContext('webgl');
            //   const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            //   Object.defineProperty(gl, 'getParameter', {
            //     value: (param) => {
            //       if (param === debugInfo.UNMASKED_VENDOR_WEBGL) return 'Intel Inc.';
            //       if (param === debugInfo.UNMASKED_RENDERER_WEBGL) return 'Intel Iris OpenGL Engine';
            //       return gl.getParameter(param);
            //     }
            //   });
            // } catch (e) {}
          `);
        console.log("Executed anti-detection scripts.");
      } catch (scriptError) {
        console.warn(`Failed to execute anti-detection scripts: ${scriptError.message}`);
        // Continue execution even if scripts fail
      }


      return driver;
    } catch (error) {
      console.error(`WebDriver initialization failed: ${error.message}`);
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

/**
 * Takes a screenshot and saves it.
 * @param {import('selenium-webdriver').WebDriver} driver
 * @param {string} filename
 */
async function takeScreenshot(driver, filename = 'screenshot.png') {
    if (!driver) return;
    try {
        const screenshot = await driver.takeScreenshot();
        fs.writeFileSync(filename, screenshot, "base64");
        console.log(`Screenshot saved as ${filename}`);
    } catch (e) {
        console.warn(`Failed to take screenshot (${filename}): ${e.message}`);
    }
}


// --- Main Scraper Function ---

/**
 * Scrapes job information from Naukri.com based on the configured parameters,
 * stores results in MongoDB, and saves a JSON backup.
 * @returns {Promise<number>} - The total number of *new* jobs collected and saved.
 */
async function scrapeNaukriJobs() {
  let driver = null;
  let mongoClient = null;
  let jobsToSave = []; // List to hold only new jobs for bulk write
  let internalCount = 0;
  let externalCount = 0;
  let newJobsCount = 0;
  let page = 1;
  const scrapedUrls = new Set(); // Keep track of scraped URLs (from DB + current session)

  try {
    console.log(`Starting scrape for query "${JOB_SEARCH_QUERY}" in location "${LOCATION}" (Exp: ${EXPERIENCE})`);
    console.log(`Limits: Internal=${INTERNAL_JOBS_LIMIT}, External=${EXTERNAL_JOBS_LIMIT}, MaxPages=${MAX_PAGES_TO_SEARCH}`);
    console.log(`Database: ${DB_NAME}, Collection: ${COLLECTION_NAME}`);

    // --- Connect to MongoDB ---
    console.log(`Connecting to MongoDB at ${MONGODB_URI}...`);
    mongoClient = new MongoClient(MONGODB_URI); // Add options if needed: { useNewUrlParser: true, useUnifiedTopology: true }
    await mongoClient.connect();
    console.log("Connected to MongoDB successfully.");

    const db = mongoClient.db(DB_NAME);
    const jobsCollection = db.collection(COLLECTION_NAME);

    // Optional: Create index on Job URL for faster lookups/upserts
    try {
        await jobsCollection.createIndex({ "Job URL": 1 }, { unique: true });
        console.log("Ensured index exists on 'Job URL'.");
    } catch (indexError) {
        // Ignore if index already exists (code 85), log other errors
        if (indexError.code !== 85) {
            console.warn(`Could not create index on 'Job URL': ${indexError.message}`);
        } else {
             console.log("Index on 'Job URL' already exists.");
        }
    }


    // --- Load Existing URLs from DB ---
    console.log("Loading existing job URLs from database...");
    const existingJobsCursor = jobsCollection.find({}, { projection: { "Job URL": 1 } });
    await existingJobsCursor.forEach(job => {
      if (job["Job URL"]) {
        scrapedUrls.add(job["Job URL"]);
      }
    });
    console.log(`Loaded ${scrapedUrls.size} unique existing job URLs from the database.`);

    // --- Initialize WebDriver ---
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
        console.warn(
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
          "Login failed. Proceeding with scraping without login (results might be limited or blocked)."
        );
      }
    } else if (!EMAIL || !PASSWORD) {
      console.log("Email/Password not provided. Proceeding without login.");
    } else {
      console.log("Already logged in (or session restored).");
    }

    // --- Search Phase ---
    console.log("\n--- Job Search Phase ---");
    // Format query and location for URL
    const formattedQuery = JOB_SEARCH_QUERY.toLowerCase().replace(/\s+/g, "-");
    const formattedLocation = LOCATION.toLowerCase().replace(/\s+/g, "-");
    // Construct base search URL - include experience if specified
    let searchUrlBase = `https://www.naukri.com/${formattedQuery}-jobs-in-${formattedLocation}`;
    let searchUrlParams = "";
    if (EXPERIENCE && EXPERIENCE !== "0") { // Only add experience if it's not 0
        searchUrlBase += `?experience=${EXPERIENCE}`;
        searchUrlParams = "&"; // Use '&' if experience is present
    } else {
        searchUrlParams = "?"; // Use '?' if experience is not present
    }

    // --- Scraping Loop ---
    while (page <= MAX_PAGES_TO_SEARCH) {
      if (
        internalCount >= INTERNAL_JOBS_LIMIT &&
        externalCount >= EXTERNAL_JOBS_LIMIT
      ) {
        console.log(`Reached job limits (Internal: ${internalCount}, External: ${externalCount}). Stopping search.`);
        break;
      }

      const currentPageUrl = `${searchUrlBase}${
        page > 1 ? `${searchUrlParams}pageNo=${page}` : ""
      }`;
      console.log(`\n--- Scraping Page ${page}/${MAX_PAGES_TO_SEARCH} ---`);
      console.log(`Navigating to: ${currentPageUrl}`);

      try {
        await driver.get(currentPageUrl);
        // Increased wait time for dynamic content loading, especially on results pages
        await driver.sleep(LONG_SLEEP_INTERVAL + SLEEP_INTERVAL);

        // --- Locating Job List Container ---
        const jobListContainerSelectors = [
          "div.styles_job-listing-container__OCfZC", // Primary modern selector
          "div.list",                                // Common alternative
          "div.listContainer",                       // Another alternative
          "section.listContainer",                   // Section alternative
          "div[data-testid='srp-jobList-container']",// Test ID based
          "div.srp-jobtuple-wrapper",                // Sometimes the wrapper IS the container
          "div.srp_container",                       // Legacy
          "article.jobTuple",                        // Sometimes articles are direct children
        ];
        let jobListContainerElement = null;
        for (const containerSelector of jobListContainerSelectors) {
          try {
            console.log(`Trying to locate job list container using: ${containerSelector}`);
            // Wait briefly for the container to appear
            jobListContainerElement = await driver.wait(
              until.elementLocated(By.css(containerSelector)),
              SHORT_WAIT
            );
            console.log(`Job list container found using: ${containerSelector}`);
            break; // If found, exit loop
          } catch (e) {
             if (!(e instanceof WebDriverError.TimeoutError || e instanceof WebDriverError.NoSuchElementError)) {
                 console.warn(`Error checking container selector ${containerSelector}: ${e.message}`);
             }
            // Continue to next selector
          }
        }

        if (!jobListContainerElement) {
          console.warn("Could not find job list container with any known selector.");

          // Fallback: Check if job cards exist directly under body (less likely but possible)
          const jobCardSelectors = [
            "article.jobTuple", // Primary card selector
            "div.srp-jobtuple-wrapper", // Wrapper might act as card
            "div.jobTuple", // Legacy
            "div.jobTupleHeader", // Part of a card
            "div[data-job-id]", // Any div with job-id attribute
          ];
          let foundDirectCard = false;
          for (const cardSelector of jobCardSelectors) {
            try {
              const anyJobCard = await driver.findElement(By.css(cardSelector));
              if (anyJobCard) {
                console.log(`Found job card with selector ${cardSelector} directly on page. Using document body as container.`);
                jobListContainerElement = driver; // Use the driver (document root) as the container
                foundDirectCard = true;
                break;
              }
            } catch (e) { } // Ignore if not found
          }

          if (!foundDirectCard) {
            console.error(`Could not find job listings container or any job cards on page ${page}. Structure might have changed or page didn't load correctly.`);
            await takeScreenshot(driver, `page_${page}_no_elements_found.png`);

            // Check for CAPTCHA or "No Results" message
            const pageSource = await driver.getPageSource().catch(() => "");
            if (pageSource.toLowerCase().includes("captcha")) {
                console.error("CAPTCHA detected on results page! Stopping scraper.");
                throw new Error("CAPTCHA challenge detected on results page");
            }
            if (pageSource.includes("No matching jobs found") || pageSource.includes("no jobs found")) {
                console.log("Found 'No results' message. Likely end of search results.");
                break; // Stop scraping pages
            }

            // If it's not the first page, assume end of results
            if (page > 1) {
                console.log("No jobs found on this page, assuming end of results.");
                break;
            } else {
                console.warn("No jobs found on the first page. Check search query/location or website status.");
                // Continue to next page just in case it was a temporary glitch, but log the warning.
            }
          }
        }

        // --- Find Job Cards within the Container ---
        const jobCardSelectors = [
            "article.jobTuple", // Primary card selector
            "div.srp-jobtuple-wrapper", // Wrapper might act as card
            "div.jobTuple", // Legacy
            "div.jobTupleHeader", // Part of a card
            // Avoid overly broad selectors like "div[data-job-id]" here if possible
        ];
        let jobCards = [];
        for (const cardSelector of jobCardSelectors) {
          try {
            // Use safeFindElements which returns [] on error/not found
            const cards = await safeFindElements(jobListContainerElement, By.css(cardSelector));
            if (cards.length > 0) {
              jobCards = cards;
              console.log(`Found ${cards.length} job cards using selector: ${cardSelector}`);
              break; // Use the first selector that yields results
            }
          } catch (e) {
            // safeFindElements handles logging warnings
          }
        }

        console.log(`Processing ${jobCards.length} job cards found on page ${page}.`);

        if (jobCards.length === 0 && page > 1) {
          console.log(`No job cards found on page ${page} after finding container. Assuming end of results.`);
          break; // Stop if no jobs found on subsequent pages
        }
        if (jobCards.length === 0 && page === 1) {
          console.warn(`No job cards found on the first page, even after finding a container. Check selectors or site structure.`);
           // Check for "No Results" message again more specifically
            try {
                const noResultsSelectors = [
                    "div.styles_no-results-container",
                    "div.no-results",
                    "//*[contains(text(), 'No matching jobs found')]",
                    "//*[contains(text(), 'no jobs found')]"
                ];
                let noResultsFound = false;
                for(const nrSelector of noResultsSelectors) {
                    const element = nrSelector.startsWith("//") ? await safeFindElement(driver, By.xpath(nrSelector)) : await safeFindElement(driver, By.css(nrSelector));
                    if(element && await element.isDisplayed()) {
                        console.log("Confirmed 'No results' message found on page 1.");
                        noResultsFound = true;
                        break;
                    }
                }
                if(noResultsFound) break; // Stop if no results on page 1
            } catch(e) {}
        }


        // --- Process Each Job Card ---
        let processedOnPage = 0;
        for (let i = 0; i < jobCards.length; i++) {
          // Check limits before processing each card
          if (
            internalCount >= INTERNAL_JOBS_LIMIT &&
            externalCount >= EXTERNAL_JOBS_LIMIT
          ) {
            console.log("Reached job limits. Skipping remaining cards on this page.");
            break; // Stop processing cards on this page
          }

          const card = jobCards[i];
          let jobTitle = "Not available";
          let jobUrl = null;
          let companyName = "Not available";
          // Use search location as default, try to extract specific later
          let location = LOCATION;
          let experience = "Not specified";
          let salary = "Not disclosed";
          let skills = "Not available";
          let jobDescription = "Not available"; // Will try to get from details page
          let applicationType = "Internal"; // Assume internal unless proven otherwise

          try {
            // Scroll the card into view slightly before interacting
            // Use JS scrollIntoView for reliability
            await driver.executeScript(
              "arguments[0].scrollIntoView({ behavior: 'auto', block: 'center' });",
              card
            );
            await driver.sleep(200); // Brief pause after scroll

            // --- Extract Basic Info from Card ---

            // Job Title & URL (Crucial)
            const titleSelectors = [
              "a.title", // Common
              ".jobTitle.ellipsis", // Specific class sometimes used
              "a.jobTitle", // Another common one
              ".title.ellipsis",
              "a[title]", // Fallback to any link with a title attribute
              "div.title a", // Title within a div
              "div.jobTitle a"
            ];
            let titleElement = null;
            for (const selector of titleSelectors) {
              titleElement = await safeFindElement(card, By.css(selector));
              if (titleElement) {
                jobTitle = await safeGetText(titleElement, jobTitle);
                jobUrl = await safeGetAttribute(titleElement, "href");
                if (jobUrl) break; // Found URL, stop searching
              }
            }

            // --- Duplicate Check ---
            if (!jobUrl) {
              console.warn(`Skipping card ${i + 1} on page ${page}: Could not extract Job URL. Title: ${jobTitle}`);
              continue; // Skip this card if URL is missing
            }
            if (scrapedUrls.has(jobUrl)) {
              console.log(`Skipping duplicate job (URL already seen): ${jobTitle} (${jobUrl.substring(0, 50)}...)`);
              continue; // Skip if URL already processed or in DB
            }

            // If we reach here, it's potentially a new job URL
            console.log(`\nProcessing NEW Job ${i + 1}/${jobCards.length} (Page ${page}): ${jobTitle}`);
            console.log(`  URL: ${jobUrl}`);
            processedOnPage++;


            // Company Name
            const companySelectors = [
              "a.comp-name", "a.companyName", "a.company-name", "div.companyName span",
              "div.comp-name a", "span.comp-name", ".companyInfo.subTitle.ellipsis"
            ];
             for (const selector of companySelectors) {
                const element = await safeFindElement(card, By.css(selector));
                if (element) {
                    companyName = await safeGetText(element, companyName);
                    if (companyName !== "Not available") break;
                }
            }
            console.log(`  Company: ${companyName}`);


            // Location (try to get specific from card, fallback to search location)
            const locationSelectors = [
              "span.locWdth", // Older?
              "span.location", // Common span
              ".location.ellipsis", // Class combination
              "div.loc span", // Span within div.loc
              "span.location-link", // Specific link class
              "div.location span", // Another div structure
              "span[title*='location']", // Span with title attr
              ".new-joblist-location-item" // Newer structure?
            ];
            for (const selector of locationSelectors) {
                const element = await safeFindElement(card, By.css(selector));
                if (element) {
                    const extractedLocation = await safeGetText(element, "");
                    // Use extracted only if it's valid and different from default
                    if (extractedLocation && extractedLocation.toLowerCase() !== "not available") {
                         location = extractedLocation;
                         break;
                    }
                }
            }
            console.log(`  Location: ${location}`);


            // Experience
            const experienceSelectors = [
              "span.expwdth", "span.experience", ".experience.ellipsis",
              "div.exp span", "span.exp-container", "li.experience",
              ".exp > span" // Direct child span of .exp class
            ];
            for (const selector of experienceSelectors) {
                const element = await safeFindElement(card, By.css(selector));
                if (element) {
                    experience = await safeGetText(element, experience);
                     if (experience !== "Not specified") break;
                }
            }
            console.log(`  Experience: ${experience}`);


            // Salary
            const salarySelectors = [
               "span.sal-wrap span", "span.salary", ".salary.ellipsis",
               "div.sal span", "span.salary-container", "span[title*='salary']",
               ".salary > span" // Direct child span of .salary class
            ];
             for (const selector of salarySelectors) {
                const element = await safeFindElement(card, By.css(selector));
                if (element) {
                    salary = await safeGetText(element, salary);
                    if (salary !== "Not disclosed") break;
                }
            }
            console.log(`  Salary: ${salary}`);


            // Skills (from card)
            const skillsSelectors = [
              "ul.tags-gt li", // Older tag list
              "ul.skill-tags li", // Skill tags list
              "div.tag-li span", // Spans within tag divs
              "ul.skills li", // Generic skills list
              "div.skills-section span", // Spans within skills section
              ".chip.skill", // Chip elements for skills
              ".tag-container > span" // Spans in tag container
            ];
            let skillsList = [];
            for (const selector of skillsSelectors) {
                const elements = await safeFindElements(card, By.css(selector));
                if (elements.length > 0) {
                    skillsList = await Promise.all(elements.map(el => safeGetText(el, "")));
                    skillsList = skillsList.filter(Boolean); // Remove empty strings
                    if (skillsList.length > 0) {
                        skills = skillsList.join(", ");
                        break;
                    }
                }
            }
             console.log(`  Skills (from card): ${skills}`);


            // Job Description Snippet (from card)
            const descriptionSelectors = [
                "span.job-desc", "div.job-description", "div.desc",
                "div.jobDescription", "p.job-desc", ".job-description-main"
            ];
            for (const selector of descriptionSelectors) {
                const element = await safeFindElement(card, By.css(selector));
                if (element) {
                    jobDescription = await safeGetText(element, jobDescription);
                    if (jobDescription !== "Not available") break;
                }
            }
            // Don't log snippet here, wait for full description

            // --- Navigate to Job Details Page (in new tab) ---
            let detailedDescription = jobDescription; // Start with snippet
            let detailedSkills = skills; // Start with card skills
            const originalWindow = await driver.getWindowHandle();
            let newWindowHandle = null;

            try {
                console.log("  Opening job details page in new tab...");
                // Open new tab using JavaScript
                await driver.executeScript("window.open(arguments[0], '_blank');", jobUrl);
                await driver.sleep(1000); // Wait for tab to open

                // Find the new window handle
                const allWindows = await driver.getAllWindowHandles();
                newWindowHandle = allWindows.find(handle => handle !== originalWindow);

                if (!newWindowHandle) {
                    throw new Error("Could not find new window handle after opening link.");
                }

                await driver.switchTo().window(newWindowHandle);
                console.log("  Switched to new tab. Waiting for page load...");
                await driver.sleep(LONG_SLEEP_INTERVAL); // Wait for details page to load

                // --- Extract Details from Job Page ---

                // Detailed Description
                const detailDescriptionSelectors = [
                  "div.styles_JDC__dang-inner-html__h0K4t", // Primary modern selector
                  "section.job-desc", // Section element
                  "div.dang-inner-html", // Common class for HTML content
                  "div.JDC__dang-inner-html", // Variation
                  "div.jd-desc", // Job description div
                  "div.description", // Generic description div
                  "div#jobDescription", // ID based
                  "div.job-details-section" // Section container
                ];
                for (const selector of detailDescriptionSelectors) {
                    try {
                        // Wait briefly for the element
                        const descElement = await driver.wait(until.elementLocated(By.css(selector)), SHORT_WAIT);
                        if (descElement) {
                            const detailText = await safeGetText(descElement, "");
                            // Use detailed text if it's significantly longer than the snippet
                            if (detailText && detailText.length > detailedDescription.length + 20) {
                                detailedDescription = detailText;
                                console.log("  Found detailed job description on job page.");
                                break;
                            }
                        }
                    } catch (e) { } // Ignore timeout/not found
                }
                jobDescription = detailedDescription; // Update main variable


                // Detailed Skills
                const detailSkillsSelectors = [
                  "div.styles_key-skill__GIPn_ a.styles_chip__7YCfG", // Modern chip links
                  "div.key-skill span", // Spans in key-skill div
                  "div.skills-container a", // Links in skills container
                  "div.keySkills span", // Spans in keySkills div
                  ".styles_chips__vOE84 > span" // Spans within chips container
                ];
                let detailSkillsList = [];
                 for (const selector of detailSkillsSelectors) {
                    try {
                        const skillElements = await driver.wait(until.elementsLocated(By.css(selector)), SHORT_WAIT);
                        if (skillElements.length > 0) {
                            detailSkillsList = await Promise.all(skillElements.map(el => safeGetText(el, "")));
                            detailSkillsList = detailSkillsList.filter(Boolean);
                            if (detailSkillsList.length > skillsList.length) { // Check if we found more skills
                                detailedSkills = detailSkillsList.join(", ");
                                console.log("  Found detailed skills on job page.");
                                break;
                            }
                        }
                    } catch (e) { } // Ignore timeout/not found
                }
                skills = detailedSkills; // Update main variable


                // --- Check Application Type (More Robustly on Details Page) ---
                applicationType = "Internal"; // Reset assumption for details page check
                // 1. Check for specific "Apply on Company Site" buttons
                 try {
                    const externalButtonSelectors = [
                        "#apply-on-company-site-button", // Specific ID
                        ".styles_company-site-button__C_2YK", // Specific class
                        ".company-site-button", // Generic class
                        "button[data-action='apply-external']", // Data attribute
                        "a.ext-apply-btn", // External apply link class
                        // XPath for button containing specific text (case-insensitive)
                        "//button[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'apply on company')]",
                        "//a[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), 'apply on company')]"
                    ];

                    for (const selector of externalButtonSelectors) {
                        let elements = [];
                        try {
                            if (selector.startsWith("//")) {
                                elements = await driver.findElements(By.xpath(selector));
                            } else {
                                elements = await driver.findElements(By.css(selector));
                            }

                            for (const btn of elements) {
                                if (await btn.isDisplayed()) {
                                    applicationType = "External";
                                    console.log(`  → External application detected (Button selector: ${selector})`);
                                    break; // Found external button
                                }
                            }
                        } catch (e) { /* Ignore selector not found */ }
                        if (applicationType === "External") break; // Stop checking if found
                    }
                } catch (e) {
                    console.warn(`Error checking for external apply buttons: ${e.message}`);
                }

                // 2. Check if the standard "Apply" button is missing (might indicate external)
                if (applicationType === "Internal") {
                    try {
                        const applyButtonSelectors = [
                            "button#apply-button",
                            "button.btn-apply",
                            "button.apply-button",
                            "//button[normalize-space()='Apply']"
                        ];
                        let applyButtonFound = false;
                         for (const selector of applyButtonSelectors) {
                            let element = null;
                            try {
                                if(selector.startsWith("//")) {
                                    element = await driver.findElement(By.xpath(selector));
                                } else {
                                    element = await driver.findElement(By.css(selector));
                                }
                                if(element && await element.isDisplayed()) {
                                    applyButtonFound = true;
                                    break;
                                }
                            } catch(e) {} // Ignore not found
                         }
                         if (!applyButtonFound) {
                             // If no standard apply button, but we didn't find an explicit external one,
                             // it's ambiguous. Keep as Internal for now, but log warning.
                             console.warn("  Could not find standard 'Apply' button, but no explicit 'External Apply' button either. Assuming Internal (ambiguous).");
                         }
                    } catch (e) {
                         console.warn(`Error checking for standard apply button: ${e.message}`);
                    }
                }

                console.log(`  Final Application Type: ${applicationType}`);

            } catch (detailError) {
              console.error(
                `  Error scraping details for ${jobTitle}: ${detailError.message}`
              );
              if (detailError instanceof WebDriverError.TimeoutError) {
                jobDescription = "Details page did not load correctly or structure changed.";
              } else if (detailError.message.includes("no such window")) {
                  console.error("  Browser window closed unexpectedly during detail scraping.");
                  // No need to close tab if it's already gone
                  newWindowHandle = null; // Mark handle as invalid
              }
              await takeScreenshot(driver, `detail_error_${sanitizedQuery}_${i}.png`);
            } finally {
              // Close the details tab and switch back, only if the handle is valid
              if (newWindowHandle) {
                  try {
                      await driver.close();
                  } catch (closeError) {
                      console.warn(`  Warning: Could not close job detail tab: ${closeError.message}`);
                  }
              }
              // Always switch back to the original window
              try {
                  await driver.switchTo().window(originalWindow);
              } catch (switchError) {
                  console.error(`  FATAL: Could not switch back to original window: ${switchError.message}. Aborting page processing.`);
                  // This might indicate a crashed driver, re-throwing might be appropriate
                  // Or attempt to re-initialize driver in the outer catch block
                  throw new Error("Failed to switch back to main window");
              }
              await driver.sleep(500); // Pause after switching back
            }

            // --- Prepare Job Data for Saving ---
            const jobData = {
              "Job Title": jobTitle,
              "Company Name": companyName,
              "Location": location, // Use the determined location
              "Experience Required": experience,
              "Salary": salary,
              "Application Type": applicationType, // Use the determined type
              "Job URL": jobUrl,
              "Scraped Date": new Date(), // Use Date object for MongoDB
              "Skills": skills || "Not available", // Ensure fallback
              "Job Description": jobDescription || "Not available", // Ensure fallback
              "Search Query": JOB_SEARCH_QUERY, // Add search context
              "Search Location": LOCATION, // Add search context
              "Search Experience": EXPERIENCE, // Add search context
              // Add lastUpdated later during bulk write
            };

            // --- Add Job to Save List (based on type and limit) ---
            let addedToList = false;
            if (
              applicationType === "Internal" &&
              internalCount < INTERNAL_JOBS_LIMIT
            ) {
              jobsToSave.push(jobData);
              scrapedUrls.add(jobUrl); // Mark URL as scraped *only when adding*
              internalCount++;
              newJobsCount++;
              addedToList = true;
              console.log(
                `  Added INTERNAL job (${internalCount}/${INTERNAL_JOBS_LIMIT}) to save list: ${jobTitle}`
              );
            } else if (
              applicationType === "External" &&
              externalCount < EXTERNAL_JOBS_LIMIT
            ) {
              jobsToSave.push(jobData);
              scrapedUrls.add(jobUrl); // Mark URL as scraped *only when adding*
              externalCount++;
              newJobsCount++;
              addedToList = true;
              console.log(
                `  Added EXTERNAL job (${externalCount}/${EXTERNAL_JOBS_LIMIT}) to save list: ${jobTitle}`
              );
            }

            if (!addedToList) {
                 // Log why it wasn't added (unless it was a duplicate, already logged)
                 if (!scrapedUrls.has(jobUrl)) { // Avoid logging again if it was a duplicate skip
                     console.log(
                        `  Skipping storing job ${jobTitle} - Limits reached for type ${applicationType} (Internal: ${internalCount}/${INTERNAL_JOBS_LIMIT}, External: ${externalCount}/${EXTERNAL_JOBS_LIMIT}).`
                     );
                 }
            }

          } catch (cardError) {
            console.error(
              `Error processing job card ${i + 1} on page ${page}: ${cardError.message}`
            );
            console.error(cardError.stack); // Log stack for card errors
            // Attempt to recover by continuing to the next card
            if (
              cardError instanceof WebDriverError.StaleElementReferenceError
            ) {
              console.warn(
                "  Encountered stale element processing card, trying to continue to next card."
              );
              // Re-fetch job cards for the current page if staleness is frequent
              // console.log("  Re-fetching job cards due to stale element...");
              // jobCards = await safeFindElements(jobListContainerElement, By.css(primaryCardSelector)); // Use the determined primary selector
              // i = -1; // Reset loop counter (use carefully)
            } else if (cardError.message.includes("Failed to switch back")) {
                // If switching back failed, break the inner loop for this page
                console.error("  Aborting processing for this page due to window switch failure.");
                break;
            }
             await takeScreenshot(driver, `card_error_${sanitizedQuery}_${page}_${i}.png`);
          }
          await driver.sleep(300 + Math.random() * 400); // Small random delay between processing cards
        } // --- End of job card loop ---

        console.log(`Finished processing ${processedOnPage} new job cards on page ${page}.`);

      } catch (pageError) {
        console.error(`Error processing page ${page}: ${pageError.message}`);
        console.error(pageError.stack); // Log stack trace for page errors

        if (pageError instanceof WebDriverError.TimeoutError) {
          console.error(
            "  Timeout waiting for elements on page. Check selectors, network speed, or if page structure changed."
          );
        } else if (
          pageError.message.includes("session") ||
          pageError.message.includes("crashed") ||
          pageError.message.includes("disconnected") ||
          pageError.message.includes("target closed")
        ) {
          console.error(
            "Session lost or browser crashed! Attempting to reinitialize..."
          );
          // Try to quit existing driver cleanly
          if (driver) {
            try { await driver.quit(); } catch (qErr) { console.warn("Error quitting old driver:", qErr.message); }
            driver = null; // Ensure driver is nullified
          }
          // Re-initialize
          try {
            driver = await initializeDriver();
            // Re-login might be necessary here if cookies aren't sufficient
            console.log("Reinitialized driver. Attempting to re-login...");
            isLoggedIn = await loginToNaukri(driver, EMAIL, PASSWORD);
             if (isLoggedIn) {
                await saveCookies(driver);
                console.log("Re-login successful after reinitialization.");
             } else {
                 console.warn("Re-login failed after reinitialization. Continuing without login.");
             }
            console.log("Continuing scrape from the *next* page.");
            page++; // Increment page to avoid retrying the same failed page immediately
            continue; // Skip to the next iteration of the while loop
          } catch (reinitError) {
            console.error(
              `FATAL: Failed to reinitialize driver after crash: ${reinitError.message}`
            );
            throw reinitError; // Propagate fatal error
          }
        } else if (pageError.message.includes("CAPTCHA")) {
            console.error("CAPTCHA detected during page processing. Stopping scraper.");
            break; // Stop the outer loop
        }

        await takeScreenshot(driver, `page_${page}_general_error_screenshot.png`);
        // Optional: break or continue based on error type
        // break; // Stop scraping if a page error is critical
      }

      // Move to the next page
      page++;
      // Wait a bit longer between pages
      await driver.sleep(SLEEP_INTERVAL + Math.random() * 1000);
    } // --- End of page loop ---

    // --- Save Results ---
    console.log(`\n=== SCRAPING SUMMARY ===`);
    console.log(`Internal jobs collected (new): ${internalCount}`);
    console.log(`External jobs collected (new): ${externalCount}`);
    console.log(`Total new unique jobs collected: ${newJobsCount}`);
    console.log(`Total unique job URLs tracked (DB + session): ${scrapedUrls.size}`);

    if (jobsToSave.length > 0) {
      console.log(`\nAttempting to save ${jobsToSave.length} new jobs to MongoDB...`);

      // Create operations for bulk write (upsert based on Job URL)
      const operations = jobsToSave.map(job => {
        return {
          updateOne: {
            filter: { "Job URL": job["Job URL"] }, // Use URL as the unique key
            update: {
              $set: {
                ...job, // Spread all collected job data
                lastUpdated: new Date() // Set/update the last updated timestamp
              },
              $setOnInsert: { // Fields to set only when inserting a new document
                  firstScraped: new Date()
              }
            },
            upsert: true // Insert if not found, update if found
          }
        };
      });

      // Execute bulk write operations
      try {
          const result = await jobsCollection.bulkWrite(operations, { ordered: false }); // ordered:false allows other ops to proceed if one fails
          console.log(`MongoDB Bulk Write Results:`);
          console.log(`  - Matched (existing updated): ${result.matchedCount}`);
          console.log(`  - Upserted (newly inserted): ${result.upsertedCount}`);
          // console.log(`  - Modified (actually changed): ${result.modifiedCount}`); // modifiedCount might be less than matchedCount if data didn't change
          console.log(`  - Total documents affected: ${result.matchedCount + result.upsertedCount}`);
          if (result.hasWriteErrors()) {
              console.warn("Some errors occurred during MongoDB bulk write:");
              result.getWriteErrors().forEach(err => {
                  console.warn(`  - Index ${err.index}: Code ${err.code}, Message: ${err.errmsg}`);
              });
          } else {
              console.log("MongoDB bulk write completed successfully.");
          }
      } catch (dbError) {
          console.error(`FATAL error during MongoDB bulk write: ${dbError.message}`);
          console.error(dbError.stack);
          // Still try to save JSON backup
      }


      // Also save the *newly collected* jobs to JSON file for backup
      try {
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsToSave, null, 2));
          console.log(`Backup of ${jobsToSave.length} new jobs saved to ${OUTPUT_FILE}`);
      } catch(jsonError) {
           console.error(`Error saving JSON backup file (${OUTPUT_FILE}): ${jsonError.message}`);
      }

    } else {
      console.log("No new jobs were collected in this run to save.");
    }

    return newJobsCount; // Return the count of *new* jobs added

  } catch (error) {
    console.error(`\n--- FATAL SCRAPER ERROR ---`);
    console.error(`Error: ${error.message}`);
    console.error(error.stack); // Print stack trace for better debugging

    // Attempt to save any partially collected data before exit
    if (jobsToSave.length > 0) {
      console.warn(
        `Attempting to save ${jobsToSave.length} partially collected new jobs before exit...`
      );
      // Try saving to JSON first as it's less likely to fail
       try {
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(jobsToSave, null, 2));
          console.warn(`Partial JSON backup saved to ${OUTPUT_FILE}`);
      } catch(jsonError) {
           console.error(`Failed to save partial JSON backup: ${jsonError.message}`);
      }
      // Then try saving to MongoDB if connection exists
      if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
          try {
              const db = mongoClient.db(DB_NAME);
              const jobsCollection = db.collection(COLLECTION_NAME);
              const operations = jobsToSave.map(job => ({
                  updateOne: {
                      filter: { "Job URL": job["Job URL"] },
                      update: { $set: { ...job, lastUpdated: new Date() }, $setOnInsert: { firstScraped: new Date() } },
                      upsert: true
                  }
              }));
              await jobsCollection.bulkWrite(operations, { ordered: false });
              console.warn(`Saved ${jobsToSave.length} partial results to MongoDB.`);
          } catch (saveError) {
              console.error(`Failed to save partial data to MongoDB: ${saveError.message}`);
          }
      }
    }
    return newJobsCount; // Return count even on error
  } finally {
    // --- Cleanup ---
    // Close WebDriver
    if (driver) {
      try {
        console.log("\nClosing WebDriver...");
        await driver.quit();
        console.log("WebDriver closed successfully.");
      } catch (e) {
        console.error("Error closing WebDriver:", e.message);
      }
    }

    // Close MongoDB connection
    if (mongoClient) {
      try {
        await mongoClient.close();
        console.log("MongoDB connection closed.");
      } catch (e) {
        console.error("Error closing MongoDB connection:", e.message);
      }
    }

    // Close log stream
    if (logStream) {
        logStream.end(() => {
            // Use original console log here as redirected one might be closed
            // originalConsoleLog("Log stream closed.");
        });
    }
  }
}

// --- Execute Scraper ---
// Use original console log for initial messages before redirection starts
const initialTimestamp = new Date().toISOString();
process.stdout.write(`[${initialTimestamp}] [INFO] Starting Naukri Scraper Script...\n`);
process.stdout.write(`[${initialTimestamp}] [INFO] Query: "${JOB_SEARCH_QUERY}", Location: "${LOCATION}", Experience: "${EXPERIENCE}"\n`);
process.stdout.write(`[${initialTimestamp}] [INFO] Log file: ${LOG_FILE}\n`);

scrapeNaukriJobs()
  .then((jobCount) => {
    console.log(`\nScraping process finished!`);
    console.log(`Collected and saved ${jobCount} new jobs.`);
    process.exit(0); // Exit with success code
  })
  .catch((err) => {
    console.error(`\n--- SCRIPT EXECUTION FAILED ---`);
    console.error(`Error: ${err.message}`);
    // Stack trace is usually logged within the function's catch block
    process.exit(1); // Exit with error code
  });
