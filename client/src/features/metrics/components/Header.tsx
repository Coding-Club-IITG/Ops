import React from 'react';
import {
    Clock
} from 'lucide-react';
import { TimeRange } from '@/types/metrics.types';

interface HeaderProps {
    data: any;
    range: TimeRange;
    ranges: TimeRange[];
    setRange: (range: TimeRange)=> void;
}

export function HeaderCPU({ data, range, ranges, setRange }: HeaderProps){
    
    return(
    <div className="mb-10 flex flex-wrap items-end justify-between ml-[-10px] border-b border-outline-variant pb-6">
    <div>
        <h1 className="page-title mt-[4rem] md:mt-[0rem] text-3xl font-bold">System Metrics</h1>
        <p className="body-text text-muted">Performance for range: <span className="text-primary font-bold">{range}</span></p>
    </div>

    <div className="flex flex-wrap flex-col items-end gap-4">
        <div className="flex items-center bg-surface-low/50 rounded-md p-1 border border-outline-variant/30">
        {ranges.map((r) => (
            <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-all rounded-sm ${
                range === r ? 'bg-surface-card text-primary shadow-sm' : 'text-muted hover:text-on-surface'
            }`}
            >
            {r}
            </button>
        ))}
        </div>

        <div className="flex items-center justify-left gap-8 label">
        <div className="flex items-center gap-2.5 text-[10px] uppercase font-bold tracking-widest">
            <span className="pulse" />
            <span className="text-success">Health: {data?.status}</span>
        </div>
        <div className="text-muted flex items-center gap-2 text-[10px] uppercase font-bold tracking-widest">
            <Clock size={12} /> Uptime: {data?.uptime}
        </div>
        </div>
    </div>
    </div>)
}