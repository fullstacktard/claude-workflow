# Testing Strategy

**Project:** {{PROJECT_NAME}}
**Last Updated:** {{DATE}}

## Table of Contents

- [Test Structure](#test-structure)
- [Unit Testing](#unit-testing)
- [Integration Testing](#integration-testing)
- [E2E Testing](#e2e-testing)
- [Test Data & Mocking](#test-data--mocking)
- [CI Integration](#ci-integration)

---

## Test Structure

### File Organization

**Colocated Tests (Preferred):**

```
src/
├── lib/
│   ├── utils.ts              ← Implementation
│   └── utils.test.ts         ← Test file (colocated)
│
├── components/
│   └── Button/
│       ├── Button.tsx
│       └── Button.test.tsx   ← Test file (colocated)
```

**Integration Tests:**

```
src/
└── __tests__/                ← Cross-cutting tests
    ├── auth-flow.test.ts
    └── user-registration.test.ts
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Run specific file
npm test utils.test.ts

# Run in watch mode
npm test -- --watch

# Run with UI
npm test -- --ui
```

---

## Unit Testing

### Pattern: Pure Function Testing

**When to use:** Testing utility functions and business logic

**Example:**

```typescript
// File: src/lib/utils.ts

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function calculateDiscount(price: number, discountPercent: number): number {
  if (discountPercent < 0 || discountPercent > 100) {
    throw new Error('Discount must be between 0 and 100');
  }
  return price * (1 - discountPercent / 100);
}
```

**Test:**

```typescript
// File: src/lib/utils.test.ts
import { describe, it, expect } from 'vitest';
import { formatCurrency, calculateDiscount } from './utils';

describe('formatCurrency', () => {
  it('formats USD correctly', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });

  it('formats EUR correctly', () => {
    expect(formatCurrency(1234.56, 'EUR')).toBe('€1,234.56');
  });

  it('handles zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});

describe('calculateDiscount', () => {
  it('calculates 10% discount correctly', () => {
    expect(calculateDiscount(100, 10)).toBe(90);
  });

  it('handles 0% discount', () => {
    expect(calculateDiscount(100, 0)).toBe(100);
  });

  it('handles 100% discount', () => {
    expect(calculateDiscount(100, 100)).toBe(0);
  });

  it('throws on invalid discount', () => {
    expect(() => calculateDiscount(100, -10)).toThrow('Discount must be between 0 and 100');
    expect(() => calculateDiscount(100, 150)).toThrow('Discount must be between 0 and 100');
  });
});
```

### Pattern: Testing with Dependencies

**When to use:** Testing classes/functions that depend on external services

**Example:**

```typescript
// File: src/domain/users/create-user.usecase.ts
import { UserRepository } from '../../repositories/user.repository';
import { EmailService } from '../../services/email.service';
import { ValidationError } from '../../lib/errors';

export class CreateUserUseCase {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService
  ) {}

  async execute(data: CreateUserData) {
    // Check if email already exists
    const existing = await this.userRepo.findByEmail(data.email);
    if (existing) {
      throw new ValidationError('Email already in use', 'email');
    }

    // Create user
    const user = await this.userRepo.create(data);

    // Send welcome email
    await this.emailService.sendWelcome(user.email, user.name);

    return user;
  }
}
```

**Test:**

```typescript
// File: src/domain/users/create-user.usecase.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateUserUseCase } from './create-user.usecase';
import { ValidationError } from '../../lib/errors';

describe('CreateUserUseCase', () => {
  let userRepo: any;
  let emailService: any;
  let useCase: CreateUserUseCase;

  beforeEach(() => {
    // Create mocks
    userRepo = {
      findByEmail: vi.fn(),
      create: vi.fn(),
    };
    emailService = {
      sendWelcome: vi.fn(),
    };

    useCase = new CreateUserUseCase(userRepo, emailService);
  });

  it('creates user successfully', async () => {
    // Setup
    const userData = { email: 'test@example.com', name: 'Test User', password: 'pass123' };
    const createdUser = { id: '1', ...userData };

    userRepo.findByEmail.mockResolvedValue(null); // Email not taken
    userRepo.create.mockResolvedValue(createdUser);
    emailService.sendWelcome.mockResolvedValue(undefined);

    // Execute
    const result = await useCase.execute(userData);

    // Assert
    expect(result).toEqual(createdUser);
    expect(userRepo.findByEmail).toHaveBeenCalledWith('test@example.com');
    expect(userRepo.create).toHaveBeenCalledWith(userData);
    expect(emailService.sendWelcome).toHaveBeenCalledWith('test@example.com', 'Test User');
  });

  it('throws error if email already exists', async () => {
    // Setup
    const userData = { email: 'existing@example.com', name: 'Test', password: 'pass' };
    userRepo.findByEmail.mockResolvedValue({ id: '1', email: userData.email });

    // Execute & Assert
    await expect(useCase.execute(userData)).rejects.toThrow(ValidationError);
    await expect(useCase.execute(userData)).rejects.toThrow('Email already in use');

    // Verify create was never called
    expect(userRepo.create).not.toHaveBeenCalled();
  });
});
```

### Pattern: React Component Testing

**Example:**

```typescript
// File: src/components/Button/Button.tsx
import { ReactNode } from 'react';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function Button({ children, onClick, disabled, variant = 'primary' }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant}`}
    >
      {children}
    </button>
  );
}
```

**Test:**

```typescript
// File: src/components/Button/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByText('Click me'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick} disabled>Click me</Button>);

    fireEvent.click(screen.getByText('Click me'));

    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies correct variant class', () => {
    const { rerender } = render(<Button variant="primary">Button</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-primary');

    rerender(<Button variant="secondary">Button</Button>);
    expect(screen.getByRole('button')).toHaveClass('btn-secondary');
  });
});
```

---

## Integration Testing

### Pattern: API Integration Tests

**When to use:** Testing full request/response cycle

**Example:**

```typescript
// File: src/__tests__/auth.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { app } from '../app';
import request from 'supertest';
import { prisma } from '../config/database';

