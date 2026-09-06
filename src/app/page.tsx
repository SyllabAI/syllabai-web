"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppHeader } from "@/components/syllabai/AppHeader";
import { LoginView } from "@/components/syllabai/LoginView";
import { DashboardView } from "@/components/syllabai/DashboardView";
import { MasteryMap } from "@/components/syllabai/MasteryMap";
import { PracticeView } from "@/components/syllabai/PracticeView";
import { StateView } from "@/components/syllabai/StateView";
import { TutorChatView, type TutorChatMessage } from "@/components/syllabai/TutorChatView";
import { clearSession, api, currentUser, getToken, setSession } from "@/lib/api";
import type { AuthResponse, LearnerKnowledgeGraphView, LearnerStateView } from "@/lib/types";
import { TeacherReviewView } from "@/components/syllabai/TeacherReviewView";
import {
  Brain,
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
  // Controlled tabs so dashboard/map can deep-link into practice with a topic.
  const [tab, setTab] = useState("dashboard");
  const [practiceTopic, setPracticeTopic] = useState<{ nodeId: string; title: string } | null>(
    null,
  );
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

  // Load learner state + the personalized knowledge graph whenever a session exists.
  useEffect(() => {
    if (!auth) return;
    refreshState();
    let cancelled = false;
    (async () => {
      try {
        const subjects = await api.subjects();
        const withNode = subjects.find((s) => s.knowledgeNodeId);
        if (withNode?.knowledgeNodeId && !cancelled) {
          setRootId(withNode.knowledgeNodeId);
          setSubjectName(withNode.name);
          refreshGraph(withNode.knowledgeNodeId);
        }
      } catch {
        // dashboard/map show their own error state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, refreshState, refreshGraph]);

  // After an attempt both read models change server-side (BKT + decay view).
  const handleAttemptSubmitted = useCallback(() => {
    refreshState();
    if (rootId) refreshGraph(rootId);
  }, [refreshState, refreshGraph, rootId]);

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
          setTab("dashboard");
        }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 scroll-mt-16 px-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList
            className={`mb-4 grid w-full ${isTeacher ? "grid-cols-6" : "grid-cols-5"}`}
          >
            <TabsTrigger value="dashboard" className="gap-1.5">
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="practice" className="gap-1.5">
              <GraduationCap className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Practice</span>
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
              onPracticeTopic={onPracticeTopic}
              onOpenMap={() => setTab("map")}
            />
          </TabsContent>
          <TabsContent value="practice">
            <PracticeView
              onAttemptSubmitted={handleAttemptSubmitted}
              topicNodeId={practiceTopic?.nodeId ?? null}
              topicTitle={practiceTopic?.title ?? null}
              onClearTopic={() => setPracticeTopic(null)}
            />
          </TabsContent>
          <TabsContent value="tutor">
            <TutorChatView messages={tutorMessages} setMessages={setTutorMessages} />
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
