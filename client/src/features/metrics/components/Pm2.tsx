import React from 'react';
import {
    RefreshCw,
    Database,
    Square
} from 'lucide-react';

interface PM2Props {
    data: any;
    handleRestart: (name: string) => void;
    handleRestartAll: () => void;
    handleStop: (name: string) => void;
}

export function PM2({ data, handleRestart, handleRestartAll, handleStop }: PM2Props) {
    return (
        <div className="col-span-12 rounded-md ghost-border surface-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between px-8 py-6 border-b border-surface-container-low">
                <div className="flex items-center gap-3">
                    <Database size={18} className="text-muted" />
                    <span className="section-title text-sm uppercase tracking-wider">PM2 Process Manager</span>
                </div>
                <button 
                    onClick={handleRestartAll} 
                    className="btn-secondary text-[10px] uppercase font-bold tracking-widest hover:text-primary transition-all"
                >
                    Restart All
                </button>
            </div>

            <div className='overflow-x-auto'>
                <table className="w-full text-left">
                <thead>
                    <tr className="table-header-row bg-surface-low/30">
                        <th className="table-header-cell px-8 py-4 text-[10px] uppercase tracking-widest">Process Name</th>
                        <th className="table-header-cell text-[10px] uppercase tracking-widest">Status</th>
                        <th className="table-header-cell text-[10px] uppercase tracking-widest">Restarts</th>
                        <th className="table-header-cell text-right text-[10px] uppercase tracking-widest">CPU</th>
                        <th className="table-header-cell text-right text-[10px] uppercase tracking-widest">Memory</th>
                        <th className="table-header-cell text-right px-8 text-[10px] uppercase tracking-widest">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-surface-container-low/50">
                    {data?.processes.map((proc: any) => (
                        <tr key={proc.pid} className="hover:bg-surface-low/40 transition-colors group">
                            <td className="px-8 py-4">
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${proc.status === 'online' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-error'}`} />
                                    <span className="text-xs font-bold">{proc.name}</span>
                                </div>
                            </td>
                            <td>
                                <span className={`chip text-[9px] uppercase font-black px-2 py-0.5 border ${proc.status === 'online' ? 'bg-success/10 text-success border-success/20' : 'bg-error/10 text-error border-error/20'}`}>
                                    {proc.status}
                                </span>
                            </td>
                            <td className="text-xs text-muted font-bold">{proc.restartCount}</td>
                            <td className="text-right text-xs font-bold text-primary">{proc.cpuUsage}%</td>
                            <td className="text-right text-xs font-bold">{proc.memoryUsage} MB</td>
                            
                            {/* Updated Actions Column */}
                            <td className="text-right px-8">
                                <div className="flex justify-end gap-2 opacity-40 group-hover:opacity-100 transition-all">
                                    <button 
                                        onClick={() => handleRestart(proc.name)} 
                                        className="btn-icon p-2 hover:bg-primary/10 rounded-full transition-all text-primary"
                                        title="Restart"
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                    <button 
                                        onClick={() => handleStop(proc.name)} 
                                        className="btn-icon p-2 hover:bg-error/10 rounded-full transition-all text-error"
                                        title="Stop"
                                    >
                                        <Square size={14} fill="currentColor" fillOpacity={0.2} />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            </div>
            
            <div className="px-8 py-4 bg-surface-low/20 border-t border-surface-container-low flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-muted">
                <span>{data?.processes.length || 0} Active PM2 Instances</span>
                <div className="flex gap-6">
                    <span>Total CPU: {data?.cpu.currentUsage}%</span>
                    <span>Total Mem: {data?.memory.currentUsed} GB</span>
                </div>
            </div>
        </div>
    );
}