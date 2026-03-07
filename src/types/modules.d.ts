// Custom module declarations for specific libraries and extensions

declare module "vitest/config" {
  export interface CoverageConfig {
    exclude?: string[];
    include?: string[];
    provider?: string;
    reporter?: string[];
    reportsDirectory?: string;
  }

  export interface ProjectConfig {
    extends?: string;
    test?: TestConfig;
  }

  export interface ResolveConfig {
    alias?: Record<string, string>;
    extensions?: string[];
  }

  export interface TestConfig {
    coverage?: CoverageConfig;
    environment?: string;
    exclude?: string[];
    globals?: boolean;
    include?: string[];
    setupFiles?: string | string[];
  }

  export interface UserConfig {
    coverage?: CoverageConfig;
    define?: Record<string, boolean | number | string>;
    resolve?: ResolveConfig;
    test?: TestConfig;
    workspace?: string | string[];
  }

  export function defineConfig(config: UserConfig): UserConfig;
  export function defineWorkspace(config: (ProjectConfig | string)[]): UserConfig;
}

declare module "vitest" {
  export interface Assertion extends Matchers {
    not: Matchers;
  }

  export interface Matchers<R = void> {
    toBe(expected: AnyValue): R;
    toBeFalsy(): R;
    toBeTruthy(): R;
    toContain(expected: AnyValue): R;
    toEqual(expected: AnyValue): R;
    toHaveBeenCalled(): R;
    toHaveBeenCalledWith(...args: AnyValue[]): R;
    toThrow(expected?: RegExp | string): R;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyValue = any;

  export function afterAll(fn: () => Promise<void> | void): void;
  export function afterEach(fn: () => Promise<void> | void): void;
  export function beforeAll(fn: () => Promise<void> | void): void;
  export function beforeEach(fn: () => Promise<void> | void): void;
  export function describe(name: string, fn: () => void): void;
  export function expect(value: AnyValue): Assertion;
  export function it(name: string, fn: () => Promise<void> | void): void;
  export function test(name: string, fn: () => Promise<void> | void): void;
}

declare module "ajv" {
  export interface ErrorObject {
    dataPath: string;
    keyword: string;
    message?: string;
    params: Record<string, JsonValue>;
    schemaPath: string;
    instancePath?: string;
  }

  export interface KeywordDefinition {
    compile?: (schema: JsonValue) => ValidateFunction;
    macro?: (schema: JsonValue) => Schema;
    metaSchema?: Schema;
    type?: string | string[];
    validate?: (schema: JsonValue, data: JsonValue) => boolean;
  }

  export interface Schema {
    $id?: string;
    $ref?: string;
    $schema?: string;
    additionalProperties?: boolean | Schema;
    const?: JsonValue;
    enum?: JsonValue[];
    items?: Schema | Schema[];
    properties?: Record<string, Schema>;
    required?: string[];
    type?: string | string[];
  }

  export interface ValidateFunction {
    (data: JsonValue): boolean;
    errors?: ErrorObject[] | undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JsonValue = any;

  export class Ajv {
    constructor(options?: Record<string, unknown>);
    addKeyword(keyword: string, definition: KeywordDefinition): Ajv;
    addSchema(schema: Schema, key?: string): Ajv;
    compile(schema: Schema): ValidateFunction;
    validate(schema: Schema, data: JsonValue): boolean | Promise<ErrorObject[]>;
  }
  export default Ajv;
}