import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PROJECT_ROOT } from '../storage.mjs';
export function launchBrowser() {
  const bundled = path.join(PROJECT_ROOT, '.test-data/browsers/chromium-1248/chrome-win64/chrome.exe');
  return chromium.launch({
    headless: true,
    executablePath: process.env.REASONCONTOUR_CHROMIUM || (existsSync(bundled) ? bundled : undefined)
  });
}
