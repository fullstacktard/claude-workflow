# Technology Stack

**Project:** {{PROJECT_NAME}}
**Last Updated:** {{DATE}}

## Table of Contents

- [Backend](#backend)
- [Frontend](#frontend)
- [Database & Caching](#database--caching)
- [Infrastructure & DevOps](#infrastructure--devops)
- [Development Tools](#development-tools)
- [Testing](#testing)

---

## Backend

{{BACKEND_TECHNOLOGIES}}

**Example:**

### Node.js Runtime

**Version:** `20.x LTS`
**Purpose:** JavaScript runtime for server-side code

**Why chosen:**
- Large ecosystem (npm packages)
- TypeScript support
- Async I/O model for concurrent requests
- Active LTS support

### NestJS Framework

**Version:** `^10.0.0`
**Purpose:** Backend framework for building scalable server applications

**Installation:**

```bash
npm install @nestjs/core @nestjs/common @nestjs/platform-express
```

**Basic Usage:**

```typescript
// File: src/app.module.ts
import { Module } from '@nestjs/common';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';

@Module({
  imports: [UserModule, AuthModule],
})
export class AppModule {}

// File: src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
```

**Why chosen:**
- TypeScript-first framework
- Built-in dependency injection
- Opinionated structure (scales well)
- Strong ecosystem (Passport, TypeORM, etc.)

**Key Patterns:**

```typescript
// Controller
@Controller('users')
export class UserController {
  constructor(private userService: UserService) {}

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.userService.findById(id);
  }
}

// Service
@Injectable()
export class UserService {
  constructor(private userRepo: UserRepository) {}

  async findById(id: string) {
    return this.userRepo.findById(id);
  }
}
```

### Express.js (Alternative)

**Version:** `^4.18.0`
**Purpose:** Minimalist web framework

**Installation:**

```bash
npm install express @types/express
```

**Basic Usage:**

```typescript
// File: src/app.ts
import express from 'express';
import { userRoutes } from './api/routes/user.routes';
import { errorHandler } from './middleware/error-handler';

const app = express();

app.use(express.json());
app.use('/api/users', userRoutes);
app.use(errorHandler);

export { app };
```

---

## Frontend

{{FRONTEND_TECHNOLOGIES}}

**Example:**

### React

**Version:** `^18.2.0`
**Purpose:** UI library for building interactive interfaces

**Installation:**

```bash
npm install react react-dom
npm install -D @types/react @types/react-dom
```

**Basic Usage:**

```typescript
// File: src/App.tsx
import { useState } from 'react';
import { UserList } from './components/UserList';

export function App() {
  const [users, setUsers] = useState([]);

  return (
    <div>
      <h1>User Management</h1>
      <UserList users={users} />
    </div>
  );
}
```

**Why chosen:**
- Component-based architecture
- Large ecosystem (React Router, React Query, etc.)
- Server-side rendering support (Next.js)
- Strong TypeScript support

### TanStack Query (React Query)

**Version:** `^5.0.0`
**Purpose:** Data fetching and state management

**Installation:**

```bash
npm install @tanstack/react-query
```

**Basic Usage:**

```typescript
// File: src/hooks/useUsers.ts
import { useQuery } from '@tanstack/react-query';
import { userService } from '../services/user.service';

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => userService.getAll(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// File: src/components/UserList.tsx
import { useUsers } from '../hooks/useUsers';

export function UserList() {
  const { data: users, isLoading, error } = useUsers();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading users</div>;

  return (
    <ul>
      {users.map((user) => (
        <li key={user.id}>{user.name}</li>
      ))}
    </ul>
  );
}
```

**Why chosen:**
- Automatic caching and refetching
- Optimistic updates support
- TypeScript-first API
- DevTools for debugging

---

## Database & Caching

{{DATABASE_TECHNOLOGIES}}

**Example:**

### PostgreSQL

**Version:** `15.x`
**Purpose:** Primary relational database

**Why chosen:**
- ACID compliance
- JSON support (jsonb type)
- Advanced indexing (GIN, GiST)
- Full-text search
- Reliable replication

**Connection:**

```typescript
// File: src/config/database.ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
```

### Prisma ORM

**Version:** `^5.0.0`
**Purpose:** Type-safe database access

**Installation:**

```bash
npm install prisma @prisma/client
npx prisma init
```

**Schema Example:**

```prisma
// File: prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("users")
}
```

**Usage:**

```typescript
// File: src/repositories/user.repository.ts
import { prisma } from '../config/database';

export class UserRepository {
  async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
    });
  }

  async create(data: CreateUserData) {
    return await prisma.user.create({
      data,
    });
  }
}
```

### Redis

**Version:** `7.x`
**Purpose:** Caching and session storage

**Installation:**

```bash
npm install ioredis
npm install -D @types/ioredis
```

**Basic Usage:**

```typescript
// File: src/config/redis.ts
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
});

// File: src/lib/cache.ts
import { redis } from '../config/redis';

export async function getCached<T>(key: string): Promise<T | null> {
  const cached = await redis.get(key);
  return cached ? JSON.parse(cached) : null;
}

export async function setCache(key: string, value: any, ttl: number = 3600) {
  await redis.setex(key, ttl, JSON.stringify(value));
}

// Usage in service
export class UserService {
  async findById(id: string) {
    // Check cache first
    const cached = await getCached<User>(`user:${id}`);
    if (cached) return cached;

    // Fetch from database
    const user = await this.userRepo.findById(id);
    if (user) {
      await setCache(`user:${id}`, user, 600); // Cache for 10 minutes
    }

    return user;
  }
}
```

---

## Infrastructure & DevOps

{{INFRASTRUCTURE_TECHNOLOGIES}}

**Example:**

### Docker

**Version:** Latest stable
**Purpose:** Containerization for consistent environments

**Dockerfile Example:**

```dockerfile
# File: Dockerfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**Docker Compose Example:**

```yaml
# File: docker-compose.yml

version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
      - REDIS_HOST=redis
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### GitHub Actions

**Purpose:** CI/CD automation

**Workflow Example:**

```yaml
# File: .github/workflows/ci.yml

name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run linter
        run: npm run lint

      - name: Build
        run: npm run build
```

---

## Development Tools

### TypeScript

**Version:** `^5.0.0`
**Purpose:** Type safety and better developer experience

**Configuration:**

```json
// File: tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### ESLint

**Version:** `^9.0.0`
**Purpose:** Code linting and style enforcement

**Installation:**

```bash
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin
```

**Configuration:**

```typescript
// File: eslint.config.ts
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
];
```

---

## Testing

### Vitest

**Version:** `^2.0.0`
**Purpose:** Unit and integration testing

**Installation:**

```bash
npm install -D vitest @vitest/ui
```

**Configuration:**

```typescript
// File: vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

**Usage:**

```typescript
// File: src/lib/utils.test.ts
import { describe, it, expect } from 'vitest';
import { formatEmail } from './utils';

describe('formatEmail', () => {
  it('converts email to lowercase', () => {
    expect(formatEmail('USER@EXAMPLE.COM')).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    expect(formatEmail('  user@example.com  ')).toBe('user@example.com');
  });
});
```

---

## Package Management

### npm

**Version:** `>=9.0.0`
**Purpose:** Package manager and script runner

**Key Commands:**

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Run linter
npm run lint

# Build for production
npm run build

# Check for outdated packages
npm outdated

# Update packages
npm update
```

**Scripts:**

```json
// File: package.json
{
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit"
  }
}
```

---

## Summary

### Technology Decisions

All technology choices in this stack were made based on:

1. **Active maintenance** - Regular updates and security patches
2. **Community support** - Large ecosystems and resources
3. **TypeScript support** - First-class TypeScript integration
4. **Performance** - Proven performance characteristics
5. **Team familiarity** - Aligns with team experience

### Upgrade Strategy

- **Patch versions:** Update immediately (bug fixes)
- **Minor versions:** Review changelog, update within 1 week
- **Major versions:** Evaluate breaking changes, plan migration

---

**Related Documentation:**
- [patterns.md](./patterns.md) - How to use these technologies effectively
- [folder-structure.md](./folder-structure.md) - Where to place configuration files
- [decisions/](./decisions/) - ADRs explaining technology choices

**Last Updated:** {{DATE}}
**Version:** {{VERSION}}
