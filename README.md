CryptoScraper — Real-time Crypto Info Aggregator
Team: 9

Overview
CryptoScraper is a dynamic web application that scrapes public cryptocurrency data from trusted sources and provides clean, real-time JSON endpoints. It features a modern frontend dashboard and demonstrates web scraping, backend API design, and deployment.

Use Cases
Lightweight crypto price dashboard for hackathons and demos

Aggregates price, 24h change, and market cap from public pages

Learning project for web scraping, backend APIs, and deployment

Features
Scrapes public crypto sites for live:
name, symbol, price, 24h_change, market_cap, source_url, last_updated

Exposes a simple REST API for frontend use

Basic, stylish frontend to display real-time results

Written recommendations for rate-limiting & caching (see README)

Deployable to Render/Railway with minimal setup

Tech Stack
Backend: Python & Flask

Scraping: requests + BeautifulSoup (or Selenium)

Frontend: HTML, CSS, JS

Deployment: Render or Railway (Web Service)

Optional: SQLite/Redis for caching in production

This project is ideal for learning or demoing rapid crypto data aggregation and live dashboard deployment.
