import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Cpu,
} from 'lucide-react';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend,
    ChartOptions,
    ScriptableContext
} from 'chart.js';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend
);

interface CPUUsageProps {
    data: any;
    globalOptions: ChartOptions<'line'>;
}

export function CPUUsage({ data, globalOptions }: CPUUsageProps){
    const cpuChartData = useMemo(() => {
        const history = data?.cpu?.history || [];
        return {
            labels: history.map((h: any) => h.timestamp),
            datasets: [{
            fill: true,
            data: history.map((h: any) => h.usage),
            borderColor: '#0052cc',
            borderWidth: 2,
            tension: 0.4,
            pointRadius: 0,
            backgroundColor: (context: ScriptableContext<'line'>) => {
                const ctx = context.chart.ctx;
                const gradient = ctx.createLinearGradient(0, 0, 0, 100);
                gradient.addColorStop(0, 'rgba(0, 82, 204, 0.12)');
                gradient.addColorStop(1, 'rgba(0, 82, 204, 0)');
                return gradient;
            },
            }]
        };
    }, [data?.cpu?.history]);
    return(
    <>
    <div className="overflow-hidden col-span-8 rounded-md ghost-border surface-card flex flex-col flex-wrap min-h-[380px]">
        <div className="p-8 w-full flex-1">
        <div className="flex flex-col md:flex-row justify-between items-start mb-8">
            <div className="flex items-center gap-3">
            <div className="rounded-md surface-low p-2.5 text-primary">
                <Cpu size={20} />
            </div>
            <span className="section-title text-sm uppercase tracking-wider">CPU Usage</span>
            </div>
            <div className="text-right">
            <div className="metric align-center text-4xl font-bold mt-[20px]">{data?.cpu.currentUsage}%</div>
            <div className="label-sm opacity-60">Avg: {data?.cpu.averageUsage}%</div>
            <div className="label-sm opacity-60">Load Average: {data?.cpu.loadAverage}</div>
            </div>
        </div>

        <div className="flex flex-col md:grid grid-cols-2 gap-12">
            <div>
            <p className="label-sm mb-4">Core Distribution</p>
            <div className="md:grid md:grid-cols-2 flex flex-col gap-x-8 gap-y-3">
                {data?.cpu.cores.map((core: any) => (
                <div key={core.id}>
                    <div className="flex justify-between text-[10px] font-bold mb-1">
                    <span className="text-muted">Core {core.id}</span>
                    <span>{core.usage}%</span>
                    </div>
                    <div className="h-1 w-full rounded-full surface-low overflow-hidden">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${core.usage}%` }} />
                    </div>
                </div>
                ))}
            </div>
            </div>
            <div className="card-workspace min-w-full rounded-md p-4">
            <p className="label-sm mb-4">Top Processes</p>
            {data?.cpu.topProcesses.map((p: any) => (
                <div key={p.pid} className="flex flex-wrap justify-between mb-3 group">
                    <div className="flex flex-col">
                        <span className="text-xs font-bold truncate max-w-[120px]">{p.name}</span>
                        <span className="text-[9px] text-muted opacity-40 font-mono">PID: {p.pid}</span>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <div className="h-1 w-12 rounded-full bg-surface-low overflow-hidden hidden md:block">
                            <div 
                                className="h-full bg-primary/50" 
                                style={{ width: `${Math.min(p.cpu, 100)}%` }} 
                            />
                        </div>
                        <span className="text-xs font-black text-primary">{p.cpu}%</span>
                    </div>
                </div>
            ))}
            </div>
        </div>
        </div>

        <div className='w-full overflow-x-auto whitespace-nowrap'>
        <div className="h-50 min-w-[800px]">
        <Line data={cpuChartData} options={globalOptions} />
        </div>
    </div>
    </div>

   
    </>)
}