"use client";

// Lightweight reviewer identity, persisted to localStorage. Stands in for full
// Supabase Auth (which can be wired in later — see README "Multi-user / Auth").
// Every audit is tagged with the active reviewer for dashboard attribution.

import { createContext, useContext, useEffect, useState } from "react";

const KEY = "dealerqa.reviewer";

const ReviewerContext = createContext<{
  reviewer: string;
  setReviewer: (name: string) => void;
}>({ reviewer: "", setReviewer: () => {} });

export function ReviewerProvider({ children }: { children: React.ReactNode }) {
  const [reviewer, setReviewerState] = useState("");

  useEffect(() => {
    setReviewerState(localStorage.getItem(KEY) || "QA Reviewer");
  }, []);

  const setReviewer = (name: string) => {
    setReviewerState(name);
    localStorage.setItem(KEY, name);
  };

  return (
    <ReviewerContext.Provider value={{ reviewer, setReviewer }}>
      {children}
    </ReviewerContext.Provider>
  );
}

export const useReviewer = () => useContext(ReviewerContext);
