# Authentication: Your Config vs Correct Config

## ❌ Your Current Config (WRONG for this backend)

```typescript
// This is for Bearer token auth, NOT cookie-based auth
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`; // ❌ Backend doesn't use this
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (response.data?.data?.accessToken) {
      setAccessToken(response.data.data.accessToken); // ❌ Backend doesn't return tokens in body
    }
    return response;
  },
  async (error) => {
    // ... refresh logic
    const response = await api.post("/auth/refresh"); // ❌ Wrong endpoint
    const { accessToken: newAccessToken } = response.data.data; // ❌ No token in response
    setAccessToken(newAccessToken);
  },
);
```

### Why This Won't Work:

1. Backend uses **HTTP-only cookies**, not Bearer tokens
2. Backend **never returns tokens** in response body
3. Tokens are **automatically sent** by browser via cookies
4. Endpoint is `/users/refresh`, not `/auth/refresh`
5. Manual token management is **unnecessary and wrong**

---

## ✅ Correct Config (Cookie-Based Auth)

```typescript
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // ✅ This is all you need for cookies
});

// No Authorization header needed - cookies are automatic!
// No token state management needed - browser handles it!

api.interceptors.response.use(
  (response) => response, // ✅ No token extraction needed
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        await api.post("/users/refresh"); // ✅ Correct endpoint
        // ✅ New accessToken cookie is automatically set by backend
        return api(originalRequest); // ✅ Retry with new cookie
      } catch (refreshError) {
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
```

### Why This Works:

1. `withCredentials: true` tells browser to send cookies
2. Backend sets cookies in response headers
3. Browser automatically includes cookies in all requests
4. No manual token management needed
5. Refresh endpoint returns new cookie, not JSON token

---

## Side-by-Side Comparison

| Aspect            | Your Config (Bearer)             | Correct Config (Cookies)    |
| ----------------- | -------------------------------- | --------------------------- |
| Token Storage     | `let accessToken` variable       | HTTP-only cookies (browser) |
| Token Sending     | `Authorization: Bearer ${token}` | Automatic via cookies       |
| Token Receiving   | `response.data.data.accessToken` | `Set-Cookie` header         |
| Manual Management | Required                         | Not needed                  |
| XSS Protection    | ❌ Vulnerable                    | ✅ Protected (HTTP-only)    |
| Refresh Endpoint  | `/auth/refresh`                  | `/users/refresh`            |
| Base URL          | `/api/v1`                        | `/api`                      |

---

## Backend Token Flow (How It Actually Works)

### Login Request

```http
POST /api/users/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

### Backend Response

```http
HTTP/1.1 200 OK
Set-Cookie: accessToken=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=900
Set-Cookie: refreshToken=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
Content-Type: application/json

{
  "success": true,
  "message": "Login successful",
  "user": { ... }
}
```

**Notice**: Tokens are in `Set-Cookie` headers, NOT in JSON body!

### Subsequent Authenticated Request

```http
GET /api/users/me
Cookie: accessToken=eyJhbGc...; refreshToken=eyJhbGc...
```

**Notice**: Browser automatically sends cookies - no `Authorization` header!

---

## Backend Code Analysis

Looking at your `UserService.ts`:

```typescript
// Backend NEVER returns tokens in response body
static async login(email: string, password: string): Promise<AuthResponse> {
  // ...
  const tokens = issueTokens(safeUser as IUser);
  return { user: safeUser as IUser, tokens }; // ✅ Returns to controller
}
```

But in the controller (check `UserController.ts`):

```typescript
// Controller sets tokens as HTTP-only cookies
const { user, tokens } = await UserService.login(email, password);

res.cookie("accessToken", tokens.accessToken, {
  httpOnly: true, // ✅ JavaScript cannot access
  secure: true,
  sameSite: "strict",
  maxAge: 15 * 60 * 1000, // 15 minutes
});

res.cookie("refreshToken", tokens.refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

res.json({
  success: true,
  message: "Login successful",
  user, // ✅ Only user object in JSON, NO tokens
});
```

**Key Point**: Tokens go to cookies, not JSON response!

---

## Migration Guide

### Step 1: Remove Token State Management

```typescript
// ❌ DELETE THIS
let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
```

### Step 2: Remove Authorization Header Logic

```typescript
// ❌ DELETE THIS
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});
```

### Step 3: Simplify Response Interceptor

```typescript
// ❌ DELETE THIS
api.interceptors.response.use((response) => {
  if (response.data?.data?.accessToken) {
    setAccessToken(response.data.data.accessToken);
  }
  return response;
});

// ✅ REPLACE WITH THIS
api.interceptors.response.use((response) => response);
```

### Step 4: Fix Refresh Logic

```typescript
// ❌ CHANGE THIS
const response = await api.post("/auth/refresh");
const { accessToken: newAccessToken } = response.data.data;
setAccessToken(newAccessToken);

// ✅ TO THIS
await api.post("/users/refresh");
// That's it! New cookie is set automatically
```

### Step 5: Fix Base URL

```typescript
// ❌ CHANGE THIS
baseURL: import.meta.env.VITE_API_URL || "/api/v1";

// ✅ TO THIS
baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api";
```

---

## Testing Your Auth

### Test 1: Login Sets Cookies

```typescript
// After login, check browser DevTools → Application → Cookies
// You should see:
// - accessToken (HttpOnly, Secure)
// - refreshToken (HttpOnly, Secure)
```

### Test 2: Cookies Sent Automatically

```typescript
// Make any authenticated request
await api.get("/users/me");

// Check Network tab → Request Headers
// You should see:
// Cookie: accessToken=...; refreshToken=...
```

### Test 3: Refresh Works

```typescript
// Wait 15 minutes for access token to expire
// Make a request - should auto-refresh
await api.get("/users/me");

// Check Network tab:
// 1. First request → 401
// 2. Refresh request → 200
// 3. Retry original request → 200
```

### Test 4: Logout Clears Cookies

```typescript
await api.post("/users/logout");

// Check browser cookies - should be empty
// Next request should return 401
```

---

## Common Mistakes to Avoid

### ❌ Mistake 1: Trying to Access Tokens

```typescript
// This won't work - cookies are HTTP-only
const token = document.cookie; // Empty or doesn't include auth cookies
```

### ❌ Mistake 2: Storing Tokens in localStorage

```typescript
// Never do this with HTTP-only cookies
localStorage.setItem("token", token); // You don't have access to token!
```

### ❌ Mistake 3: Manually Setting Authorization Header

```typescript
// Backend doesn't check this header
headers: {
  Authorization: `Bearer ${token}`;
}
```

### ❌ Mistake 4: Wrong Endpoint Paths

```typescript
// Backend uses /api/users, not /api/v1/auth
await api.post("/auth/login"); // ❌ Wrong
await api.post("/users/login"); // ✅ Correct
```

---

## Summary

**Your Backend Uses**: Cookie-based authentication with HTTP-only cookies

**What You Need**:

1. `withCredentials: true` in axios config
2. Correct base URL (`/api`, not `/api/v1`)
3. Correct endpoints (`/users/*`, not `/auth/*`)
4. NO manual token management
5. NO Authorization headers
6. Trust the browser to handle cookies

**What You DON'T Need**:

1. Token state variables
2. `setAccessToken` / `getAccessToken` functions
3. Authorization header interceptors
4. Token extraction from responses
5. localStorage/sessionStorage for tokens

**Bottom Line**: Your backend is more secure (HTTP-only cookies), but requires simpler frontend code. Let the browser do the work!
