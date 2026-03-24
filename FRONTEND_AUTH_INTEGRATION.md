# Frontend Authentication Integration Guide

## Critical Understanding: Cookie-Based Auth

Your backend uses **HTTP-only cookies** for token storage, NOT Bearer tokens in headers.

### Backend Token Flow

1. Login/Register → Backend sets `accessToken` and `refreshToken` as HTTP-only cookies
2. All authenticated requests → Browser automatically sends cookies
3. Token refresh → Backend reads `refreshToken` cookie, returns new `accessToken` cookie
4. Logout → Backend clears cookies

### Why HTTP-only Cookies?

- **Security**: JavaScript cannot access tokens (XSS protection)
- **Automatic**: Browser handles cookie sending
- **No manual storage**: No localStorage/sessionStorage needed

---

## Axios Configuration (Corrected)

Your current config is wrong for cookie-based auth. Here's the correct version:

```typescript
// src/lib/api.ts
import axios from "axios";
import type { AxiosError } from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // CRITICAL: Enables cookie sending
});

// Response interceptor for automatic token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // If 401 and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh token
        await api.post("/users/refresh");

        // Retry original request (new accessToken cookie is now set)
        return api(originalRequest);
      } catch (refreshError) {
        // Refresh failed - redirect to login
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  },
);

export default api;
```

### Key Changes from Your Config:

1. **Removed** `Authorization` header logic (not needed with cookies)
2. **Removed** `accessToken` state management (cookies handle this)
3. **Simplified** refresh logic (just call `/users/refresh`)
4. **Fixed** base URL to match backend routes (`/api/users`, not `/api/v1/auth`)

---

## Auth API Functions

```typescript
// src/api/auth.ts
import api from "../lib/api";
import type { User, Address } from "../types/api";

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  address: Address;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: true;
  message: string;
  user: User;
  // Note: tokens are in HTTP-only cookies, not in response body
}

/**
 * Register new user
 * Backend sets accessToken + refreshToken cookies
 */
export const register = async (data: RegisterRequest): Promise<User> => {
  const response = await api.post<AuthResponse>("/users/register", data);
  return response.data.user;
};

/**
 * Login user
 * Backend sets accessToken + refreshToken cookies
 */
export const login = async (data: LoginRequest): Promise<User> => {
  const response = await api.post<AuthResponse>("/users/login", data);
  return response.data.user;
};

/**
 * Get current user profile
 * Requires valid accessToken cookie
 */
export const getMe = async (): Promise<User> => {
  const response = await api.get<{ success: true; user: User }>("/users/me");
  return response.data.user;
};

/**
 * Refresh access token
 * Backend reads refreshToken cookie, sets new accessToken cookie
 */
export const refreshToken = async (): Promise<void> => {
  await api.post("/users/refresh");
  // No return value needed - new cookie is set automatically
};

/**
 * Logout user
 * Backend clears accessToken + refreshToken cookies
 */
export const logout = async (): Promise<void> => {
  await api.post("/users/logout");
};

/**
 * Request password reset OTP
 */
export const forgotPassword = async (email: string): Promise<void> => {
  await api.post("/users/forgot-password", { email });
};

/**
 * Reset password with OTP
 */
export const resetPassword = async (
  email: string,
  otp: string,
  newPassword: string,
): Promise<void> => {
  await api.post("/users/reset-password", { email, otp, newPassword });
};
```

---

## Auth Context (React)

```typescript
// src/contexts/AuthContext.tsx
import React, { createContext, useContext, useState, useEffect } from "react";
import { getMe, login as apiLogin, register as apiRegister, logout as apiLogout } from "../api/auth";
import type { User } from "../types/api";
import type { RegisterRequest, LoginRequest } from "../api/auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (data: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check if user is logged in on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const currentUser = await getMe();
        setUser(currentUser);
      } catch (error) {
        // Not logged in or token expired
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (data: LoginRequest) => {
    const user = await apiLogin(data);
    setUser(user);
  };

  const register = async (data: RegisterRequest) => {
    const user = await apiRegister(data);
    setUser(user);
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const refetchUser = async () => {
    try {
      const currentUser = await getMe();
      setUser(currentUser);
    } catch (error) {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};
```

