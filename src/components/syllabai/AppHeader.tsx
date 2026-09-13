"use client";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GraduationCap, LogOut } from "lucide-react";
import type { SubjectView, UserView } from "@/lib/types";

interface AppHeaderProps {
  user: UserView;
  /** Subjects with a KG root — the selector appears only when more than one exists. */
  subjects?: SubjectView[];
  selectedRootId?: string | null;
  onSelectSubject?: (knowledgeNodeId: string) => void;
  onLogout: () => void;
}

export function AppHeader({ user, subjects, selectedRootId, onSelectSubject, onLogout }: AppHeaderProps) {
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const selectable = (subjects ?? []).filter((s) => s.knowledgeNodeId);

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">SyllabAI</p>
            <p className="text-xs text-muted-foreground">IGCSE Chemistry · Cycle 1</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {selectable.length > 1 && onSelectSubject && selectedRootId && (
            <Select value={selectedRootId} onValueChange={onSelectSubject}>
              <SelectTrigger
                size="sm"
                className="w-[190px] gap-1 text-xs"
                aria-label="Subject"
              >
                <SelectValue placeholder="Subject" />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((s) => (
                  <SelectItem key={s.knowledgeNodeId ?? s.id} value={s.knowledgeNodeId ?? s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="hidden items-center gap-2 sm:flex">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{initials || "?"}</AvatarFallback>
            </Avatar>
            <div className="leading-tight">
              <p className="text-sm font-medium">{user.displayName}</p>
              <div className="flex gap-1">
                {user.roles.slice(0, 2).map((role) => (
                  <Badge key={role} variant="outline" className="px-1.5 py-0 text-[10px]">
                    {role}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onLogout} aria-label="Sign out">
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
