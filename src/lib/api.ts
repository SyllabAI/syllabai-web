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
  AttemptHistoryView,
  AuthResponse,
  AnswerMarkingView,
  AttemptResultView,
  HumanMarkView,
  KappaEvaluationView,
  LearnerKnowledgeGraphView,
  LearnerStateView,
  NextBestActionsView,
  NodeView,
  PrerequisiteView,
  SmartMarkView,
  StudentQuestionView,
  StructuredAttemptResultView,
  SubjectView,
  TeacherLearnerView,
  TutorAnswerView,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const TOKEN_KEY = "syllabai.token";
const USER_KEY = "syllabai.user";

export function apiPath(path: string): string {
  // path arrives like "/api/v1/auth/login" or ".../tree?includeMisconceptions=true".
  // API_BASE is documented as the bare API origin (e.g. https://syllabai-core.onrender.com),
  // but a trailing /api/v1 (as older deployment notes described) must not double the
  // prefix — normalize it away so both operator conventions produce identical URLs.
  const base = API_BASE.replace(/\/api\/v1$/, "");
  return base
    ? `${base}${path}`
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

  if (response.status === 401 && !path.startsWith("/api/v1/auth/")) {
    // an authenticated call lost its session (expired/invalid token) — clear and
    // tell the user to sign in again. NOT for /auth/* itself: a 401 there means
    // invalid credentials and must surface the backend's real message verbatim
    // (the pre-fix rewrite showed "Session expired" on a wrong-password login).
    clearSession();
    // Tell the app tree to drop every per-user read model and return to the
    // login screen (page.tsx listens) — clearing storage alone used to leave a
    // zombie logged-in UI that kept failing on every subsequent call.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("syllabai:session-expired"));
    }
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

  // Attempt history (Review Hub minimal slice) — read-only view over the
  // learner's own attempts/answers evidence rows. Default limit 50 (max 100).
  learnerAttempts: (limit?: number) =>
    request<AttemptHistoryView>(
      `/api/v1/learners/me/attempts${limit ? `?limit=${limit}` : ""}`,
    ),

  learnerKnowledgeGraph: (rootId: string) =>
    request<LearnerKnowledgeGraphView>(
      `/api/v1/learners/me/knowledge-graph?rootId=${encodeURIComponent(rootId)}`,
    ),

  // T-033: deterministic next-best-learning-action read model (Spec §22 route).
  // Advice derived from evidence — distinct from the /state measured facts.
  recommendations: (rootId: string) =>
    request<NextBestActionsView>(
      `/api/v1/learners/me/recommendations?rootId=${encodeURIComponent(rootId)}`,
    ),

  tutorAsk: (question: string) =>
    request<TutorAnswerView>("/api/v1/tutor/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  // ── T-029 teacher review surface (route security: TEACHER or ADMIN on the
  // backend; the role check in the UI is an affordance, never authorization) ──
  teacherLearners: () => request<TeacherLearnerView[]>("/api/v1/teacher/learners"),

  markingQueue: (state: string) =>
    request<AnswerMarkingView[]>(`/api/v1/teacher/marking/answers?state=${state}`),

  markingAnswer: (answerId: string) =>
    request<AnswerMarkingView>(`/api/v1/teacher/marking/answers/${answerId}`),

  runSmartMark: (answerId: string) =>
    request<SmartMarkView>(`/api/v1/teacher/marking/answers/${answerId}/smart-mark`, {
      method: "POST",
    }),

  recordHumanMark: (
    answerId: string,
    body: {
      marksAwarded: number;
      perPointDecisions: Record<string, number> | null;
      comments: string | null;
    },
  ) =>
    request<HumanMarkView>(`/api/v1/teacher/marking/answers/${answerId}/human-mark`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  kappaLatest: (paperId?: string) =>
    request<KappaEvaluationView>(
      `/api/v1/teacher/marking/kappa/latest${paperId ? `?paperId=${paperId}` : ""}`,
    ),

  evaluateKappa: (paperId?: string) =>
    request<KappaEvaluationView>("/api/v1/teacher/marking/kappa/evaluate", {
      method: "POST",
      body: JSON.stringify(paperId ? { paperId } : {}),
    }),
};
