/**
 * SyllabAI API client.
 *
 * Routing:
 * - Production (Vercel): `NEXT_PUBLIC_API_BASE_URL` points at the Spring Boot
 *   service on Render (e.g. https://syllabai-core.onrender.com) — absolute URLs.
 * - Sandbox preview: relative URLs with `XTransformPort` query, which the Caddy
 *   gateway forwards to the Java backend on port 8080.
 *
 * The bearer token is kept in localStorage for the v0 pilot (httpOnly-cookie
 * hardening is tracked for Wave 4).
 */
import type {
  AuthResponse,
  AttemptResultView,
  LearnerStateView,
  NodeView,
  PrerequisiteView,
  StudentQuestionView,
  StructuredAttemptResultView,
  SubjectView,
  TutorAnswerView,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "syllabai.token";
const USER_KEY = "syllabai.user";

export function apiPath(path: string): string {
  // path arrives like "/api/v1/auth/login" or ".../tree?includeMisconceptions=true"
  return API_BASE
    ? `${API_BASE}${path}`
    : `${path}${path.includes("?") ? "&" : "?"}XTransformPort=8080`;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setSession(auth: AuthResponse) {
  window.localStorage.setItem(TOKEN_KEY, auth.accessToken);
  window.localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function currentUser(): { id: string; email: string; displayName: string; roles: string[] } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(apiPath(path), { ...init, headers });

  if (response.status === 401) {
    clearSession();
    throw new ApiError(401, "Session expired — please sign in again.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // keep default message
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResponse>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (email: string, password: string, displayName: string) =>
    request<AuthResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),

  subjects: () => request<SubjectView[]>("/api/v1/curriculum/subjects"),

  knowledgeTree: (rootId: string, includeMisconceptions = true) =>
    request<NodeView>(
      `/api/v1/knowledge/nodes/${rootId}/tree?includeMisconceptions=${includeMisconceptions}`,
    ),

  prerequisites: (nodeId: string) =>
    request<PrerequisiteView[]>(`/api/v1/knowledge/nodes/${nodeId}/prerequisites`),

  questions: (topicNodeId?: string) =>
    request<StudentQuestionView[]>(
      topicNodeId ? `/api/v1/questions?topicNodeId=${topicNodeId}` : "/api/v1/questions",
    ),

  submitAttempt: (body: {
    questionId: string;
    chosenOptionId: string;
    responseTimeMs: number;
    confidence: number | null;
    selfDoubtFlag: boolean;
    timedCondition: boolean;
  }) =>
    request<AttemptResultView>("/api/v1/attempts", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  submitStructuredAttempt: (body: {
    questionId: string;
    partAnswers: { partId: string; answerText: string }[];
    responseTimeMs: number;
    confidence: number | null;
    selfDoubtFlag: boolean;
    timedCondition: boolean;
  }) =>
    request<StructuredAttemptResultView>("/api/v1/attempts/structured", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  learnerState: () => request<LearnerStateView>("/api/v1/learners/me/state"),

  tutorAsk: (question: string) =>
    request<TutorAnswerView>("/api/v1/tutor/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
};