describe('Auth API', () => {
  beforeAll(async () => {
    // Setup test database
    await prisma.$connect();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clear users before each test
    await prisma.user.deleteMany();
  });

  describe('POST /api/auth/register', () => {
    it('registers new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Test User',
        })
        .expect(201);

      expect(response.body.data).toMatchObject({
        email: 'test@example.com',
        name: 'Test User',
      });
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });

    it('returns 400 for invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalid-email',
          password: 'Password123!',
          name: 'Test',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.field).toBe('email');
    });

    it('returns 400 for weak password', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: '123',
          name: 'Test',
        })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.field).toBe('password');
    });

    it('returns 400 if email already exists', async () => {
      // Create user first
      await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'First User',
      });

      // Try to register again with same email
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
          name: 'Second User',
        })
        .expect(400);

      expect(response.body.error.message).toContain('Email already in use');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create test user
      await request(app).post('/api/auth/register').send({
        email: 'test@example.com',
        password: 'Password123!',
        name: 'Test User',
      });
    });

    it('logs in with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'Password123!',
        })
        .expect(200);

      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
    });

    it('returns 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'WrongPassword',
        })
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });

    it('returns 401 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
    });
  });
});
```

---

## E2E Testing

### Pattern: Playwright E2E Tests

**Installation:**

```bash
npm install -D @playwright/test
npx playwright install
```

**Example:**

```typescript
// File: e2e/auth-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('User Authentication Flow', () => {
  test('complete registration and login flow', async ({ page }) => {
    // Navigate to registration page
    await page.goto('http://localhost:3000/register');

    // Fill registration form
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'Password123!');
    await page.fill('[name="name"]', 'Test User');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await expect(page).toHaveURL('http://localhost:3000/dashboard');
    await expect(page.locator('h1')).toContainText('Welcome, Test User');

    // Logout
    await page.click('[data-testid="logout-button"]');

    // Should redirect to home
    await expect(page).toHaveURL('http://localhost:3000');

    // Login with created account
    await page.goto('http://localhost:3000/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Should be back on dashboard
    await expect(page).toHaveURL('http://localhost:3000/dashboard');
  });
});
```

---

## Test Data & Mocking

### Pattern: Factory Functions

**When to use:** Creating test data consistently

**Implementation:**

```typescript
// File: src/__tests__/factories/user.factory.ts

let userIdCounter = 1;

export function createTestUser(overrides?: Partial<User>): User {
  return {
    id: `user-${userIdCounter++}`,
    email: `test${userIdCounter}@example.com`,
    passwordHash: '$2b$12$hashedpassword',
    name: 'Test User',
    role: 'USER',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createAdminUser(): User {
  return createTestUser({ role: 'ADMIN' });
}
```

**Usage:**

```typescript
// File: src/domain/users/get-user.usecase.test.ts
import { createTestUser } from '../../__tests__/factories/user.factory';

describe('GetUserUseCase', () => {
  it('returns user by id', async () => {
    const testUser = createTestUser({ id: '123', name: 'John Doe' });
    userRepo.findById.mockResolvedValue(testUser);

    const result = await useCase.execute('123');

    expect(result).toEqual(testUser);
  });
});
```

### Pattern: Database Seeding

**When to use:** Integration tests needing database state

**Implementation:**

```typescript
// File: src/__tests__/helpers/seed.ts
import { prisma } from '../../config/database';

export async function seedUsers() {
  await prisma.user.createMany({
    data: [
      {
        email: 'admin@example.com',
        passwordHash: '$2b$12$hashedpassword',
        name: 'Admin User',
        role: 'ADMIN',
      },
      {
        email: 'user@example.com',
        passwordHash: '$2b$12$hashedpassword',
        name: 'Regular User',
        role: 'USER',
      },
    ],
  });
}

export async function cleanDatabase() {
  await prisma.user.deleteMany();
  await prisma.order.deleteMany();
  // Delete in reverse dependency order
}
```

**Usage:**

```typescript
// File: src/__tests__/users.test.ts
import { seedUsers, cleanDatabase } from './helpers/seed';

describe('User API', () => {
  beforeEach(async () => {
    await cleanDatabase();
    await seedUsers();
  });

  it('lists users', async () => {
    const response = await request(app).get('/api/users').expect(200);

    expect(response.body.data).toHaveLength(2);
  });
});
```

---

## CI Integration

### GitHub Actions

**Configuration:**

```yaml
# File: .github/workflows/test.yml

name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run database migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/testdb

      - name: Run tests
        run: npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:testpass@localhost:5432/testdb
          JWT_SECRET: test-secret

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

---

## Best Practices

### DO:

✅ Write tests for all business logic
✅ Colocate unit tests with implementation
✅ Use descriptive test names
✅ Test edge cases and error scenarios
✅ Mock external dependencies
✅ Keep tests fast (unit tests < 100ms)
✅ Use factories for test data
✅ Clean up test data after tests

### DON'T:

❌ Test implementation details
❌ Write interdependent tests
❌ Leave tests disabled/skipped
❌ Test framework code (e.g., testing Express itself)
❌ Share mutable state between tests
❌ Make network calls in unit tests
❌ Commit failing tests

---

**Related Documentation:**
- [patterns.md](./patterns.md) - Code patterns to test
- [folder-structure.md](./folder-structure.md) - Where to place tests
- [tech-stack.md](./tech-stack.md) - Testing tools and libraries

**Last Updated:** {{DATE}}
**Version:** {{VERSION}}