---

## Protected Route Component

```typescript
// src/components/ProtectedRoute.tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireActive?: boolean; // Require ACTIVE status
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireActive = true
}) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is ACTIVE (can place orders)
  if (requireActive && user.status !== "ACTIVE") {
    return (
      <div>
        <h2>Account Not Active</h2>
        <p>Your account status is: {user.status}</p>
        {user.status === "UNVERIFIED" && (
          <p>Please verify your email to activate your account.</p>
        )}
        {user.status === "SUSPENDED" && (
          <p>Your account has been suspended. Please contact support.</p>
        )}
      </div>
    );
  }

  return <>{children}</>;
};
```

---

## Login Component Example

```typescript
// src/pages/Login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login({ email, password });
      navigate("/"); // Redirect to home after login
    } catch (err: any) {
      const message = err.response?.data?.message || "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Login</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
};
```

---

## Register Component Example

```typescript
// src/pages/Register.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import type { Address } from "../types/api";

export const Register = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "NG",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const address: Address = {
      street: formData.street,
      city: formData.city,
      state: formData.state,
      zip: formData.zip,
      country: formData.country,
    };

    try {
      await register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        address,
      });

      // User is now registered but UNVERIFIED
      navigate("/verify-email-notice");
    } catch (err: any) {
      const message = err.response?.data?.message || "Registration failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Register</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Full Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
        <input
          type="email"
          placeholder="Email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={formData.password}
          onChange={(e) => setFormData({ ...formData, password: e.target.value })}
          required
          minLength={8}
        />

        <h3>Address</h3>
        <input
          type="text"
          placeholder="Street"
          value={formData.street}
          onChange={(e) => setFormData({ ...formData, street: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="City"
          value={formData.city}
          onChange={(e) => setFormData({ ...formData, city: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="State"
          value={formData.state}
          onChange={(e) => setFormData({ ...formData, state: e.target.value })}
          required
        />
        <input
          type="text"
          placeholder="ZIP Code"
          value={formData.zip}
          onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
          required
        />

        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Registering..." : "Register"}
        </button>
      </form>
    </div>
  );
};
```

---

## Password Reset Flow

```typescript
// src/pages/ForgotPassword.tsx
import { useState } from "react";
import { forgotPassword } from "../api/auth";

export const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await forgotPassword(email);
      setSuccess(true);
    } catch (err: any) {
      const message = err.response?.data?.message || "Request failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div>
        <h1>Check Your Email</h1>
        <p>If an account exists with {email}, you will receive a 6-digit OTP code.</p>
        <p>The code expires in 15 minutes.</p>
        <a href="/reset-password">Enter OTP Code</a>
      </div>
    );
  }

  return (
    <div>
      <h1>Forgot Password</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send Reset Code"}
        </button>
      </form>
    </div>
  );
};
```

```typescript
// src/pages/ResetPassword.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { resetPassword } from "../api/auth";

export const ResetPassword = () => {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await resetPassword(email, otp, newPassword);
      alert("Password reset successful! Please login.");
      navigate("/login");
    } catch (err: any) {
      const message = err.response?.data?.message || "Reset failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>Reset Password</h1>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="6-digit OTP"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          required
          maxLength={6}
          pattern="\d{6}"
        />
        <input
          type="password"
          placeholder="New Password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
        />
        {error && <p style={{ color: "red" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Resetting..." : "Reset Password"}
        </button>
      </form>
    </div>
  );
};
```

---

