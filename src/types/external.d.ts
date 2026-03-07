// Custom type declarations for external libraries that don't have official types

declare module "@inquirer/prompts" {
  export function checkbox<T = string>(message: string, choices: {
    checked?: boolean;
    disabled?: boolean | string;
    name: string;
    value: T;
  }[], options?: {
    pageSize?: number;
    required?: boolean;
  }): Promise<T[]>;

  export function confirm(message: string, options?: {
    default?: boolean;
  }): Promise<boolean>;

  export function input(message: string, options?: {
    default?: string;
    transform?: (value: string) => string;
    validate?: (value: string) => boolean | string;
  }): Promise<string>;

  export function select<T = string>(message: string, choices: {
    description?: string;
    disabled?: boolean | string;
    name: string;
    value: T;
  }[], options?: {
    loop?: boolean;
    pageSize?: number;
  }): Promise<T>;
}

declare module "better-sqlite3" {
  export interface DatabaseInstance {
    close(): void;
    defaultSafeIntegers(): DatabaseInstance;
    exec(sql: string): DatabaseInstance;
    readonly inTransaction: boolean;
    readonly name: string | undefined;
    open(): void;
    readonly open: boolean;
    prepare(sql: string): Statement;
    transaction<Args extends readonly SqlValue[], Result>(
      fn: (...args: Args) => Result
    ): (...args: Args) => Result;
  }
  export interface Options {
    fileMustExist?: boolean;
    readonly?: boolean;
    timeout?: number;
    verbose?: () => void;
  }

  export type RowObject = Record<string, SqlValue>;

  export type SqlValue = boolean | Buffer | null | number | string;

  export interface Statement {
    all(...params: readonly SqlValue[]): RowObject[];
    bind(...params: readonly SqlValue[]): Statement;
    readonly database: DatabaseInstance;
    finalize(): Statement;
    get(...params: readonly SqlValue[]): RowObject | undefined;
    readonly readonly: boolean;
    run(...params: readonly SqlValue[]): { changes: number; lastInsertRowid: number; };
    readonly source: string;
  }

  export default class Database implements DatabaseInstance {
    readonly inTransaction: boolean;
    readonly name: string | undefined;
    readonly open: boolean;
    constructor(filename: string, options?: Options);
    close(): void;
    defaultSafeIntegers(): this;
    exec(sql: string): this;
    open(): void;
    prepare(sql: string): Statement;
    transaction<Args extends readonly SqlValue[], Result>(
      fn: (...args: Args) => Result
    ): (...args: Args) => Result;
  }
}