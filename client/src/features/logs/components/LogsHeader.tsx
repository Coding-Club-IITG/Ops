"use client";

import { Zap, Bell, Download } from "lucide-react";

interface LogsHeaderProps {
  onCreateOptimizer?: () => void;
  onCreateAlert?: () => void;
  onExport?: () => void;
}

export function LogsHeader({
  onCreateOptimizer,
  onCreateAlert,
  onExport,
}: LogsHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between py-5 px-6">
      {/* Left — page title */}
      <div>
        <h1 className="mt-[4rem] md:mt-[0rem] mb-[0.8rem] md:text-[1.5rem] text-[1.2rem] page-title font-bold">Log Analytics</h1>
        <p className="mt-[10px] mb-[10px] md:text-[0.9375rem] text-[0.7rem] body-text text-muted mt-0.5 text-sm">
          Monitoring real-time production traffic and system events
        </p>
      </div>

      {/* Right — actions */}
      <div className="flex flex-wrap justify-center items-center gap-2 mt-1">

        <div>
          <button
          className="mr-[10px] btn-primary text-[0.6rem] md:text-[0.875rem] flex w-[140px] h-[40px] text-xs md:w-45 md:text-sm h-10 items-center gap-2"
          onClick={onCreateOptimizer}>
          <Zap size={14} strokeWidth={2.5} />
          Create Optimizer
        </button>

        <button
          className="btn-secondary md:text-[0.875rem] text-[0.6rem] flex w-[120px] h-[40px] md:w-40 items-center gap-2 ghost-border"
          onClick={onCreateAlert}>
          <Bell size={14} strokeWidth={2} />
          Create Alert
        </button>
        </div>

        <div>
          <button
          className="btn-secondary md:text-[0.875rem] text-[0.6rem] text-center w-[150px] flex items-center gap-2 ghost-border"
          onClick={onExport}>
          <Download size={14} strokeWidth={2} />
          Export
        </button>
        </div>
      </div>
    </div>
  );
}