## App Setup with Auth

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { Home } from "./pages/Home";
import { Products } from "./pages/Products";
import { Cart } from "./pages/Cart";
import { Checkout } from "./pages/Checkout";
import { Orders } from "./pages/Orders";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Public product browsing */}
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />

          {/* Protected routes - require login */}
          <Route
            path="/cart"
            element={
              <ProtectedRoute>
                <Cart />
              </ProtectedRoute>
            }
          />

          {/* Protected routes - require ACTIVE status */}
          <Route
            path="/checkout"
            element={
              <ProtectedRoute requireActive>
                <Checkout />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders"
            element={
              <ProtectedRoute requireActive>
                <Orders />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
```

---

## Environment Variables

```env
# .env.local
VITE_API_URL=http://localhost:3000/api
```

```env
# .env.production
VITE_API_URL=https://your-backend.vercel.app/api
```

---

## Complete Auth Flow Diagram

### Registration Flow

```
1. User fills registration form
   ↓
2. POST /api/users/register
   ↓
3. Backend creates user (status: UNVERIFIED)
   ↓
4. Backend sets accessToken + refreshToken cookies
   ↓
5. Backend sends verification email (async)
   ↓
6. Frontend receives user object
   ↓
7. Frontend updates AuthContext
   ↓
8. Redirect to "verify email" notice page
```

### Login Flow

```
1. User enters email + password
   ↓
2. POST /api/users/login
   ↓
3. Backend validates credentials
   ↓
4. Backend checks user status (ACTIVE or SUSPENDED only)
   ↓
5. Backend sets accessToken + refreshToken cookies
   ↓
6. Frontend receives user object
   ↓
7. Frontend updates AuthContext
   ↓
8. Redirect to home/dashboard
```

### Auto-Login on Page Load

```
1. App mounts
   ↓
2. AuthProvider useEffect runs
   ↓
3. GET /api/users/me (cookies sent automatically)
   ↓
4. If 200: User is logged in → set user state
   ↓
5. If 401: Try refresh token
   ↓
6. POST /api/users/refresh
   ↓
7. If 200: New accessToken cookie set → retry /me
   ↓
8. If 401: User not logged in → set user = null
```

### Token Refresh Flow (Automatic)

```
1. User makes authenticated request
   ↓
2. Backend returns 401 (accessToken expired)
   ↓
3. Axios interceptor catches 401
   ↓
4. POST /api/users/refresh (refreshToken cookie sent)
   ↓
5. Backend validates refreshToken
   ↓
6. Backend sets new accessToken cookie
   ↓
7. Axios retries original request
   ↓
8. Request succeeds with new token
```

### Logout Flow

```
1. User clicks logout
   ↓
2. POST /api/users/logout
   ↓
3. Backend clears accessToken + refreshToken cookies
   ↓
4. Frontend clears user state
   ↓
5. Redirect to login page
```

---

## Backend Response Examples

### Successful Login/Register

```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "CUSTOMER",
    "status": "ACTIVE",
    "isEmailVerified": true,
    "address": {
      "street": "123 Main St",
      "city": "Lagos",
      "state": "Lagos",
      "zip": "100001",
      "country": "NG"
    },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}

// Cookies set in response headers:
// Set-Cookie: accessToken=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=900
// Set-Cookie: refreshToken=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

### Get Me Response

```json
{
  "success": true,
  "user": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "CUSTOMER",
    "status": "ACTIVE",
    "isEmailVerified": true,
    "address": { ... },
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "message": "Invalid email or password.",
  "code": "VALIDATION_ERROR",
  "statusCode": 400
}
```

---

## Common Issues & Solutions

### Issue 1: CORS Errors

**Problem**: Browser blocks requests due to CORS policy

**Solution**: Ensure backend CORS config includes your frontend URL

```typescript
// Backend: src/config/cors.ts
export const corsOptions = {
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
  credentials: true, // CRITICAL for cookies
};
```

**Frontend**: Ensure `withCredentials: true` in axios config

---

### Issue 2: Cookies Not Being Set

**Problem**: Login succeeds but cookies aren't saved

**Causes**:

1. `withCredentials: true` missing in axios config
2. Backend CORS `credentials: true` not set
3. Frontend and backend on different domains without proper CORS
4. Using `http` in production (cookies require `https` with `Secure` flag)

**Solution**:

- Development: Use same domain (proxy) or ensure CORS allows credentials
- Production: Use HTTPS for both frontend and backend

---

### Issue 3: Token Refresh Loop

**Problem**: Infinite refresh requests

**Cause**: Refresh endpoint also returns 401

**Solution**: Check `_retry` flag in interceptor (already implemented above)

---

### Issue 4: User Status Restrictions

**Problem**: UNVERIFIED users can't access features

**Expected Behavior**:

- `UNVERIFIED`: Can login, cannot place orders
- `ACTIVE`: Full access
- `SUSPENDED`: Can login, cannot transact
- `DEACTIVATED`: Cannot login

**Solution**: Use `requireActive` prop in ProtectedRoute

---

## Testing Checklist

### Registration

- [ ] Register with valid data → user created with status UNVERIFIED
- [ ] Register with duplicate email → error
- [ ] Cookies set after registration
- [ ] User object returned without password

### Login

- [ ] Login with valid credentials → success
- [ ] Login with invalid password → error
- [ ] Login with UNVERIFIED account → success (but limited access)
- [ ] Login with DEACTIVATED account → error
- [ ] Cookies set after login
- [ ] Failed login attempts tracked (5 attempts → lockout)

### Token Refresh

- [ ] Access token expires → automatic refresh
- [ ] Refresh token valid → new access token issued
- [ ] Refresh token expired → redirect to login
- [ ] Original request retried after refresh

### Logout

- [ ] Logout clears cookies
- [ ] User state cleared in frontend
- [ ] Subsequent requests return 401

### Auto-Login

- [ ] Page refresh maintains login state
- [ ] Valid cookies → user loaded automatically
- [ ] Expired access token → refresh attempted
- [ ] No valid tokens → user remains logged out

### Password Reset

- [ ] Request OTP → email sent (or logged in dev)
- [ ] Valid OTP → password reset successful
- [ ] Invalid OTP → error after 5 attempts
- [ ] Expired OTP → error
- [ ] Rate limiting → max 3 emails per hour

---

## Security Best Practices

### 1. Never Store Tokens in localStorage

✅ **Correct**: Let backend handle cookies (HTTP-only)
❌ **Wrong**: `localStorage.setItem('token', ...)`

### 2. Always Use HTTPS in Production

Cookies with `Secure` flag only work over HTTPS

### 3. Handle Token Expiry Gracefully

Implement automatic refresh (already done in interceptor)

### 4. Validate User Status

Check `user.status` before allowing sensitive operations

### 5. Clear Sensitive Data on Logout

Clear user state, cart data, etc.

---

## Next Steps

1. ✅ Set up axios with `withCredentials: true`
2. ✅ Create auth API functions (login, register, getMe, refresh, logout)
3. ✅ Implement AuthContext with user state
4. ✅ Create ProtectedRoute component
5. ✅ Build login/register pages
6. ✅ Test token refresh flow
7. ⬜ Implement password reset flow
8. ⬜ Add email verification UI
9. ⬜ Handle user status restrictions
10. ⬜ Test with real backend

---

## Quick Reference

### Backend Endpoints

- `POST /api/users/register` - Register
- `POST /api/users/login` - Login
- `POST /api/users/refresh` - Refresh token
- `POST /api/users/logout` - Logout
- `GET /api/users/me` - Get current user
- `POST /api/users/forgot-password` - Request OTP
- `POST /api/users/reset-password` - Reset with OTP

### User Statuses

- `UNVERIFIED` - Just registered, email not verified
- `ACTIVE` - Full access
- `SUSPENDED` - Can login, cannot transact
- `DEACTIVATED` - Cannot login (terminal)

### Token Lifetimes

- Access Token: 15 minutes (default)
- Refresh Token: 7 days (default)
- OTP: 15 minutes

### Rate Limits

- Failed logins: 5 attempts → 15min lockout
- Password reset emails: 3 per hour
- OTP attempts: 5 per code
