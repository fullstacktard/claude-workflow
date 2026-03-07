// Type declarations for @inquirer/prompts
declare module "@inquirer/prompts" {
  export interface InquirerTheme {
    prefix?: string;
    spinner?: {
      frames?: string[];
      interval?: number;
    };
    style?: {
      answer?: (text: string) => string;
      error?: (text: string) => string;
      help?: (text: string) => string;
      highlight?: (text: string) => string;
      key?: (text: string) => string;
      message?: (text: string) => string;
    };
  }

  export function select<T = string>(options: {
    choices: {
      description?: string;
      disabled?: boolean | string;
      name: string;
      value: T;
    }[];
    loop?: boolean;
    message: string;
    pageSize?: number;
    theme?: InquirerTheme;
  }): Promise<T>;

  export function input(options: {
    default?: string;
    message: string;
    theme?: InquirerTheme;
    transform?: (input: string) => string;
    validate?: (input: string) => boolean | string;
  }): Promise<string>;

  export function confirm(options: {
    default?: boolean;
    message: string;
    theme?: InquirerTheme;
  }): Promise<boolean>;

  export function checkbox<T = string>(options: {
    choices: {
      checked?: boolean;
      disabled?: boolean | string;
      name: string;
      value: T;
    }[];
    message: string;
    pageSize?: number;
    required?: boolean;
    theme?: InquirerTheme;
  }): Promise<T[]>;

  export function password(options: {
    mask?: string;
    message: string;
    theme?: InquirerTheme;
    validate?: (input: string) => boolean | string;
  }): Promise<string>;
}