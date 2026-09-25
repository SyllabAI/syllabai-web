"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppHeader } from "@/components/syllabai/AppHeader";
import { BackendStatus } from "@/components/syllabai/BackendStatus";
import { LoginView } from "@/components/syllabai/LoginView";
import { DashboardView } from "@/components/syllabai/DashboardView";
import { HistoryView } from "@/components/syllabai/HistoryView";
import { MasteryMap } from "@/components/syllabai/MasteryMap";
import { PracticeView } from "@/components/syllabai/PracticeView";
import { ExamQuestionsView } from "@/components/syllabai/ExamQuestionsView";
import { SmartLessonView } from "@/components/syllabai/SmartLessonView";
import { StateView } from "@/components/syllabai/StateView";
import { TutorChatView, type TutorChatMessage } from "@/components/syllabai/TutorChatView";
import { ClaAssistantView, type ClaChatMessage } from "@/components/syllabai/ClaAssistantView";
import { clearSession, api, currentUser, getToken, setSession } from "@/lib/api";
import type {
  AttemptHistoryView,
  AuthResponse,
  LearnerKnowledgeGraphView,
  LearnerStateView,
  NextBestActionsView,
  SubjectView,
} from "@/lib/types";
import { TeacherReviewView } from "@/components/syllabai/TeacherReviewView";
import { PapersView } from "@/components/syllabai/PapersView";
import { RevisionNotesView } from "@/components/syllabai/RevisionNotesView";
import {
  BookOpen,
  Brain,
  ClipboardList,
  Compass,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  MessagesSquare,
  ScrollText,
  Sparkles,
  Users,
} from "lucide-react";

