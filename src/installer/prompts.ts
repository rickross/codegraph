/**
 * User prompts for the CodeGraph installer
 * Uses built-in readline to avoid ESM issues with inquirer
 */

import * as readline from 'readline';
import { chalk } from './banner';

export type InstallLocation = 'global' | 'local';

/**
 * Create a readline interface for prompts
 */
function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Prompt the user with a question and return their answer
 */
function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * Prompt for installation location (global or local)
 */
export async function promptInstallLocation(): Promise<InstallLocation> {
  const rl = createInterface();

  console.log(chalk.bold('  Where would you like to install?'));
  console.log();
  console.log('  1) Global (~/.claude) - available in all projects');
  console.log('  2) Local (./.claude) - this project only');
  console.log();

  const answer = await prompt(rl, '  Choice [1]: ');
  rl.close();

  // Default to '1' if empty, parse the answer
  const choice = answer === '' ? '1' : answer;

  if (choice === '2') {
    return 'local';
  }
  return 'global';
}

/**
 * Prompt for auto-allow permissions
 */
export async function promptAutoAllow(): Promise<boolean> {
  const rl = createInterface();

  console.log();
  console.log(chalk.bold('  Auto-allow CodeGraph commands?') + chalk.dim(' (Skips permission prompts)'));
  console.log();
  console.log('  1) Yes - auto-approve all CodeGraph MCP tools');
  console.log('  2) No - ask for permission each time');
  console.log();

  const answer = await prompt(rl, '  Choice [1]: ');
  rl.close();

  // Default to '1' if empty
  const choice = answer === '' ? '1' : answer;

  return choice !== '2';
}

/**
 * Prompt for confirmation (yes/no)
 */
export async function promptConfirm(message: string, defaultYes: boolean = true): Promise<boolean> {
  const rl = createInterface();

  const defaultStr = defaultYes ? 'Y/n' : 'y/N';
  const answer = await prompt(rl, `  ${message} [${defaultStr}]: `);
  rl.close();

  if (answer === '') {
    return defaultYes;
  }

  return answer.toLowerCase().startsWith('y');
}
