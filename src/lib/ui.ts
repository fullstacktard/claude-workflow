
// Patch picocolors BEFORE importing clack to override default colors (blue->red, green->red, magenta->red)
import pc from "picocolors";

interface PicocolorsWithOverrides {
  cyan: (str: string) => string;
  green: (str: string) => string;
  magenta: (str: string) => string;
  red: (str: string) => string;
}

const pcOverride = pc as PicocolorsWithOverrides;
pcOverride.cyan = (str: string): string => pc.red(str);
pcOverride.green = (str: string): string => pc.red(str);
pcOverride.magenta = (str: string): string => pc.red(str);

import * as p from "@clack/prompts";

/**
 * PromptTestAgent - Provides programmatic input for testing interactive prompts
 *
 * This is NOT a mock of @clack/prompts. Instead, it provides an alternative input
 * source that the clack wrapper functions check before calling the real @clack functions.
 *
 * Usage in tests:
 * ```typescript
 * const agent = PromptTestAgent.getInstance();
 * agent.queueConfirm(true);
 * agent.queueMultiSelect(['option1', 'option2']);
 * const result = await promptWorkflowConfig();
 * agent.reset();
 * ```
 */
export class PromptTestAgent {
  private static instance: PromptTestAgent | undefined;
  private confirmQueue: boolean[] = [];
  private multiSelectQueue: string[][] = [];
  private textQueue: string[] = [];
  private passwordQueue: string[] = [];
  private selectQueue: unknown[] = [];
  private enabled = false;

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): PromptTestAgent {
    if (PromptTestAgent.instance === undefined) {
      PromptTestAgent.instance = new PromptTestAgent();
    }
    return PromptTestAgent.instance;
  }

  /**
   * Enable the test agent. When enabled, prompts will use queued values.
   */
  public enable(): void {
    this.enabled = true;
  }

  /**
   * Disable the test agent. When disabled, prompts will use normal @clack behavior.
   */
  public disable(): void {
    this.enabled = false;
  }

  /**
   * Check if the test agent is enabled.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Queue a boolean response for the next confirm/yesNo prompt.
   */
  public queueConfirm(value: boolean): void {
    this.confirmQueue.push(value);
  }

  /**
   * Queue multiple boolean responses for multiple confirm/yesNo prompts.
   */
  public queueConfirmMany(...values: boolean[]): void {
    this.confirmQueue.push(...values);
  }

  /**
   * Dequeue and return the next confirm value, or undefined if queue is empty.
   */
  public dequeueConfirm(): boolean | undefined {
    return this.confirmQueue.shift();
  }

  /**
   * Check if there are queued confirm values.
   */
  public hasQueuedConfirm(): boolean {
    return this.confirmQueue.length > 0;
  }

  /**
   * Queue a string array response for the next multiselect prompt.
   */
  public queueMultiSelect<T extends string>(values: T[]): void {
    this.multiSelectQueue.push(values);
  }

  /**
   * Queue multiple multiselect responses for multiple multiselect prompts.
   */
  public queueMultiSelectMany<T extends string>(...values: T[][]): void {
    this.multiSelectQueue.push(...values);
  }

  /**
   * Dequeue and return the next multiselect value, or undefined if queue is empty.
   */
  public dequeueMultiSelect<T extends string>(): T[] | undefined {
    return this.multiSelectQueue.shift() as T[] | undefined;
  }

  /**
   * Check if there are queued multiselect values.
   */
  public hasQueuedMultiSelect(): boolean {
    return this.multiSelectQueue.length > 0;
  }

  /**
   * Queue a text response for the next text prompt.
   */
  public queueText(value: string): void {
    this.textQueue.push(value);
  }

  /**
   * Queue multiple text responses for multiple text prompts.
   */
  public queueTextMany(...values: string[]): void {
    this.textQueue.push(...values);
  }

  /**
   * Dequeue and return the next text value, or undefined if queue is empty.
   */
  public dequeueText(): string | undefined {
    return this.textQueue.shift();
  }

  /**
   * Check if there are queued text values.
   */
  public hasQueuedText(): boolean {
    return this.textQueue.length > 0;
  }

  /**
   * Queue a password response for the next password prompt.
   */
  public queuePassword(value: string): void {
    this.passwordQueue.push(value);
  }

  /**
   * Dequeue and return the next password value, or undefined if queue is empty.
   */
  public dequeuePassword(): string | undefined {
    return this.passwordQueue.shift();
  }

  /**
   * Check if there are queued password values.
   */
  public hasQueuedPassword(): boolean {
    return this.passwordQueue.length > 0;
  }

  /**
   * Queue a value for the next select prompt.
   */
  public queueSelect<T>(value: T): void {
    this.selectQueue.push(value);
  }

  /**
   * Queue multiple values for multiple select prompts.
   */
  public queueSelectMany<T>(...values: T[]): void {
    this.selectQueue.push(...values);
  }

  /**
   * Dequeue and return the next select value, or undefined if queue is empty.
   */
  public dequeueSelect<T>(): T | undefined {
    return this.selectQueue.shift() as T | undefined;
  }

  /**
   * Check if there are queued select values.
   */
  public hasQueuedSelect(): boolean {
    return this.selectQueue.length > 0;
  }

  /**
   * Reset all queues and disable the agent.
   * Call this in afterEach() to ensure clean state between tests.
   */
  public reset(): void {
    this.confirmQueue = [];
    this.multiSelectQueue = [];
    this.textQueue = [];
    this.passwordQueue = [];
    this.selectQueue = [];
    this.enabled = false;
  }

  /**
   * Get queue sizes for debugging.
   */
  public getQueueSizes(): { confirm: number; multiSelect: number; password: number; select: number; text: number } {
    return {
      confirm: this.confirmQueue.length,
      multiSelect: this.multiSelectQueue.length,
      password: this.passwordQueue.length,
      select: this.selectQueue.length,
      text: this.textQueue.length
    };
  }
}
import boxen from "boxen";
import chalk from "chalk";
import cliProgress from "cli-progress";
import figlet from "figlet";
import gradient from "gradient-string";
import * as readline from "node:readline";
import ora from "ora";

