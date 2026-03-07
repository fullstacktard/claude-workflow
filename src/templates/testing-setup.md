# Testing Setup & Configuration

## Framework: Vitest

This project uses Vitest for testing - a fast, ESM-native test runner built for modern JavaScript projects.

## Running Quality Checks

**MANDATORY: Always run ALL quality checks before completing any task:**

```bash
# REQUIRED - Run before marking ANY task complete:
npm test           # All tests MUST pass
npm run lint       # No lint errors allowed
npm run lint:fix   # Fix auto-fixable issues first
npm run typecheck  # No type errors (for TypeScript projects)

# Optional during development:
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
npm test -- user.test  # Run tests matching a pattern
```

**Quality Check Requirements (ALL MANDATORY):**
1. **npm test** - All tests MUST pass completely
2. **npm run lint** - NO lint errors allowed
3. **npm run lint:fix** - Run first to fix auto-fixable issues
4. **npm run typecheck** - NO type errors (for TypeScript projects)

**NEVER mark a task complete without ALL checks passing!**

## Test File Structure

```
tests/
├── unit/           # Unit tests for individual functions
├── integration/    # Integration tests for multiple components
└── e2e/           # End-to-end tests (if applicable)
```

## Writing Tests

### Basic Test Structure

```javascript
import { describe, it, expect } from 'vitest';
import { functionToTest } from '../src/module.js';

describe('Module Name', () => {
  it('should do something specific', () => {
    const result = functionToTest(input);
    expect(result).toBe(expectedOutput);
  });
});
```

### Common Matchers

```javascript
// Equality
expect(value).toBe(4);                  // Strict equality
expect(value).toEqual({ name: 'John' }); // Deep equality

// Truthiness
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNull();
expect(value).toBeUndefined();

// Numbers
expect(value).toBeGreaterThan(3);
expect(value).toBeLessThanOrEqual(4.5);
expect(value).toBeCloseTo(0.3);

// Strings
expect('team').toMatch(/I/);
expect('Christoph').toContain('stop');

// Arrays
expect(['Alice', 'Bob']).toContain('Alice');
expect(array).toHaveLength(3);

// Exceptions
expect(() => functionThatThrows()).toThrow();
expect(() => functionThatThrows()).toThrow('specific error');
```

### Async Testing

```javascript
// Using async/await
it('should fetch data', async () => {
  const data = await fetchData();
  expect(data).toEqual({ id: 1, name: 'User' });
});

// Using promises
it('should resolve promise', () => {
  return expect(fetchData()).resolves.toEqual({ id: 1 });
});

it('should reject promise', () => {
  return expect(fetchError()).rejects.toThrow('Error message');
});
```

### Mocking

```javascript
import { vi } from 'vitest';

// Mock a module
vi.mock('../src/database', () => ({
  getUser: vi.fn(() => ({ id: 1, name: 'John' }))
}));

// Mock a function
const mockFn = vi.fn();
mockFn.mockReturnValue(42);
mockFn.mockResolvedValue('async value');

// Spy on existing function
const spy = vi.spyOn(object, 'method');
expect(spy).toHaveBeenCalledWith(arg1, arg2);
expect(spy).toHaveBeenCalledTimes(1);
```

## Configuration

The `vitest.config.js` file controls test behavior:

```javascript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      reporter: ['text', 'json', 'html']
    }
  }
});
```

## Best Practices

1. **Test naming** - Use descriptive test names that explain what is being tested
2. **One assertion per test** - Keep tests focused on a single behavior
3. **Setup and teardown** - Use `beforeEach`, `afterEach` for common setup
4. **Mock external dependencies** - Don't make real API calls in unit tests
5. **Test edge cases** - Include tests for error conditions and boundaries

## Coverage Reports

```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html
```

## Debugging Tests

```bash
# Run tests with Node debugger
node --inspect-brk ./node_modules/vitest/vitest.mjs --run

# Use console.log in tests (they will show in output)
it('debug test', () => {
  console.log('Debug value:', someVariable);
  expect(someVariable).toBe(expected);
});
```

## Common Issues

### "Cannot use import statement outside a module"
- Ensure `"type": "module"` is in package.json
- Use `.js` extension in imports

### "Module not found"
- Check relative import paths
- Ensure `.js` extension is included

### Tests timing out
- Increase timeout: `it('slow test', { timeout: 10000 }, async () => {})`
- Check for unresolved promises