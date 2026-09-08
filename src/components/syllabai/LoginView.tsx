"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GraduationCap, Loader2, LogIn, UserPlus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AuthResponse } from "@/lib/types";

interface LoginViewProps {
  onAuthenticated: (auth: AuthResponse) => void;
}

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const auth =
        mode === "login"
          ? await api.login(email, password)
          : await api.register(email, password, displayName);
      onAuthenticated(auth);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else if (err instanceof TypeError) {
        setError("Cannot reach the SyllabAI backend. Is it running?");
      } else {
        setError("Something went wrong — please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <GraduationCap className="size-7" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SyllabAI</h1>
            <p className="text-sm text-muted-foreground">
              Knowledge-graph practice with mastery tracking — Edexcel IAL Chemistry (Cycle 1)
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{mode === "login" ? "Sign in" : "Create a student account"}</CardTitle>
            <CardDescription>
              {mode === "login"
                ? process.env.NODE_ENV !== "production"
                  ? "Use your SyllabAI account, or the demo credentials below."
                  : "Use your SyllabAI account."
                : "Self-registration always creates a STUDENT role (Master Spec §6.1)."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4" aria-label="Authentication form">
              {mode === "register" && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ayesha R."
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="student@syllabai.dev"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••"
                  required
                  minLength={8}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                />
              </div>

              {error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : (
                  mode === "login" ? <LogIn className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />
                )}
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>

              <Button
                type="button"
                variant="link"
                className="w-full"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError(null);
                }}
              >
                {mode === "login"
                  ? "No account? Register as a student"
                  : "Already registered? Sign in"}
              </Button>
            </form>

            {mode === "login" && process.env.NODE_ENV !== "production" && (
              <div className="mt-4 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Demo accounts (local profile)</p>
                <p>student@syllabai.dev / student-demo-1234</p>
                <p>teacher@syllabai.dev / teacher-demo-1234</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
