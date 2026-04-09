# Issue: MongoDB Connection Timeout in Vercel Serverless Functions

## Description

The application is experiencing `MongooseError: Connection operation buffering timed out` when running API endpoints in Vercel serverless environments. This occurs because serverless functions may spin up new instances rapidly without properly reusing existing database connections, or because the underlying connection drops entirely during execution.

## Expected Behavior

The database connection should be safely reused across serverless invocations, and any cold starts should quickly initialize the connection without exceeding timeouts.

## Proposed Solution / "YML Steps" / Tasks

1. Refactor connection logic in `src/index.ts` to implement a robust connection recycling pattern caching the Mongoose promise globally.
2. Verify connection string options (`poolSize`, `socketTimeoutMS`, `connectTimeoutMS`) are tailored for Vercel functions.
3. Validate connection health prior to executing DB requests in the API middlewares.
4. Test locally using Vercel CLI and observe latency.

## Related Context

- Framework: Next.js API / Express on Vercel
- Database: MongoDB Atlas using Mongoose
- Environment variables: Verify `MONGODB_URI` connection limits constraints.
