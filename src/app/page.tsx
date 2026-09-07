"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppHeader } from "@/components/syllabai/AppHeader";
import { LoginView } from "@/components/syllabai/LoginView";
import { DashboardView } from "@/components/syllabai/DashboardView";
import { HistoryView } from "@/components/syllabai/HistoryView";
import { MasteryMap } from "@/components/syllabai/MasteryMap";
import { PracticeView } from "@/components/syllabai/PracticeView";
import { StateView } from "@/components/syllabai/StateView";
import { TutorChatView, type TutorChatMessage } from "@/components/syllabai/TutorChatView";
import { clearSession, api, currentUser, getToken, setSession } from "@/lib/api";
import type {
  AttemptHistoryView,
  AuthResponse,
  LearnerKnowledgeGraphView,
  LearnerStateView,
  NextBestActionsView,
} from "@/lib/types";
import { TeacherReviewView } from "@/components/syllabai/TeacherReviewView";
import {
  Brain,
  ClipboardList,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  MessagesSquare,
  Users,
} from "lucide-react";

export default function SyllabAiWorkbench() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [learnerState, setLearnerState] = useState<LearnerStateView | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  // The personalized graph (F-034) feeds the dashboard + mastery map; the
  // client-side tree + /state join is retired (T-028).
  const [graph, setGraph] = useState<LearnerKnowledgeGraphView | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [rootId, setRootId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  // Tutor transcript lives here (not inside the tab) so it survives tab switches;
  // server-side sessions arrive with the Spec §22 tutor/sessions endpoints.
  const [tutorMessages, setTutorMessages] = useState<TutorChatMessage[]>([]);
  // T-033: next-best-action read model (nba-rules/v1) — refreshed together with
  // state + graph because attempts change the evidence it ranks from.
  const [recommendations, setRecommendations] = useState<NextBestActionsView | null>(null);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  // Learning history (Review Hub slice): read-only view over the learner's own
  // attempts — refreshed after each submission so the record is always current.
  const [history, setHistory] = useState<AttemptHistoryView | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  // Controlled tabs so dashboard/map/history can deep-link into practice with a topic.
  const [tab, setTab] = useState("dashboard");
  const [practiceTopic, setPracticeTopic] = useState<{ nodeId: string; title: string } | null>(
    null,
  );
  // Tutor draft: a question pre-filled from where the student came from
  // (a wrong answer or the next-best-actions card) — editable, never auto-sent.
  const [tutorDraft, setTutorDraft] = useState<string | null>(null);
  // T-029: the Teacher tab is a UI affordance for TEACHER/ADMIN accounts.
  // The backend enforces /api/v1/teacher/** (SecurityConfig) — this check only
  // decides whether the tab renders; it is never the authorization.
  const isTeacher = useMemo(
    () => auth?.user.roles.some((r) => r === "TEACHER" || r === "ADMIN") ?? false,
    [auth],
  );

  // Restore session on first paint (token in localStorage, v0 pilot storage).
  useEffect(() => {
    const token = getToken();
    const user = currentUser();
    if (token && user) {
      setAuth({ accessToken: token, tokenType: "Bearer", user });
    }
    setRestoring(false);
  }, []);

  const refreshState = useCallback(async () => {
    setStateLoading(true);
    try {
      setLearnerState(await api.learnerState());
    } catch {
      // 401 already clears the session via the API client; ignore other errors here
    } finally {
      setStateLoading(false);
    }
  }, []);

  const refreshGraph = useCallback(async (rid: string) => {
    setGraphLoading(true);
    try {
      setGraph(await api.learnerKnowledgeGraph(rid));
    } catch {
      // the dashboard / map render their own error states
    } finally {
      setGraphLoading(false);
    }
  }, []);

  const refreshRecommendations = useCallback(async (rid: string) => {
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    try {
      setRecommendations(await api.recommendations(rid));
    } catch (err) {
      // recommendations are advice, not facts — a failure here must not break
      // the measured panels; the card renders its own honest error state
      setRecommendationsError(err instanceof Error ? err.message : "unavailable");
    } finally {
      setRecommendationsLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await api.learnerAttempts());
    } catch (err) {
      // history is a convenience surface — a failure must not break the app;
      // the view renders its own honest error state
      setHistoryError(err instanceof Error ? err.message : "unavailable");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Load learner state + the personalized knowledge graph whenever a session exists.
  useEffect(() => {
    if (!auth) return;
    refreshState();
    refreshHistory();
    let cancelled = false;
    (async () => {
      try {
        const subjects = await api.subjects();
        const withNode = subjects.find((s) => s.knowledgeNodeId);
        if (withNode?.knowledgeNodeId && !cancelled) {
          setRootId(withNode.knowledgeNodeId);
          setSubjectName(withNode.name);
          refreshGraph(withNode.knowledgeNodeId);
          refreshRecommendations(withNode.knowledgeNodeId);
        }
      } catch {
        // dashboard/map show their own error state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, refreshState, refreshGraph, refreshRecommendations, refreshHistory]);

  // After an attempt all read models change server-side (BKT + decay view +
  // the evidence the next-best actions rank from + the history record itself).
  const handleAttemptSubmitted = useCallback(() => {
    refreshState();
    refreshHistory();
    if (rootId) {
      refreshGraph(rootId);
      refreshRecommendations(rootId);
    }
  }, [refreshState, refreshGraph, refreshRecommendations, refreshHistory, rootId]);

  const titles = useMemo(() => {
    const acc: Record<string, string> = {};
    graph?.nodes.forEach((n) => {
      acc[n.id] = n.title;
    });
    return acc;
  }, [graph]);

  const onPracticeTopic = useCallback((nodeId: string, title: string) => {
    setPracticeTopic({ nodeId, title });
    setTab("practice");
  }, []);

  // Weakness → tutor leg of the loop: pre-fill an editable question so the
  // student can ask about exactly what they got wrong. Never auto-sends.
  const onAskTutorAbout = useCallback((draft: string) => {
    setTutorDraft(draft);
    setTab("tutor");
  }, []);

  if (restoring) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/40">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <GraduationCap className="size-10 animate-pulse" aria-hidden="true" />
          <p className="text-sm">Loading SyllabAI…</p>
        </div>
      </main>
    );
  }

  if (!auth) {
    return (
      <LoginView
        onAuthenticated={(session) => {
          setSession(session);
          setAuth(session);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <AppHeader
        user={auth.user}
        onLogout={() => {
          clearSession();
          setAuth(null);
          setLearnerState(null);
          setGraph(null);
          setRootId(null);
          setSubjectName(null);
          setHistory(null);
          setTutorDraft(null);
          setTab("dashboard");
        }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 scroll-mt-16 px-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList
            className={`mb-4 grid w-full ${isTeacher ? "grid-cols-7" : "grid-cols-6"}`}
          >
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="practice" className="gap-1.5">
              <GraduationCap className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Practice</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <ClipboardList className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
            <TabsTrigger value="tutor" className="gap-1.5">
              <MessagesSquare className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Tutor</span>
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5">
              <Brain className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Mastery map</span>
            </TabsTrigger>
            <TabsTrigger value="state" className="gap-1.5">
              <LineChart className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">My state</span>
            </TabsTrigger>
            {isTeacher && (
              <TabsTrigger value="teacher" className="gap-1.5">
                <Users className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Teacher</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="dashboard">
            <DashboardView
              graph={graph}
              state={learnerState}
              loading={graphLoading}
              recommendations={recommendations}
              recommendationsLoading={recommendationsLoading}
              recommendationsError={recommendationsError}
              onPracticeTopic={onPracticeTopic}
              onOpenMap={() => setTab("map")}
              onAskTutor={() => setTab("tutor")}
            />
          </TabsContent>
          <TabsContent value="practice">
            <PracticeView
              onAttemptSubmitted={handleAttemptSubmitted}
              topicNodeId={practiceTopic?.nodeId ?? null}
              topicTitle={practiceTopic?.title ?? null}
              onClearTopic={() => setPracticeTopic(null)}
              onAskTutorAbout={onAskTutorAbout}
            />
          </TabsContent>
          <TabsContent value="history">
            <HistoryView
              history={history}
              loading={historyLoading}
              error={historyError}
              onPracticeTopic={onPracticeTopic}
            />
          </TabsContent>
          <TabsContent value="tutor">
            <TutorChatView
              messages={tutorMessages}
              setMessages={setTutorMessages}
              draft={tutorDraft}
              onDraftConsumed={() => setTutorDraft(null)}
            />
          </TabsContent>
          <TabsContent value="map">
            <MasteryMap
              graph={graph}
              loading={graphLoading}
              subjectName={subjectName}
              onPracticeTopic={onPracticeTopic}
            />
          </TabsContent>
          <TabsContent value="state">
            <StateView
              state={learnerState}
              loading={stateLoading}
              nodeTitles={titles}
              misconceptionTitles={titles}
            />
          </TabsContent>
          {isTeacher && (
            <TabsContent value="teacher">
              <TeacherReviewView />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
          <span>SyllabAI — research prototype (Cycle 1 pilot)</span>
          <span>
            BKT · BDT misconception tracking · Ebbinghaus decay · Edexcel IAL Chemistry
          </span>
        </div>
      </footer>
    </div>
  );
}
