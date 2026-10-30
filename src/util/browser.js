import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const MAC_APPS = [
  'Brave Browser.app/Contents/MacOS/Brave Browser',
  'Google Chrome.app/Contents/MacOS/Google Chrome',
  'Chromium.app/Contents/MacOS/Chromium',
  'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
];
const LINUX_BINS = ['brave-browser', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

/** Finds a Chromium-family browser. Order: explicit path, MACHADO93_BROWSER, then well-known locations. */
export function findBrowser(explicit) {
  const candidates = [explicit, process.env.MACHADO93_BROWSER].filter(Boolean);
  if (process.platform === 'darwin') {
    for (const app of MAC_APPS) {
      candidates.push(path.join('/Applications', app), path.join(os.homedir(), 'Applications', app));
    }
  } else if (process.platform === 'linux') {
    for (const bin of LINUX_BINS) {
      try {
        candidates.push(execFileSync('which', [bin], { encoding: 'utf8' }).trim());
      } catch {
        /* not installed */
      }
    }
  }
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

export function findTool(name) {
  const local = path.join(os.homedir(), '.local', 'bin', name);
  if (existsSync(local)) return local;
  try {
    return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}
