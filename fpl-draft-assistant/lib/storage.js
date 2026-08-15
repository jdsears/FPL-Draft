// Where things that must survive live.
//
// The container's own disk is wiped on every deploy, so anything written there
// is a cache at best. When a Railway volume is attached, Railway announces its
// mount path in RAILWAY_VOLUME_MOUNT_PATH, and everything here moves onto it
// and becomes permanent. Without one, the same code runs against the app
// directory and the sync layer's repopulate-from-devices behaviour covers the
// gap. DATA_DIR overrides both, for anyone running this elsewhere.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DURABLE = Boolean(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH);

export function storageInfo() {
  return { dir: DIR, durable: DURABLE };
}

export function readJson(name, fallback = null) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8"));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(name, value) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
