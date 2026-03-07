
import * as fs from "node:fs";
import * as path from "node:path";

interface JSONSchema {
  $schema?: string;
  [key: string]: JSONSchemaValue | undefined;
  additionalProperties?: boolean | JSONSchema;
  definitions?: Record<string, JSONSchema>;
  items?: JSONSchema | JSONSchema[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  type?: string;
}

/**
 * JSON Schema structure
 */
type JSONSchemaValue = boolean | JSONSchema | JSONSchema[] | number | Record<string, JSONSchema> | string | string[];

/**
 * Schema Loader statistics
 */
interface SchemaLoaderStats {
  basePath: string;
  cachedSchemas: number;
}

/**
 * Schema Loader utility for loading and caching JSON schemas
 *
 * Follows clean architecture principles:
 * - Domain: Schema loading and caching logic
 * - Infrastructure: File system operations
 */
class SchemaLoader {
  private basePath: string;
  private cache: Map<string, JSONSchema>;

  constructor() {
    this.cache = new Map();
    this.basePath = path.resolve(".claude/schemas");
  }

  /**
   * Clear cache for specific schema or all schemas
   * @param schemaName - Specific schema to clear, or clear all if not provided
   */
  clearCache(schemaName?: string): void {
    if (schemaName !== undefined && schemaName !== "") {
      this.cache.delete(schemaName);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Close and cleanup resources
   */
  close(): void {
    this.cache.clear();
  }

  /**
   * Get cached schema without loading from disk
   * @param schemaName - Name of schema
   * @returns Cached schema or undefined if not cached
   */
  getCachedSchema(schemaName: string): JSONSchema | undefined {
    return this.cache.get(schemaName);
  }

  /**
   * Get statistics about loaded schemas
   * @returns Statistics object
   */
  getStats(): SchemaLoaderStats {
    return {
      basePath: this.basePath,
      cachedSchemas: this.cache.size
    };
  }

  /**
   * Load schema from file with caching
   * @param schemaName - Name of schema file (without .json extension)
   * @returns Parsed schema object or undefined if not found
   */
  loadSchema(schemaName: string): JSONSchema | undefined {
    const cacheKey = schemaName;

    // Return from cache if available
    const cachedSchema = this.cache.get(cacheKey);
    if (cachedSchema !== undefined) {
      return cachedSchema;
    }

    try {
      const schemaPath = path.join(this.basePath, `${schemaName}.json`);

      if (!fs.existsSync(schemaPath)) {
        console.warn(`Schema file not found: ${schemaPath}`);
        return undefined;
      }

      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      const schema = JSON.parse(schemaContent) as JSONSchema;

      // Cache the parsed schema
      this.cache.set(cacheKey, schema);

      return schema;
    } catch (error) {
      console.error(`Error loading schema ${schemaName}:`, error);
      return undefined;
    }
  }
}

// Export class for external use
export { SchemaLoader };

// Global instance for reuse
const globalSchemaLoader = new SchemaLoader();

export default globalSchemaLoader;
