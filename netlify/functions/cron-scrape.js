import { handler as scrapeHandler } from './scrape.js';

// Called by Netlify Scheduled Functions (see netlify.toml)
export const handler = async () => {
  return await scrapeHandler();
};