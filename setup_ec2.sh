#!/bin/bash

# Install Chrome dependencies
sudo apt-get update
sudo apt-get install -y unzip xvfb libxi6 libgconf-2-4 default-jdk wget

# Install latest Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt-get install -y ./google-chrome-stable_current_amd64.deb
rm google-chrome-stable_current_amd64.deb

# Install latest ChromeDriver
CHROME_VERSION=$(google-chrome --version | cut -d " " -f3 | cut -d "." -f1)
CHROMEDRIVER_VERSION=$(wget -qO- https://chromedriver.storage.googleapis.com/LATEST_RELEASE_$CHROME_VERSION)
wget https://chromedriver.storage.googleapis.com/$CHROMEDRIVER_VERSION/chromedriver_linux64.zip
unzip chromedriver_linux64.zip
sudo mv chromedriver /usr/bin/chromedriver
sudo chown root:root /usr/bin/chromedriver
sudo chmod +x /usr/bin/chromedriver
rm chromedriver_linux64.zip

# Check installations
echo "Chrome version:"
google-chrome --version
echo "ChromeDriver version:"
chromedriver --version

echo "Setup complete!"
