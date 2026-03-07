declare module "js-yaml" {
  export class YAMLException extends Error {
    mark?: {
      column: number;
      line: number;
    };
  }

  export interface Schema {
    readonly name: string;
  }

  export const JSON_SCHEMA: Schema;

  export interface LoadOptions {
    filename?: string;
    schema?: Schema;
  }

  export interface DumpOptions {
    forceQuotes?: boolean;
    indent?: number;
    lineWidth?: number;
    noCompatMode?: boolean;
    noRefs?: boolean;
    quotingType?: "'" | "\"";
    schema?: Schema;
    sortKeys?: ((a: string, b: string) => number) | boolean;
  }

  export type YamlValue = boolean | null | number | string | undefined | YamlArray | YamlObject;
  export type YamlArray = YamlValue[];
  export interface YamlObject { [key: string]: YamlValue }

  export function load(
    str: string,
    options?: LoadOptions
  ): YamlObject | YamlValue;

  export function dump(obj: object, options?: DumpOptions): string;
}
