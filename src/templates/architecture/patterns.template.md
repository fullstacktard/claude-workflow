# Implementation Patterns

**Project:** {{PROJECT_NAME}}
**Last Updated:** {{DATE}}

## Table of Contents

- [Error Handling](#error-handling)
- [Validation](#validation)
- [Logging](#logging)
- [Authentication & Authorization](#authentication--authorization)
- [API Design](#api-design)
- [Database Patterns](#database-patterns)
- [Async Patterns](#async-patterns)

---

## Error Handling

### Pattern: Structured Error Classes

**When to use:** All error scenarios across the application

**Why:** Type-safe, consistent error handling with proper stack traces

**Implementation:**

```typescript
// File: src/lib/errors.ts

/**
 * Base application error class
 * All custom errors should extend this
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'INTERNAL_ERROR',
    public isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * User-facing validation errors
 * Use when user input is invalid
 */
export class ValidationError extends AppError {
  constructor(message: string, public field?: string) {
    super(message, 400, 'VALIDATION_ERROR', true);
  }
}

/**
 * Authentication errors
 * Use when authentication fails
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR', true);
  }
}

/**
 * Authorization errors
 * Use when user lacks permissions
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR', true);
  }
}

/**
 * Not found errors
 * Use when resource doesn't exist
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND', true);
  }
}

/**
 * Database errors
 * Use when database operations fail
 */
export class DatabaseError extends AppError {
  constructor(message: string, public originalError?: Error) {
    super(message, 500, 'DATABASE_ERROR', true);
  }
}
```

**Usage Example:**

```typescript
// File: src/domain/users/get-user.usecase.ts
import { NotFoundError } from '../../lib/errors';
import { UserRepository } from '../../repositories/user.repository';

export class GetUserUseCase {
  constructor(private userRepo: UserRepository) {}

  async execute(userId: string) {
    const user = await this.userRepo.findById(userId);

    if (!user) {
      throw new NotFoundError('User'); // Will return 404 with proper error code
    }

    return user;
  }
}
```

### Pattern: Express Error Handler Middleware

**When to use:** Express/Fastify applications

**Why:** Centralized error handling, consistent error responses

**Implementation:**

```typescript
// File: src/middleware/error-handler.ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * Global error handler middleware
 * Must be registered LAST in middleware chain
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Handle known application errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err instanceof ValidationError && err.field ? { field: err.field } : {}),
      },
    });
  }

  // Handle unknown errors (don't leak details)
  return res.status(500).json({
    error: {
      message: 'An unexpected error occurred',
      code: 'INTERNAL_ERROR',
    },
  });
}

/**
 * Async error wrapper
 * Catches errors in async route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
```

**Usage in Routes:**

```typescript
// File: src/api/routes/users.routes.ts
import { Router } from 'express';
import { asyncHandler, errorHandler } from '../../middleware/error-handler';
import { UserController } from '../controllers/user.controller';

export function createUserRoutes(controller: UserController): Router {
  const router = Router();

  // Use asyncHandler to catch async errors
  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const user = await controller.getUser(req.params.id);
      res.json(user);
    })
  );

  return router;
}

// In app setup:
// app.use('/api/users', userRoutes);
// app.use(errorHandler); // MUST be last!
```

### Pattern: React Error Boundaries

**When to use:** React applications to catch rendering errors

**Implementation:**

```typescript
// File: src/components/ErrorBoundary/ErrorBoundary.tsx
import { Component, ReactNode } from 'react';
import { logger } from '../../lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * Error boundary component
 * Catches errors in child component tree
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('React error boundary caught error', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="error-container">
            <h1>Something went wrong</h1>
            <p>Please refresh the page or contact support.</p>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
```

**Usage:**

```typescript
// File: src/App.tsx
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';

export function App() {
  return (
    <ErrorBoundary>
      <Dashboard />
    </ErrorBoundary>
  );
}
```

---

## Validation

### Pattern: Zod Schema Validation

**When to use:** Validating user input, API requests, configuration

**Why:** Type-safe validation with TypeScript inference

**Implementation:**

```typescript
// File: src/lib/validation/schemas.ts
import { z } from 'zod';

/**
 * User registration validation schema
 */
export const registerUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
});

// Infer TypeScript type from schema
export type RegisterUserInput = z.infer<typeof registerUserSchema>;

/**
 * User login validation schema
 */
export const loginUserSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginUserInput = z.infer<typeof loginUserSchema>;

/**
 * Query params validation (pagination)
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['createdAt', 'name', 'email']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationParams = z.infer<typeof paginationSchema>;
```

**Express Middleware:**

```typescript
// File: src/middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../lib/errors';

/**
 * Express middleware to validate request body
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        throw new ValidationError(firstError.message, firstError.path.join('.'));
      }
      next(error);
    }
  };
}

/**
 * Express middleware to validate query params
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const firstError = error.errors[0];
        throw new ValidationError(firstError.message, firstError.path.join('.'));
      }
      next(error);
    }
  };
}
```

**Usage in Routes:**

```typescript
// File: src/api/routes/auth.routes.ts
import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { registerUserSchema, loginUserSchema } from '../../lib/validation/schemas';
import { AuthController } from '../controllers/auth.controller';

export function createAuthRoutes(controller: AuthController): Router {
  const router = Router();

  router.post(
    '/register',
    validateBody(registerUserSchema), // Validates and transforms request body
    async (req, res) => {
      // req.body is now typed as RegisterUserInput
      const user = await controller.register(req.body);
      res.status(201).json(user);
    }
  );

  router.post(
    '/login',
    validateBody(loginUserSchema),
    async (req, res) => {
      const tokens = await controller.login(req.body);
      res.json(tokens);
    }
  );

  return router;
}
```

### Pattern: Frontend Form Validation

**When to use:** React forms with user input

**Implementation:**

```typescript
// File: src/hooks/useFormValidation.ts
import { useState, FormEvent } from 'react';
import { ZodSchema, ZodError } from 'zod';

interface ValidationErrors {
  [key: string]: string;
}

/**
 * Hook for form validation with Zod
 */
export function useFormValidation<T extends Record<string, any>>(
  schema: ZodSchema<T>,
  onSubmit: (data: T) => void | Promise<void>
) {
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const validate = (data: unknown): data is T => {
    try {
      schema.parse(data);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors: ValidationErrors = {};
        error.errors.forEach((err) => {
          const field = err.path.join('.');
          formattedErrors[field] = err.message;
        });
        setErrors(formattedErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = Object.fromEntries(formData.entries());

    if (validate(data)) {
      setIsSubmitting(true);
      try {
        await onSubmit(data);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return {
    errors,
    isSubmitting,
    handleSubmit,
    setErrors,
  };
}
```

**Usage:**

```typescript
// File: src/components/LoginForm/LoginForm.tsx
import { loginUserSchema } from '../../lib/validation/schemas';
import { useFormValidation } from '../../hooks/useFormValidation';
import { authService } from '../../services/auth.service';

export function LoginForm() {
  const { errors, isSubmitting, handleSubmit } = useFormValidation(
    loginUserSchema,
    async (data) => {
      await authService.login(data);
      // Handle successful login
    }
  );

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          aria-invalid={!!errors.email}
        />
        {errors.email && <span className="error">{errors.email}</span>}
      </div>

      <div>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          aria-invalid={!!errors.password}
        />
        {errors.password && <span className="error">{errors.password}</span>}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in...' : 'Log In'}
      </button>
    </form>
  );
}
```

---

## Logging

### Pattern: Structured Logging with Pino

**When to use:** All logging throughout the application

**Why:** Structured logs are machine-readable, searchable, and production-ready

**Implementation:**

```typescript
// File: src/lib/logger.ts
import pino from 'pino';

/**
 * Centralized logger instance
 * Use this throughout the application
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

/**
 * Create child logger with context
 * Use for request-scoped logging
 */
export function createChildLogger(context: Record<string, any>) {
  return logger.child(context);
}
```

**Usage Patterns:**

```typescript
// File: src/domain/auth/login.usecase.ts
import { logger } from '../../lib/logger';
import { AuthenticationError } from '../../lib/errors';

export class LoginUseCase {
  async execute(email: string, password: string) {
    logger.info({ email }, 'Login attempt');

    const user = await this.userRepo.findByEmail(email);

    if (!user || !(await this.comparePassword(password, user.passwordHash))) {
      logger.warn({ email }, 'Login failed: Invalid credentials');
      throw new AuthenticationError('Invalid email or password');
    }

    logger.info({ userId: user.id, email }, 'Login successful');
    return user;
  }
}
```

### Pattern: Request Logging Middleware

**Implementation:**

```typescript
// File: src/middleware/request-logger.ts
import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../lib/logger';
import { randomUUID } from 'crypto';

/**
 * Express middleware for request logging
 * Adds request ID and logs request/response
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Add unique request ID
  const requestId = randomUUID();
  req.requestId = requestId;

  // Create request-scoped logger
  const requestLogger = createChildLogger({
    requestId,
    method: req.method,
    path: req.path,
  });

  // Log request
  requestLogger.info('Incoming request');

  // Track response time
  const startTime = Date.now();

  // Log response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        statusCode: res.statusCode,
        duration,
      },
      'Request completed'
    );
  });

  next();
}
```

---

## Authentication & Authorization

### Pattern: JWT Authentication Middleware

**When to use:** Protecting API routes that require authentication

**Implementation:**

```typescript
// File: src/middleware/authenticate.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticationError } from '../lib/errors';
import { logger } from '../lib/logger';

interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
      requestId?: string;
    }
  }
}

/**
 * Express middleware to verify JWT token
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;

    // Attach user to request
    req.user = payload;

    logger.debug({ userId: payload.userId }, 'User authenticated');
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new AuthenticationError('Invalid token');
    }
    throw error;
  }
}

/**
 * Role-based authorization middleware
 */
export function authorize(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AuthorizationError(
        `This action requires one of these roles: ${allowedRoles.join(', ')}`
      );
    }

    next();
  };
}
```

**Usage:**

```typescript
// File: src/api/routes/admin.routes.ts
import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/authenticate';
import { AdminController } from '../controllers/admin.controller';

export function createAdminRoutes(controller: AdminController): Router {
  const router = Router();

  // Requires authentication AND admin role
  router.get(
    '/users',
    authenticate,
    authorize('admin', 'superadmin'),
    async (req, res) => {
      const users = await controller.getAllUsers();
      res.json(users);
    }
  );

  return router;
}
```

---

## API Design

### Pattern: RESTful API Conventions

**Implementation:**

```typescript
// File: src/api/routes/users.routes.ts
import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate, authorize } from '../../middleware/authenticate';
import { validateBody, validateQuery } from '../../middleware/validate';
import { paginationSchema } from '../../lib/validation/schemas';

/**
 * RESTful user routes
 * Follows standard REST conventions
 */
export function createUserRoutes(controller: UserController): Router {
  const router = Router();

  // GET /users - List users (paginated)
  router.get(
    '/',
    authenticate,
    validateQuery(paginationSchema),
    async (req, res) => {
      const users = await controller.listUsers(req.query);
      res.json({
        data: users.items,
        pagination: {
          page: users.page,
          limit: users.limit,
          total: users.total,
          totalPages: Math.ceil(users.total / users.limit),
        },
      });
    }
  );

  // GET /users/:id - Get single user
  router.get('/:id', authenticate, async (req, res) => {
    const user = await controller.getUser(req.params.id);
    res.json({ data: user });
  });

  // POST /users - Create user
  router.post(
    '/',
    authenticate,
    authorize('admin'),
    validateBody(createUserSchema),
    async (req, res) => {
      const user = await controller.createUser(req.body);
      res.status(201).json({ data: user });
    }
  );

  // PUT /users/:id - Update user (full replacement)
  router.put(
    '/:id',
    authenticate,
    authorize('admin'),
    validateBody(updateUserSchema),
    async (req, res) => {
      const user = await controller.updateUser(req.params.id, req.body);
      res.json({ data: user });
    }
  );

  // PATCH /users/:id - Partial update
  router.patch(
    '/:id',
    authenticate,
    validateBody(partialUpdateUserSchema),
    async (req, res) => {
      const user = await controller.patchUser(req.params.id, req.body);
      res.json({ data: user });
    }
  );

  // DELETE /users/:id - Delete user
  router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    await controller.deleteUser(req.params.id);
    res.status(204).send();
  });

  return router;
}
```

**Standard Response Format:**

```typescript
// Success response
{
  "data": { ... }  // or array for collections
}

// Success with pagination
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}

// Error response
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is required",
    "field": "email"  // Optional, for field-specific errors
  }
}
```

---

## Database Patterns

### Pattern: Repository Pattern

**When to use:** Abstracting database operations

**Implementation:**

```typescript
// File: src/repositories/user.repository.ts
import { PrismaClient } from '@prisma/client';
import { User } from '../models/User';
import { DatabaseError } from '../lib/errors';

/**
 * User repository for database operations
 * Abstracts Prisma/database implementation
 */
export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { id },
      });
    } catch (error) {
      throw new DatabaseError('Failed to fetch user', error as Error);
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.prisma.user.findUnique({
        where: { email },
      });
    } catch (error) {
      throw new DatabaseError('Failed to fetch user by email', error as Error);
    }
  }

  async create(data: CreateUserData): Promise<User> {
    try {
      return await this.prisma.user.create({
        data,
      });
    } catch (error) {
      throw new DatabaseError('Failed to create user', error as Error);
    }
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    try {
      return await this.prisma.user.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new DatabaseError('Failed to update user', error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.prisma.user.delete({
        where: { id },
      });
    } catch (error) {
      throw new DatabaseError('Failed to delete user', error as Error);
    }
  }

  async list(params: ListUsersParams): Promise<UserListResult> {
    try {
      const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = params;
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        this.prisma.user.findMany({
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
        }),
        this.prisma.user.count(),
      ]);

      return {
        items,
        total,
        page,
        limit,
      };
    } catch (error) {
      throw new DatabaseError('Failed to list users', error as Error);
    }
  }
}
```

---

## Async Patterns

### Pattern: Parallel Operations with Promise.all

**When to use:** Multiple independent async operations

**Implementation:**

```typescript
// File: src/domain/dashboard/get-dashboard-data.usecase.ts

/**
 * Fetch dashboard data efficiently
 * All queries run in parallel
 */
export class GetDashboardDataUseCase {
  async execute(userId: string) {
    // ✅ GOOD: Run independent queries in parallel
    const [user, stats, recentActivities, notifications] = await Promise.all([
      this.userRepo.findById(userId),
      this.statsService.getUserStats(userId),
      this.activityRepo.getRecent(userId, 10),
      this.notificationRepo.getUnread(userId),
    ]);

    return {
      user,
      stats,
      recentActivities,
      notifications,
    };
  }
}

// ❌ BAD: Sequential queries (slow)
async function getDashboardDataSlow(userId: string) {
  const user = await userRepo.findById(userId);
  const stats = await statsService.getUserStats(userId); // Waits for user
  const activities = await activityRepo.getRecent(userId, 10); // Waits for stats
  return { user, stats, activities };
}
```

---

**Related Documentation:**
- [folder-structure.md](./folder-structure.md) - Where to put these patterns
- [testing.md](./testing.md) - How to test these patterns
- [tech-stack.md](./tech-stack.md) - Libraries used in these patterns

**Last Updated:** {{DATE}}
**Version:** {{VERSION}}
