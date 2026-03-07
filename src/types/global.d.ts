/// <reference types="node" />

// Global Node.js type declarations for this project
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
      NODE_ENV?: string;
      TYPESCRIPT?: string;
    }

    interface Timeout {
      ref(): this;
      unref(): this;
    }
  }
}

// Custom module declarations for libraries that don't have built-in types

declare module "chokidar" {
  interface FSWatcher {
    add(path: string | string[]): this;
    close(): void;
    getWatched(): Record<string, string[]>;
    on(event: "all", listener: (event: string, path: string) => void): this;
    on(
      event: "add" | "addDir" | "change" | "unlink" | "unlinkDir",
      listener: (path: string) => void
    ): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "ready", listener: () => void): this;
    on(
      event: "raw",
      listener: (event: string, path: string, details: RawEventDetails) => void
    ): this;
    unwatch(path: string | string[]): this;
  }

  interface RawEventDetails {
    changes?: {
      access?: boolean;
      finder?: boolean;
      inode?: boolean;
      xattrs?: boolean;
    };
    event?: string;
    type?: string;
  }

  interface WatchOptions {
    alwaysStat?: boolean;
    atomic?: boolean | number;
    awaitWriteFinish?:
      | boolean
      | {
          pollInterval?: number;
          stabilityThreshold?: number;
        };
    binaryInterval?: number;
    cwd?: string;
    depth?: number;
    disableGlobbing?: boolean;
    followSymlinks?: boolean;
    ignored?: ((path: string) => boolean) | RegExp | string;
    ignoreInitial?: boolean;
    ignorePermissionErrors?: boolean;
    interval?: number;
    persistent?: boolean;
    usePolling?: boolean;
  }

  function watch(
    paths: string | string[],
    options?: WatchOptions
  ): FSWatcher;

  export { FSWatcher, RawEventDetails, watch, WatchOptions };
}

