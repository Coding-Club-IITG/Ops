import React from 'react';
import { Layers } from 'lucide-react';

interface MemoryProps {
    data: any;
}

export function DiskIO({ data }: MemoryProps) {
    const totalMem = data?.memory.total || 1;
    // Get history for the chart
    const history = data?.disk?.history || [];

    return (
        <div className="col-span-4 rounded-md ghost-border surface-card p-8 flex flex-col">
            <div className="flex flex-wrap items-center justify-between mb-8 w-full">
                <div className="flex items-center gap-3">
                    <div className="rounded-md surface-low p-2.5 text-primary">
                        <Layers size={20} />
                    </div>
                    <span className="section-title text-sm uppercase tracking-wider">Disk I/O</span>
                </div>

                <div className="flex gap-4 text-[10px] font-bold text-primary uppercase whitespace-nowrap">
                    <span>↓ {data?.disk?.currentRead.toFixed(1) || '0'} KB/s</span>
                    <span>↑ {data?.disk?.currentWrite.toFixed(1) || '0'} KB/s</span>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4 p-3 rounded surface-low border border-outline-variant/20">
                <div className="flex flex-col">
                    <span className="text-[9px] uppercase text-muted font-bold">Total IO Wait</span>
                    <span className={`text-sm font-mono ${data?.disk.ioWaitPercent > 10 ? 'text-red-500' : 'text-primary'}`}>
                        {data?.disk.ioWaitPercent}%
                    </span>
                </div>
                <div className="flex flex-col border-l border-outline-variant/30 pl-2">
                    <span className="text-[9px] uppercase text-muted font-bold">Read Wait</span>
                    <span className="text-sm font-mono">{data?.disk.readWait}ms</span>
                </div>
                <div className="flex flex-col border-l border-outline-variant/30 pl-2">
                    <span className="text-[9px] uppercase text-muted font-bold">Write Wait</span>
                    <span className="text-sm font-mono">{data?.disk.writeWait}ms</span>
                </div>
            </div>

            <div className="mt-8">
                <p className="label-sm opacity-60 uppercase mb-4">Read/Write History</p>
                <div className="flex gap-3 h-32">
                    {/* Y-AXIS (Speed) */}
                    <div className="flex flex-col justify-between text-[8px] font-bold text-muted uppercase h-24 py-1">
                        <span>Max</span>
                        <span>Mid</span>
                        <span>0K</span>
                    </div>

                    <div className="flex-1 flex flex-col">
                        <div className='overflow-x-auto'>
                            <div className='h-50 min-w-[800px]'>
                                {/* CHART AREA */}
                        <div className="h-24 flex items-end gap-1 border-l border-b border-outline-variant/30 px-1 relative">
                            {history.length ? history.map((h: any, i: number) => (
                                <div key={i} className="w-4 shrink-0 flex items-end h-full gap-[1px]">
                                    {/* Read Bar (Green-ish) */}
                                    <div 
                                        className="flex-1 bg-emerald-500/40 rounded-t-[1px]" 
                                        style={{ height: `${Math.min((h.readSpeed / 500) * 100, 100)}%` }}
                                    />
                                    {/* Write Bar (Red-ish) */}
                                    <div 
                                        className="flex-1 bg-rose-500/40 rounded-t-[1px]" 
                                        style={{ height: `${Math.min((h.writeSpeed / 500) * 100, 100)}%` }}
                                    />
                                </div>
                            )) : (
                                <div className="w-full h-full flex items-center justify-center text-[8px] text-muted">NO DATA</div>
                            )}
                        </div>
                        
                        {/* X-AXIS (Time) */}
                        <div className="flex justify-between mt-2 text-[8px] font-bold text-muted uppercase px-1">
                            <span>{history[0]?.timestamp || 'Start'}</span>
                            <span>{history[history.length - 1]?.timestamp || 'Now'}</span>
                        </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}