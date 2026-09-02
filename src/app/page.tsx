"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppHeader } from "@/components/syllabai/AppHeader";
import { LoginView } from "@/components/syllabai/LoginView";
import { MasteryMap } from "@/components/syllabai/MasteryMap";
import { PracticeView } from "@/components/syllabai/PracticeView";
import { StateView } from "@/components/syllabai/StateView";
import { clearSession, api, currentUser, getToken, setSession } from "@/lib/api";
import type { AuthResponse, LearnerStateView, NodeView } from "@/lib/types";
import { Brain, GraduationCap, LineChart } from "lucide-react";

function collectTitles(node: NodeView, acc: Record<string, string>) {
  acc[node.id] = node.title;
  for (const child of node.children) collectTitles(child, acc);
}

export default function SyllabAiWorkbench() {
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [learnerState, setLearnerState] = useState<LearnerStateView | null>(null);
  const [stateLoading, setStateLoading] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});

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

  // Load learner state + node titles whenever a session exists.
  useEffect(() => {
    if (!auth) return;
    refreshState();
    let cancelled = false;
    (async () => {
      try {
        const subjects = await api.subjects();
        const withNode = subjects.find((s) => s.knowledgeNodeId);
        if (withNode?.knowledgeNodeId && !cancelled) {
          const tree = await api.knowledgeTree(withNode.knowledgeNodeId, true);
          const acc: Record<string, string> = {};
          collectTitles(tree, acc);
          if (!cancelled) setTitles(acc);
        }
      } catch {
        // mastery map shows its own error state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, refreshState]);

  const misconceptionTitles = useMemo(() => titles, [titles]);

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
        }}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 scroll-mt-16 px-4 py-6">
        <Tabs defaultValue="practice" className="w-full">
          <TabsList className="mb-4 grid w-full grid-cols-3">
            <TabsTrigger value="practice" className="gap-1.5">
              <GraduationCap className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Practice</span>
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5">
              <Brain className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Mastery map</span>
            </TabsTrigger>
            <TabsTrigger value="state" className="gap-1.5">
              <LineChart className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">My state</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="practice">
            <PracticeView onAttemptSubmitted={refreshState} />
          </TabsContent>
          <TabsContent value="map">
            <MasteryMap learnerState={learnerState} />
          </TabsContent>
          <TabsContent value="state">
            <StateView
              state={learnerState}
              loading={stateLoading}
              nodeTitles={titles}
              misconceptionTitles={misconceptionTitles}
            />
          </TabsContent>
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
