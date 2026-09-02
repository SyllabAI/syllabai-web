"use client";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, LogOut } from "lucide-react";
import type { UserView } from "@/lib/types";

interface AppHeaderProps {
  user: UserView;
  onLogout: () => void;
}

export function AppHeader({ user, onLogout }: AppHeaderProps) {
  const initials = user.displayName
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold">SyllabAI</p>
            <p className="text-xs text-muted-foreground">IAL Chemistry · Cycle 1</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