// Beautiful gradient themes - fst.wtf inspired
type GradientFn = ReturnType<typeof gradient>;
export const successGradient: GradientFn = gradient(["#10b981", "#34d399"]); // Green
const infoGradient: GradientFn = gradient(["#dc2626", "#ef4444"]); // Red accent

interface ClackMultiSelectOption<T extends string> {
  hint?: string;
  label: string;
  value: T;
}

// Multi-select prompt for inquirer
type InquirerAnswers = Record<string, boolean | number | string | string[] | undefined>;

interface InquirerChoice {
  checked?: boolean;
  disabled?: boolean;
  name: string;
  value: string;
}

interface MockSpinner {
  fail: () => void;
  info: () => void;
  start: () => void;
  stop: () => void;
  succeed: () => void;
  text: string;
  warn: () => void;
}

interface ProgressBar {
  bar: typeof cliProgress.SingleBar.prototype;
  increment: () => void;
  start: (total: number) => void;
  stop: () => void;
}

type Spinner = MockSpinner | ReturnType<typeof ora>;

export function clackIntro(message: string): void {
  p.intro(message);
}

export async function clackMultiSelect<T extends string>(
  message: string,
  options: ClackMultiSelectOption<T>[],
  initialValues?: T[]
): Promise<T[]> {
  // Check if PromptTestAgent has queued values
  const agent = PromptTestAgent.getInstance();
  if (agent.isEnabled() && agent.hasQueuedMultiSelect()) {
    const queuedValue = agent.dequeueMultiSelect<T>();
    if (queuedValue !== undefined) {
      return queuedValue;
    }
  }

  // If stdin is not a TTY (e.g., in tests or CI), return initial values or empty array
  if (!process.stdin.isTTY) {
    console.log(`${message} (non-interactive, using defaults)`);
    return initialValues ?? [];
  }

  // ClackMultiSelectOption is structurally compatible with @clack/prompts Option<T>
  // Use type assertion to bypass incompatible type definitions
  const result = await p.multiselect({
    ...(initialValues !== undefined && { initialValues }),
    message,
     
    options: options as any,
    required: false
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result;
}

export function clackNote(message: string, title?: string): void {
  p.note(message, title);
}

// Beautiful header with ASCII art

export function clackOutro(message: string): void {
  p.outro(message);
}

export async function clackPassword(message: string): Promise<string> {
  // Check if PromptTestAgent has queued values
  const agent = PromptTestAgent.getInstance();
  if (agent.isEnabled() && agent.hasQueuedPassword()) {
    const queuedValue = agent.dequeuePassword();
    if (queuedValue !== undefined) {
      return queuedValue;
    }
  }

  // If stdin is not a TTY (e.g., in tests or CI), return empty string
  if (!process.stdin.isTTY) {
    console.log(`${message} (non-interactive, cannot read password)`);
    return "";
  }

  const result = await p.password({
    message
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result;
}

interface ClackSelectOption<T> {
  hint?: string;
  label: string;
  value: T;
}

/**
 * Single-selection prompt using @clack/prompts select().
 * Supports CI mode (returns defaultValue or first option), PromptTestAgent queued values,
 * and Ctrl+C cancellation.
 */
export async function clackSelect<T>(
  message: string,
  options: ClackSelectOption<T>[],
  defaultValue?: T
): Promise<T> {
  // Check if PromptTestAgent has queued values
  const agent = PromptTestAgent.getInstance();
  if (agent.isEnabled() && agent.hasQueuedSelect()) {
    const queuedValue = agent.dequeueSelect<T>();
    if (queuedValue !== undefined) {
      return queuedValue;
    }
  }

  // If stdin is not a TTY (e.g., in tests or CI), return default value or first option
  if (!process.stdin.isTTY) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- options array is guaranteed non-empty by callers
    const fallback: T = defaultValue ?? options[0]!.value;
    console.log(`${message} (non-interactive, using default: ${String(fallback)})`);
    return fallback;
  }

  const result = await p.select({
    ...(defaultValue !== undefined && { initialValue: defaultValue }),
    message,
    options: options as any
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result as T;
}

export async function clackText(message: string, placeholder?: string, defaultValue?: string): Promise<string> {
  // Check if PromptTestAgent has queued values
  const agent = PromptTestAgent.getInstance();
  if (agent.isEnabled() && agent.hasQueuedText()) {
    const queuedValue = agent.dequeueText();
    if (queuedValue !== undefined) {
      return queuedValue;
    }
  }

  // If stdin is not a TTY (e.g., in tests or CI), return default value
  if (!process.stdin.isTTY) {
    console.log(`${message} (non-interactive, using default: ${defaultValue ?? ""})`);
    return defaultValue ?? "";
  }

  const result = await p.text({
    ...(defaultValue !== undefined && { defaultValue }),
    message,
    ...(placeholder !== undefined && { placeholder })
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result;
}

// Clack prompt wrappers with cancellation handling
export async function clackYesNo(message: string, defaultValue = true): Promise<boolean> {
  // Check if PromptTestAgent has queued values
  const agent = PromptTestAgent.getInstance();
  if (agent.isEnabled() && agent.hasQueuedConfirm()) {
    const queuedValue = agent.dequeueConfirm();
    if (queuedValue !== undefined) {
      return queuedValue;
    }
  }

  // If stdin is not a TTY (e.g., in tests or CI), return default value
  if (!process.stdin.isTTY) {
    console.log(`${message} (non-interactive, using default: ${defaultValue ? "yes" : "no"})`);
    return defaultValue;
  }

  const result = await p.confirm({
    initialValue: defaultValue,
    message
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled");
    process.exit(0);
  }

  return result;
}

/**
 * Grouped prompt sequence using @clack/prompts group().
 * Chains multiple prompts sequentially, passing prior results to each.
 * Supports CI mode (returns empty object) and centralized Ctrl+C cancellation.
 *
 * Note: PromptTestAgent integration happens at the individual prompt level --
 * use clackText, clackSelect, etc. inside the group for full agent support.
 */
export async function clackGroup<T>(
  prompts: Record<string, (opts: { results: Record<string, unknown> }) => Promise<unknown> | undefined>
): Promise<T> {
  // If stdin is not a TTY (e.g., in tests or CI), return empty object
  if (!process.stdin.isTTY) {
    console.log("(non-interactive, skipping grouped prompts)");
    return {} as T;
  }

  const result = await p.group(
    prompts as any,
    {
      onCancel: () => {
        p.cancel("Operation cancelled");
        process.exit(0);
      }
    }
  );

  return result as T;
}

interface ClackSpinnerInstance {
  message: (msg: string) => void;
  start: (msg?: string) => void;
  stop: (msg?: string) => void;
}

/**
 * Spinner using @clack/prompts spinner().
 * Returns no-op functions in CI/test mode (same detection as createSpinner).
 * Only one spinner can be active at a time.
 */
export function clackSpinner(): ClackSpinnerInstance {
  const isCI = process.env.CI === "true" || process.env.NODE_ENV === "test" || process.env.SUPPRESS_SPINNER === "true";

  if (isCI || !process.stdin.isTTY) {
    // Return no-op spinner in CI/test mode (same pattern as createSpinner)
    return {
      message: (): void => {
        // No-op in CI mode
      },
      start: (): void => {
        // No-op in CI mode
      },
      stop: (): void => {
        // No-op in CI mode
      }
    };
  }

  const s = p.spinner();
  return {
    message: (msg: string): void => {
      s.message(msg);
    },
    start: (msg?: string): void => {
      s.start(msg);
    },
    stop: (msg?: string): void => {
      s.stop(msg);
    }
  };
}

// Progress bar for file operations
export function createProgressBar(title: string): ProgressBar {
  const bar = new cliProgress.SingleBar(
    {
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      format:
        chalk.red("{title}") +
        " |" +
        chalk.red("{bar}") +
        "| {percentage}% | {value}/{total} Files",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic
  );

  return {
    bar,
    increment: (): void => { bar.increment(); },
    start: (total: number): void => { bar.start(total, 0, { title }); },
    stop: (): void => { bar.stop(); },
  };
}

// Beautiful spinner with custom text (ora-style interface)
export function createSpinner(text: string, type?: string): Spinner {
  // Check if running in test environment or spinners should be suppressed

  const isTest = process.env.NODE_ENV === "test" || process.env.CI === "true" || process.env.SUPPRESS_SPINNER === "true";

  if (isTest) {
    // Return a mock spinner that doesn't output anything
    const mockSpinner: MockSpinner = {
      fail: (): void => {
        // No-op in test mode
      },
      info: (): void => {
        // No-op in test mode
      },
      start: (): void => {
        // No-op in test mode
      },
      stop: (): void => {
        // No-op in test mode
      },
      succeed: (): void => {
        // No-op in test mode
      },
      text,
      warn: (): void => {
        // No-op in test mode
      },
    };
    return mockSpinner;
  }

  const options: Parameters<typeof ora>[0] = {
    color: "red",
    text: chalk.red(text),
  };

  if (type !== undefined) {
    (options as { spinner?: string }).spinner = type;
  }

  const spinner = ora(options);
  return spinner;
}

// Interactive prompt with beautiful styling
export async function prompt(question: string, defaultValue = ""): Promise<string> {
  // If stdin is not a TTY (e.g., in tests or CI), return default value

  if (!process.stdin.isTTY) {

    console.log(`${question}${defaultValue}`);
    return defaultValue;
  }

  const rl = readline.createInterface({

    input: process.stdin,

    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    const formattedQuestion = chalk.red.bold("> ") + chalk.white(question);
    rl.question(formattedQuestion, (answer: string) => {
      rl.close();
      const finalAnswer = answer === "" ? defaultValue : answer;
      resolve(finalAnswer);
    });
  });
}

const INDEX_OFFSET = 1;

export async function promptMultiSelect(message: string, choices: InquirerChoice[]): Promise<string[]> {
  // Import inquirer dynamically to avoid issues in test environments
  try {
    const inquirer = await import("inquirer");
    const answers = await inquirer.default.prompt([
      {
        choices,
        message,
        name: "selected",
        type: "checkbox"
      }
    ]) as InquirerAnswers;
    const selected = answers.selected;
    return Array.isArray(selected) ? selected : [];
  } catch {
    // Fallback for environments without inquirer
    console.log(chalk.red(message));
    for (const [index, choice] of choices.entries()) {
      console.log(`${String(index + INDEX_OFFSET)}. ${choice.name}`);
    }
    return [];
  }
}

// Number prompt with validation
export async function promptNumber(
  message: string,
  defaultValue = 0,
  min?: number,
  max?: number
): Promise<number> {
  if (!process.stdin.isTTY) {
    return defaultValue;
  }

  try {
    const inquirer = await import("inquirer");
    const answers = await inquirer.default.prompt([
      {
        default: defaultValue,
        message: chalk.red("> ") + chalk.white(message),
        name: "value",
        type: "number",
        validate: (input: number): boolean | string => {
          if (Number.isNaN(input)) {
            return "Please enter a valid number";
          }
          if (min !== undefined && input < min) {
            return `Value must be at least ${String(min)}`;
          }
          if (max !== undefined && input > max) {
            return `Value must be at most ${String(max)}`;
          }
          return true;
        }
      }
    ]) as InquirerAnswers;
    const value = answers.value;
    return typeof value === "number" ? value : defaultValue;
  } catch {
    console.error(chalk.red("Failed to show number prompt"));
    return defaultValue;
  }
}

const PAGE_SIZE = 10;

// Single-select prompt for inquirer
export async function promptSelect(
  message: string,
  choices: { description?: string; name: string; value: string; }[]
): Promise<string> {
  if (!process.stdin.isTTY) {
    return choices[0]?.value ?? "";
  }

  try {
    const inquirer = await import("inquirer");
    const answers = await inquirer.default.prompt([
      {
        choices: choices.map(c => ({
          name: c.name,
          short: c.name,
          value: c.value
        })),
        message: chalk.red("> ") + chalk.white(message),
        name: "selected",
        pageSize: PAGE_SIZE,
        type: "list"
      }
    ]) as InquirerAnswers;
    const selected = answers.selected;
    return typeof selected === "string" ? selected : (choices[0]?.value ?? "");
  } catch {
    console.error(chalk.red("Failed to show selection prompt"));
    return choices[0]?.value ?? "";
  }
}

// Yes/No prompt with replacement
export async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  // If stdin is not a TTY (e.g., in tests or CI), return default value

  if (!process.stdin.isTTY) {
    return defaultYes;
  }

  const rl = readline.createInterface({

    input: process.stdin,

    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    const suffix = defaultYes ? " (Y/n): " : " (y/N): ";
    const promptText = chalk.red("> ") + chalk.white(question) + chalk.gray(suffix);

    rl.question(promptText, (answer: string) => {
      rl.close();

      const normalizedAnswer = answer.trim().toLowerCase();
      if (normalizedAnswer === "") {
        resolve(defaultYes);
      } else {
        resolve(normalizedAnswer === "y" || normalizedAnswer === "yes");
      }
    });
  });
}

const BOX_MARGIN = 1;
const BOX_PADDING = 1;

// Beautiful box for important messages
export function showBox(title: string, content: string, type = "info"): void {
  const boxOptions: import("boxen").Options = {
    borderColor:
      type === "success" ? "green" : (type === "error" ? "red" : "red"),
    borderStyle: "round",
    margin: BOX_MARGIN,
    padding: BOX_PADDING,
    title,
    titleAlignment: "center",
  };

  console.log(boxen(content, boxOptions));
}

export function showError(message: string): void {

  console.log(chalk.red.bold(`✗ ${message}`));
}

const HEADER_WIDTH = 80;

type FigletCallback = (err: Error | null, data?: string) => void;

export async function showHeader(): Promise<void> {
  return new Promise<void>((resolve) => {
    const callback: FigletCallback = (err: Error | null, data?: string): void => {
      if (err === null && data !== undefined && data !== "") {
        console.log("");
        console.log(chalk.hex("#dc2626")(data));
        console.log(chalk.white("Intelligent Claude code workflow management by @fullstacktard"));
      }

      resolve();
    };

    void figlet(
      "FST Claude",
      {
        font: "ANSI Shadow",
        horizontalLayout: "fitted",
        verticalLayout: "default",
        whitespaceBreak: true,
        width: HEADER_WIDTH,
      },
      callback
    );
  });
}

export function showInfo(message: string): void {

  console.log(chalk.white(message));
}

const SECTION_SEPARATOR_LENGTH = 50;

// Beautiful section headers
export function showSection(title: string): void {

  console.log("\n" + chalk.bold(infoGradient(`▸ ${title}`)));

  console.log(chalk.dim("═".repeat(SECTION_SEPARATOR_LENGTH)));
}

export function showStep(message: string): void {
  console.log(chalk.blue.bold(`▶ ${message}`));
}

// Animated success/error messages
export function showSuccess(message: string): void {

  console.log(chalk.green.bold(`✓ ${message}`));
}

export function showWarning(message: string): void {

  console.log(chalk.yellow.bold(`! ${message}`));
}