export default function SyllabAiWorkbench() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  // Logout/session-expiry epoch. The refresh callbacks below capture this value
  // when they start and re-check it after every await: a request that resolves
  // after the session was reset (explicit logout or a 401 mid-flight) must not
  // repopulate the previous account's read models — the next user would
  // otherwise see the prior account's mastery/history until their own fetch lands.
  const sessionEpoch = useRef(0);
  const [learnerState, setLearnerState] = useState<LearnerStateView | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  // The personalized graph (F-034) feeds the dashboard + mastery map; the
  // client-side tree + /state join is retired (T-028).
  const [graph, setGraph] = useState<LearnerKnowledgeGraphView | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [rootId, setRootId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState<string | null>(null);
  // Session-56 pilot-readiness: every subject the backend exposes (the teacher
  // 4CH1 activation adds a second one); the header selector lets the learner
  // pick which subject's workbench they are in — with a single subject it stays
  // out of the way, exactly like before.
  const [subjectsList, setSubjectsList] = useState<SubjectView[]>([]);
  // Tutor transcript lives here (not inside the tab) so it survives tab switches;
  // server-side sessions arrive with the Spec §22 tutor/sessions endpoints.
  const [tutorMessages, setTutorMessages] = useState<TutorChatMessage[]>([]);
  // CLA transcript — same lifted-state rationale as the tutor transcript (tab
  // switches must not erase the conversation).
  const [claMessages, setClaMessages] = useState<ClaChatMessage[]>([]);
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
  // Smart Lesson (§2): bump on new evidence (attempt submitted) so the lesson
  // view re-queries its topic and the recommendation reacts — closed loop.
  const [lessonRefreshKey, setLessonRefreshKey] = useState(0);
  // T-029: the Teacher tab is a UI affordance for TEACHER/ADMIN accounts.
  // The backend enforces /api/v1/teacher/** (SecurityConfig) — this check only
  // decides whether the tab renders; it is never the authorization.
  const isTeacher = useMemo(
    () => auth?.user.roles.some((r) => r === "TEACHER" || r === "ADMIN") ?? false,
    [auth],
  );
  // CLA context picker: the subject's TOPIC-level curriculum nodes from the
  // loaded graph. The server still resolves every pick fail-closed
  // (VALIDATED-only, subject-isolated) — this list is an affordance, never
  // the authorization.
  const assistantTopics = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((n) => n.type === "TOPIC")
        .map((n) => ({ id: n.id, code: n.code, title: n.title })),
    [graph],
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

  // One place to wipe every per-user read model. Used by the explicit logout
  // AND by the API client's session-expired event: without the latter, a 401
  // mid-session would clear localStorage while the UI stayed logged in — a
  // zombie state whose next data errors would render another account's shell.
  const resetSessionState = useCallback(() => {
    sessionEpoch.current += 1; // invalidate every in-flight refresh above
    setAuth(null);
    setLearnerState(null);
    setGraph(null);
    setRootId(null);
    setSubjectName(null);
    setHistory(null);
    setTutorDraft(null);
    setTutorMessages([]);
    setClaMessages([]);
    setRecommendations(null);
    setRecommendationsError(null);
    setStateLoading(false);
    setGraphLoading(false);
    setRecommendationsLoading(false);
    setHistoryLoading(false);
    setPracticeTopic(null);
    setTab("dashboard");
  }, []);

  // The API client clears localStorage on an authenticated-call 401 and fires
  // this window event; landing back on the login screen is the visible half.
  useEffect(() => {
    const onSessionExpired = () => resetSessionState();
    window.addEventListener("syllabai:session-expired", onSessionExpired);
    return () => window.removeEventListener("syllabai:session-expired", onSessionExpired);
  }, [resetSessionState]);

  const refreshState = useCallback(async () => {
    const epoch = sessionEpoch.current;
    setStateLoading(true);
    try {
      const state = await api.learnerState();
      if (epoch === sessionEpoch.current) setLearnerState(state);
    } catch {
      // 401 already clears the session via the API client; ignore other errors here
    } finally {
      if (epoch === sessionEpoch.current) setStateLoading(false);
    }
  }, []);

  const refreshGraph = useCallback(async (rid: string) => {
    const epoch = sessionEpoch.current;
    setGraphLoading(true);
    try {
      const next = await api.learnerKnowledgeGraph(rid);
      if (epoch === sessionEpoch.current) setGraph(next);
    } catch {
      // the dashboard / map render their own error states
    } finally {
      if (epoch === sessionEpoch.current) setGraphLoading(false);
    }
  }, []);

  const refreshRecommendations = useCallback(async (rid: string) => {
    const epoch = sessionEpoch.current;
    setRecommendationsLoading(true);
    setRecommendationsError(null);
    try {
      const next = await api.recommendations(rid);
      if (epoch === sessionEpoch.current) {
        setRecommendations(next);
        setRecommendationsError(null);
      }
    } catch (err) {
      // recommendations are advice, not facts — a failure here must not break
      // the measured panels; the card renders its own honest error state
      if (epoch === sessionEpoch.current) {
        setRecommendationsError(err instanceof Error ? err.message : "unavailable");
      }
    } finally {
      if (epoch === sessionEpoch.current) setRecommendationsLoading(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    const epoch = sessionEpoch.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const next = await api.learnerAttempts();
      if (epoch === sessionEpoch.current) setHistory(next);
    } catch (err) {
      // history is a convenience surface — a failure must not break the app;
      // the view renders its own honest error state
      if (epoch === sessionEpoch.current) {
        setHistoryError(err instanceof Error ? err.message : "unavailable");
      }
    } finally {
      if (epoch === sessionEpoch.current) setHistoryLoading(false);
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
        setSubjectsList(subjects.filter((s) => s.knowledgeNodeId));
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

  // Switching subject switches the whole workbench: graph, recommendations
  // and practice all re-scope to the selected subject's KG root.
  const handleSelectSubject = useCallback(
    (knowledgeNodeId: string) => {
      if (knowledgeNodeId === rootId) return;
      const subject = subjectsList.find((s) => s.knowledgeNodeId === knowledgeNodeId);
      setRootId(knowledgeNodeId);
      setSubjectName(subject?.name ?? null);
      setPracticeTopic(null);
      refreshGraph(knowledgeNodeId);
      refreshRecommendations(knowledgeNodeId);
      refreshState();
    },
    [rootId, subjectsList, refreshGraph, refreshRecommendations, refreshState],
  );

  // After an attempt all read models change server-side (BKT + decay view +
  // the evidence the next-best actions rank from + the history record itself).
  const handleAttemptSubmitted = useCallback(() => {
    refreshState();
    refreshHistory();
    setLessonRefreshKey((k) => k + 1);   // Smart Lesson re-queries on new evidence
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
      <div className="flex min-h-screen flex-col bg-muted/40">
        <BackendStatus />
        <LoginView
          onAuthenticated={(session) => {
            setSession(session);
            setAuth(session);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <BackendStatus />
      <AppHeader
        user={auth.user}
        subjects={subjectsList}
        selectedRootId={rootId}
        onSelectSubject={handleSelectSubject}
        onLogout={() => {
          clearSession();
          resetSessionState();
        }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 scroll-mt-16 px-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList
            className={`mb-4 grid w-full ${isTeacher ? "grid-cols-12" : "grid-cols-11"}`}
          >
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="lesson" className="gap-1.5">
              <Compass className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Smart lesson</span>
            </TabsTrigger>
            <TabsTrigger value="practice" className="gap-1.5">
              <GraduationCap className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Practice</span>
            </TabsTrigger>
            <TabsTrigger value="exam" className="gap-1.5">
              <ScrollText className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Exam Questions</span>
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-1.5">
              <ClipboardList className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </TabsTrigger>
            <TabsTrigger value="papers" className="gap-1.5">
              <FileText className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Papers</span>
            </TabsTrigger>
            <TabsTrigger value="notes" className="gap-1.5">
              <BookOpen className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Notes</span>
            </TabsTrigger>
            <TabsTrigger value="tutor" className="gap-1.5">
              <MessagesSquare className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Tutor</span>
            </TabsTrigger>
            <TabsTrigger value="assistant" className="gap-1.5">
              <Sparkles className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Assistant</span>
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
          <TabsContent value="lesson">
            <SmartLessonView
              graph={graph}
              rootId={rootId}
              subjectName={subjectName}
              refreshKey={lessonRefreshKey}
              onPracticeTopic={onPracticeTopic}
              onAskTutorAbout={onAskTutorAbout}
            />
          </TabsContent>
          <TabsContent value="practice">
            <PracticeView
              onAttemptSubmitted={handleAttemptSubmitted}
              topicNodeId={practiceTopic?.nodeId ?? null}
              topicTitle={practiceTopic?.title ?? null}
              rootId={rootId}
              subjectName={subjectName}
              onClearTopic={() => setPracticeTopic(null)}
              onAskTutorAbout={onAskTutorAbout}
            />
          </TabsContent>
          <TabsContent value="exam">
            <ExamQuestionsView
              rootId={rootId}
              graph={graph}
              history={history}
              subjectName={subjectName}
              onAttemptSubmitted={handleAttemptSubmitted}
              onAskTutorAbout={onAskTutorAbout}
            />
          </TabsContent>
          <TabsContent value="history">
            <HistoryView
              history={history}
              loading={historyLoading}
              error={historyError}
              onPracticeTopic={onPracticeTopic}
              graph={graph}
            />
          </TabsContent>
          <TabsContent value="papers">
            <PapersView
              subjects={subjectsList}
              selectedSubjectId={
                subjectsList.find((s) => s.knowledgeNodeId === rootId)?.id ?? null
              }
            />
          </TabsContent>
          <TabsContent value="notes">
            <RevisionNotesView />
          </TabsContent>
          <TabsContent value="tutor">
            <TutorChatView
              messages={tutorMessages}
              setMessages={setTutorMessages}
              draft={tutorDraft}
              onDraftConsumed={() => setTutorDraft(null)}
            />
          </TabsContent>
          <TabsContent value="assistant">
            <ClaAssistantView
              messages={claMessages}
              setMessages={setClaMessages}
              rootId={rootId}
              topicOptions={assistantTopics}
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
              graph={graph}
            />
          </TabsContent>
          {isTeacher && (
            <TabsContent value="teacher">
              <TeacherReviewView subjects={subjectsList} rootId={rootId} />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <footer className="border-t bg-background">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground">
          <span>SyllabAI — research prototype (Cycle 1 pilot)</span>
          <span>
            BKT · BDT misconception tracking · Ebbinghaus decay · Edexcel IGCSE Chemistry
          </span>
        </div>
      </footer>
    </div>
  );
}
