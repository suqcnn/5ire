/**
 * Script to rebuild native Node.js modules for Electron compatibility
 * Automatically detects dependencies and rebuilds them if necessary
 */

import { execSync } from 'child_process';
import fs from 'fs';
import { dependencies } from '../../release/app/package.json';
import webpackPaths from '../configs/webpack.paths';

/**
 * Check if dependencies exist and node_modules directory is present
 * If both conditions are met, rebuild native modules for Electron
 */
if (
  Object.keys(dependencies || {}).length > 0 &&
  fs.existsSync(webpackPaths.appNodeModulesPath)
) {
  /**
   * Base electron-rebuild command with force flag and all module types
   * @type {string}
   */
  const electronRebuildCmd =
    '../../node_modules/.bin/electron-rebuild --force --types prod,dev,optional --module-dir .';

  /**
   * Platform-specific command with proper path separators
   * Windows uses backslashes, other platforms use forward slashes
   * @type {string}
   */
  const cmd =
    process.platform === 'win32'
      ? electronRebuildCmd.replace(/\//g, '\\')
      : electronRebuildCmd;

  /**
   * Execute the electron-rebuild command synchronously
   * Uses the app path as working directory and inherits stdio for output
   */
  execSync(cmd, {
    cwd: webpackPaths.appPath,
    stdio: 'inherit',
  });
}
