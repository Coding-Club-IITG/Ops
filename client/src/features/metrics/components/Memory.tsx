import {
    HardDrive,
    AlertTriangle,
} from 'lucide-react';

interface StorageProps {
    data: any;
}

export function Memory({ data}: StorageProps){
    const totalMem = data?.memory.total || 1;
    const history = data?.memory.history || [];
    
    return(
    <div className="col-span-6 rounded-md ghost-border surface-card p-8">
        <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
            <div className="rounded-md surface-low p-2.5 text-primary">
            <HardDrive size={20} />
            </div>
            <span className="section-title text-sm uppercase tracking-wider">Memory Utilization</span>
        </div>
        </div>
        
        <div className="space-y-6">
            <div className="flex items-baseline gap-2 mb-2">
                <span className="metric text-5xl text-[1em] md:text-[2.25em] font-bold">{data?.memory.currentUsed}</span>
                <span className="section-title text-muted">/ {totalMem} GB</span>
            </div>
        <div className="p-4 rounded-md border border-error/20 bg-error/5">
            <div className="flex justify-between text-xs font-bold text-error mb-2">
                <span className="flex items-center gap-2">Memory Used</span>
                <span>{Math.round((data?.memory.currentUsed / totalMem) * 100)}%</span>
                </div>
                    <div className="h-2 w-full rounded-full surface-low overflow-hidden border border-error/10">
                    <div className="h-full bg-error" style={{ width: `${(data?.memory.currentUsed / totalMem) * 100}%` }} />
                </div>
            </div>
        </div>
        <div className="mt-auto">
            <p className="label-sm opacity-60 uppercase mb-4">Usage History</p>
            
            {/* Main Chart Container with Y-Axis */}
            <div className="flex flex-row gap-3 h-32">
                <div className="flex flex-col justify-between text-[8px] font-bold text-muted uppercase h-24 py-1">
                    <span>{totalMem}G</span>
                    <span>{Math.round(totalMem / 2)}G</span>
                    <span>0G</span>
                </div>

                <div className='overflow-x-auto'>
                    <div className='h-30 min-w-[800px]'>
                        {/* Bar Chart Area */}
                <div className="flex-1 flex flex-col">
                    <div className="h-24 flex items-end gap-1 border-l border-b border-outline-variant/30 px-1">
                        {history.length ? history.map((h: any, i: number) => (
                            <div 
                                key={i} 
                                className="flex w-4 rounded-t-sm bg-primary opacity-30 hover:opacity-100 transition-opacity" 
                                style={{ height: `${(h.used / totalMem) * 100}%` }} 
                                title={`${h.used} GB at ${h.timestamp}`}
                            />
                        )) : (
                            <div className="w-full h-full border border-dashed border-outline-variant flex items-center justify-center text-[8px] text-muted uppercase">
                                No History Data
                            </div>
                        )}
                    </div>
                    
                    {/* X-Axis Labels */}
                    <div className="flex justify-between mt-2 text-[8px] font-bold text-muted uppercase px-1">
                        <span>{history[0]?.timestamp || 'Start'}</span>
                        <span>{history[Math.floor(history.length / 2)]?.timestamp || ''}</span>
                        <span>{history[history.length - 1]?.timestamp || 'Now'}</span>
                    </div>
                    </div>
                </div>
                </div>
            </div>

            <p className="label-sm opacity-60 uppercase mt-6">Pressure: {data?.memory.pressure}</p>
        </div>

    </div>
    )
}