"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const TOKEN_KEY = "gialco_session_token";

export type AuthUser = {
  _id: Id<"users">;
  name: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: "admin" | "employee";
  allowedPages: string[];
  isActive: boolean;
  phone: string;
  department: string;
  departmentId?: string | null;
  workplace: string;
  workplaceId?: string | null;
  hireDate: number | null;
  annualLeaveBalance: number;
  annualLeaveQuota: number;
  baseSalary: number;
  barcode: string;
  zktecoUserId?: string;
};

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null | undefined;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const loginMutation = useMutation(api.auth.login);
  const logoutMutation = useMutation(api.auth.logout);
  // Skip until we have a token — avoids null-token queries that look like "logged out"
  const user = useQuery(
    api.auth.me,
    ready && token ? { token } : "skip"
  );

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    setToken(saved);
    setReady(true);
  }, []);

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await loginMutation({ username, password });
      localStorage.setItem(TOKEN_KEY, result.token);
      setToken(result.token);
      return result.user as AuthUser;
    },
    [loginMutation]
  );

  const logout = useCallback(async () => {
    if (token) {
      try {
        await logoutMutation({ token });
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, [logoutMutation, token]);

  const resolvedUser = !ready
    ? undefined
    : !token
      ? null
      : (user as AuthUser | null | undefined);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user: resolvedUser,
      isLoading: !ready || (Boolean(token) && user === undefined),
      login,
      logout,
    }),
    [token, resolvedUser, user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
