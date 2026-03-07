/**
 * Custom error classes for configuration management
 */

export class ConfigLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigLockError";
  }
}

export class ConfigNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigNotFoundError";
  }
}

export class ConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigParseError";
  }
}

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export class ConfigWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigWriteError";
  }
}
