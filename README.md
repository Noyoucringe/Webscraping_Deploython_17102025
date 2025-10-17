CryptoScraper — Real-time Crypto Info Aggregator

Project: CryptoScraper
team:9

 Project Overview

CryptoScraper is a dynamic web application that scrapes public cryptocurrency data from trusted sources and serves cleaned, easy-to-consume JSON to the frontend. The app demonstrates web scraping, backend APIs, and a simple frontend to display live crypto information.

Use cases

Lightweight crypto price dashboard for hackathon demos

Aggregating price / 24h change / market cap from multiple public pages (demo only)

Learning project for web scraping + deployment

Features

Scrapes public crypto pages (example: coin listing pages) to extract:

name, symbol, price, 24h_change, market_cap, source_url, last_updated

Simple REST endpoint to fetch scraped data

Basic frontend to display results

Rate-limiting & caching recommendations (included in README)

Deployable to Render (or similar services)

 Tech Stack

Backend: Python + Flask

Scraping: requests + BeautifulSoup (or Selenium if needed for JS-heavy pages)

Frontend: HTML, CSS, JavaScript (templates)

Deployment: Render (Web Service) or Railway

Optional: SQLite / Redis for caching (recommended for production)
