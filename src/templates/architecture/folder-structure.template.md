# Folder Structure

**Project:** {{PROJECT_NAME}}
**Last Updated:** {{DATE}}

## Table of Contents

- [/src Enforcement Rule](#src-enforcement-rule)
- [Project Root Structure](#project-root-structure)
- [Module Organization](#module-organization)
- [Test File Placement](#test-file-placement)
- [Code Examples](#code-examples)

---

## /src Enforcement Rule

### CRITICAL: All Application Code in /src

**Rule:** All application code MUST be placed inside the `/src` folder.

**Why This Rule Exists:**
- **Clear separation** between configuration and application code
- **Easier tooling configuration** (TypeScript, ESLint, bundlers all look in `/src`)
- **Better IDE support** (IntelliSense, imports, refactoring)
- **Consistent structure** across all projects
- **Simplified build processes** - tools know exactly where to find source code

### What's Allowed at Project Root

**✅ Configuration Files:**
```
/
├── package.json              ← Dependencies and scripts
├── tsconfig.json             ← TypeScript configuration
├── vitest.config.ts          ← Test configuration
├── eslint.config.ts          ← Linting rules
├── .env                      ← Environment variables
├── .env.example              ← Example environment variables
├── README.md                 ← Project documentation
```

**✅ Documentation & Management:**
```
/
├── /docs                     ← Architecture documentation
├── /backlog                  ← Task management (if using claude-workflow)
```

**✅ Build Artifacts (Gitignored):**
```
/
├── /node_modules             ← Dependencies
├── /dist                     ← Build output
├── /build                    ← Alternative build output
├── /coverage                 ← Test coverage reports
```

### What's NOT Allowed at Project Root

**❌ Application Code:**
```
❌ /utils.ts                  → Move to /src/lib/utils.ts
❌ /helpers.js                → Move to /src/lib/helpers.js
❌ /components/Button.tsx     → Move to /src/components/Button.tsx
❌ /api/users.ts              → Move to /src/api/users.ts
❌ /models/User.ts            → Move to /src/models/User.ts
```

**❌ Test Files at Root:**
```
❌ /utils.test.ts             → Move to /src/lib/utils.test.ts (colocated)
❌ /tests/unit/               → Move to /src/__tests__/unit/
```

### Enforcement Check

If you're unsure whether your file placement is correct, run:

```bash
# Check for code files outside /src (should return nothing)
find . -maxdepth 1 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" \) \
  ! -name "*.config.*" \
  ! -name "*config.ts" \
  ! -name "*config.js"

# If this returns files, they should be moved to /src
```

---

## Project Root Structure

### Standard Layout

```
{{PROJECT_NAME}}/
├── .claude/                  ← Claude Code configuration
│   ├── agents/               ← AI agent definitions
│   ├── hooks/                ← Workflow hooks
│   └── skills/               ← Reusable skills
│
├── docs/                     ← Architecture documentation
│   └── architecture/         ← This documentation
│       ├── README.md
│       ├── folder-structure.md
│       ├── patterns.md
│       ├── data-model.md
│       ├── tech-stack.md
│       ├── testing.md
│       └── decisions/        ← ADRs
│
├── backlog/                  ← Task management (optional)
│   ├── tasks/                ← Active tasks
│   ├── completed/            ← Completed tasks
│   └── specs/                ← Feature specifications
│
├── src/                      ← APPLICATION CODE GOES HERE
│   ├── index.ts              ← Entry point
│   ├── config/               ← Runtime configuration
│   ├── lib/                  ← Shared utilities
│   ├── types/                ← TypeScript type definitions
│   └── __tests__/            ← Cross-cutting tests
│
├── node_modules/             ← Dependencies (gitignored)
├── dist/                     ← Build output (gitignored)
│
├── package.json              ← Project configuration
├── tsconfig.json             ← TypeScript config
├── vitest.config.ts          ← Test config
├── eslint.config.ts          ← Linting config
└── README.md                 ← Project readme
```

---

## Module Organization

### /src Internal Structure

{{MODULE_STRUCTURE}}

**Example for Backend API:**

```
src/
├── index.ts                  ← Application entry point
├── app.ts                    ← Express/Fastify app setup
│
├── config/                   ← Runtime configuration
│   ├── index.ts              ← Config aggregator
│   ├── database.ts           ← Database connection config
│   ├── auth.ts               ← Authentication config
│   └── logger.ts             ← Logging configuration
│
├── api/                      ← API layer (controllers)
│   ├── routes/               ← Route definitions
│   │   ├── index.ts
│   │   ├── auth.routes.ts
│   │   └── users.routes.ts
│   │
│   └── controllers/          ← Request handlers
│       ├── auth.controller.ts
│       └── users.controller.ts
│
├── domain/                   ← Business logic (use cases)
│   ├── auth/
│   │   ├── login.usecase.ts
│   │   └── register.usecase.ts
│   │
│   └── users/
│       ├── get-user.usecase.ts
│       └── update-user.usecase.ts
│
├── models/                   ← Data models and entities
│   ├── User.ts
│   ├── Session.ts
│   └── index.ts
│
├── repositories/             ← Data access layer
│   ├── user.repository.ts
│   └── session.repository.ts
│
├── middleware/               ← Express/Fastify middleware
│   ├── authenticate.ts
│   ├── validate.ts
│   └── error-handler.ts
│
├── lib/                      ← Shared utilities
│   ├── logger.ts
│   ├── jwt.ts
│   └── validation.ts
│
├── types/                    ← TypeScript types
│   ├── index.ts
│   ├── auth.types.ts
│   └── user.types.ts
│
└── __tests__/                ← Integration tests
    ├── auth.test.ts
    └── users.test.ts
```

**Example for Frontend (React):**

```
src/
├── index.tsx                 ← Application entry point
├── App.tsx                   ← Root component
│
├── pages/                    ← Page components (routes)
│   ├── HomePage.tsx
│   ├── LoginPage.tsx
│   └── DashboardPage.tsx
│
├── components/               ← Reusable UI components
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx   ← Colocated test
│   │   └── Button.module.css
│   │
│   └── Form/
│       ├── Input.tsx
│       └── Input.test.tsx
│
├── hooks/                    ← Custom React hooks
│   ├── useAuth.ts
│   ├── useAuth.test.ts       ← Colocated test
│   └── useFetch.ts
│
├── services/                 ← API clients and external services
│   ├── api.ts                ← Base API client
│   ├── auth.service.ts
│   └── users.service.ts
│
├── store/                    ← State management (Redux/Zustand)
│   ├── index.ts
│   ├── auth.slice.ts
│   └── users.slice.ts
│
├── lib/                      ← Shared utilities
│   ├── formatting.ts
│   └── validation.ts
│
├── types/                    ← TypeScript types
│   ├── index.ts
│   ├── auth.types.ts
│   └── user.types.ts
│
├── styles/                   ← Global styles
│   ├── globals.css
│   └── variables.css
│
└── __tests__/                ← Integration tests
    └── auth-flow.test.tsx
```

### Module Boundaries

{{MODULE_BOUNDARIES}}

**Dependency Rules (Clean Architecture):**

```
Outer layers can depend on inner layers, but NOT vice versa:

┌─────────────────────────────────────┐
│   API Layer (Controllers)          │  ← Depends on Domain
│   - Request/Response handling       │
└─────────────────────────────────────┘
            ↓ depends on
┌─────────────────────────────────────┐
│   Domain Layer (Use Cases)         │  ← Depends on Models
│   - Business logic                  │  ← Independent of infrastructure
└─────────────────────────────────────┘
            ↓ depends on
┌─────────────────────────────────────┐
│   Models (Entities)                │  ← No dependencies
│   - Pure data structures            │
└─────────────────────────────────────┘
            ↑ used by
┌─────────────────────────────────────┐
│   Infrastructure (Repositories)    │  ← Implements interfaces
│   - Database, APIs, File system    │  ← Depends on Models
└─────────────────────────────────────┘
```

**Example Violation (❌ Don't do this):**

```typescript
// ❌ BAD: Model depends on repository (wrong direction)
// File: src/models/User.ts
import { UserRepository } from '../repositories/user.repository';

export class User {
  async save() {
    const repo = new UserRepository(); // ❌ Models shouldn't know about repositories
    return repo.save(this);
  }
}
```

**Example Correct (✅ Do this):**

```typescript
// ✅ GOOD: Repository depends on model (correct direction)
// File: src/repositories/user.repository.ts
import { User } from '../models/User';

export class UserRepository {
  async save(user: User): Promise<User> {
    // Implementation
  }
}

// File: src/domain/users/create-user.usecase.ts
import { User } from '../../models/User';
import { UserRepository } from '../../repositories/user.repository';

export class CreateUserUseCase {
  constructor(private userRepo: UserRepository) {}

  async execute(data: CreateUserInput): Promise<User> {
    const user = new User(data);
    return this.userRepo.save(user);
  }
}
```

---

## Test File Placement

### Colocated Tests (Preferred)

**Pattern:** Place test files next to the code they test

```
src/
├── lib/
│   ├── utils.ts              ← Implementation
│   ├── utils.test.ts         ← Test (colocated)
│   ├── jwt.ts
│   └── jwt.test.ts
│
├── components/
│   ├── Button/
│   │   ├── Button.tsx        ← Component
│   │   └── Button.test.tsx   ← Test (colocated)
│   └── Form/
│       ├── Input.tsx
│       └── Input.test.tsx
```

**Why colocated tests?**
- Easy to find tests for any file
- Tests move with the code during refactoring
- Clear what's tested and what's not
- Enforces one test file per implementation file

### Integration Tests

**Pattern:** Use `__tests__` directories for cross-cutting tests

```
src/
├── __tests__/                ← Integration tests
│   ├── auth-flow.test.ts     ← Tests multiple modules
│   └── user-registration.test.ts
│
└── api/
    └── __tests__/            ← API integration tests
        └── users-api.test.ts
```

**When to use `__tests__/`:**
- Tests that span multiple modules
- End-to-end tests
- Integration tests that set up complex scenarios
- Tests that need shared fixtures or setup

### Test Naming Convention

```typescript
// Unit tests (colocated)
src/lib/utils.ts          → src/lib/utils.test.ts
src/hooks/useAuth.ts      → src/hooks/useAuth.test.ts

// Integration tests
src/__tests__/auth-flow.test.ts
src/api/__tests__/users-api.test.ts
```

---

## Code Examples

### Example 1: Adding a New Feature (Backend)

**Scenario:** Add password reset functionality

**Step 1: Create domain use case**
```typescript
// File: src/domain/auth/reset-password.usecase.ts
import { UserRepository } from '../../repositories/user.repository';
import { EmailService } from '../../services/email.service';
import { generateResetToken } from '../../lib/token';

export class ResetPasswordUseCase {
  constructor(
    private userRepo: UserRepository,
    private emailService: EmailService
  ) {}

  async execute(email: string): Promise<void> {
    const user = await this.userRepo.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists (security)
      return;
    }

    const token = generateResetToken();
    await this.userRepo.saveResetToken(user.id, token);
    await this.emailService.sendResetEmail(user.email, token);
  }
}
```

**Step 2: Create API controller**
```typescript
// File: src/api/controllers/auth.controller.ts
import { Request, Response } from 'express';
import { ResetPasswordUseCase } from '../../domain/auth/reset-password.usecase';

export class AuthController {
  constructor(private resetPasswordUseCase: ResetPasswordUseCase) {}

  async requestPasswordReset(req: Request, res: Response) {
    const { email } = req.body;

    await this.resetPasswordUseCase.execute(email);

    res.status(200).json({
      message: 'If the email exists, a reset link has been sent'
    });
  }
}
```

**Step 3: Add route**
```typescript
// File: src/api/routes/auth.routes.ts
import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { validateEmail } from '../../middleware/validate';

export function createAuthRoutes(controller: AuthController): Router {
  const router = Router();

  router.post('/reset-password',
    validateEmail,
    (req, res) => controller.requestPasswordReset(req, res)
  );

  return router;
}
```

**Step 4: Add colocated tests**
```typescript
// File: src/domain/auth/reset-password.usecase.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ResetPasswordUseCase } from './reset-password.usecase';

describe('ResetPasswordUseCase', () => {
  it('sends reset email for valid user', async () => {
    const userRepo = {
      findByEmail: vi.fn().mockResolvedValue({ id: 1, email: 'test@example.com' }),
      saveResetToken: vi.fn()
    };
    const emailService = { sendResetEmail: vi.fn() };

    const useCase = new ResetPasswordUseCase(userRepo, emailService);
    await useCase.execute('test@example.com');

    expect(emailService.sendResetEmail).toHaveBeenCalled();
  });
});
```

### Example 2: Adding a New Component (Frontend)

**Scenario:** Add a modal component

**Step 1: Create component with colocated test**
```typescript
// File: src/components/Modal/Modal.tsx
import { ReactNode } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add colocated test**
```typescript
// File: src/components/Modal/Modal.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';

describe('Modal', () => {
  it('renders when open', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test">
        Content
      </Modal>
    );

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('calls onClose when overlay clicked', () => {
    const handleClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={handleClose} title="Test">
        Content
      </Modal>
    );

    fireEvent.click(screen.getByText('Test').closest('.overlay'));
    expect(handleClose).toHaveBeenCalled();
  });
});
```

**Step 3: Add styles**
```css
/* File: src/components/Modal/Modal.module.css */
.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  max-height: 90vh;
  overflow: auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #eee;
}

.content {
  padding: 1rem;
}
```

### Example 3: Monorepo Project Structure

**For monorepos with multiple projects:**

```
monorepo-root/
├── packages/
│   ├── web/                  ← Frontend project
│   │   ├── src/              ← All web code in /src
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api/                  ← Backend project
│   │   ├── src/              ← All API code in /src
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/               ← Shared library
│       ├── src/              ← All shared code in /src
│       ├── package.json
│       └── tsconfig.json
│
├── docs/                     ← Root architecture docs
│   ├── architecture/         ← Shared architecture
│   ├── web/                  ← Web-specific docs
│   │   └── architecture/
│   └── api/                  ← API-specific docs
│       └── architecture/
│
├── package.json              ← Root package.json (workspaces)
└── tsconfig.base.json        ← Shared TypeScript config
```

Each project follows the /src enforcement rule independently.

---

## Summary

### Key Takeaways

1. **All application code goes in `/src`** - No exceptions
2. **Tests are colocated** with the code they test (`.test.ts` suffix)
3. **Integration tests** use `__tests__/` directories
4. **Configuration files** stay at project root
5. **Follow clean architecture** - dependencies flow inward
6. **Module boundaries** are clear and enforced

### Common Mistakes to Avoid

❌ Putting code files at project root
❌ Creating `/tests` directory at root for unit tests
❌ Mixing concerns (domain logic in controllers)
❌ Wrong dependency directions (models depending on repositories)
❌ Deeply nested directory structures (keep it flat when possible)

### When in Doubt

Ask yourself:
1. **Is this application code?** → Goes in `/src`
2. **Is this configuration?** → Stays at root
3. **Is this a test?** → Colocate it with the code
4. **Is this documentation?** → Goes in `/docs`

---

**Related Documentation:**
- [patterns.md](./patterns.md) - Implementation patterns and conventions
- [testing.md](./testing.md) - Testing strategies and examples
- [README.md](./README.md) - Documentation index

**Last Updated:** {{DATE}}
**Version:** {{VERSION}}
