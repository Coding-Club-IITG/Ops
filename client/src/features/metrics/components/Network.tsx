import {
    Activity,
} from 'lucide-react';


import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
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

interface NetworkProps {
    data: any;
    globalOptions: ChartOptions<'line'>;
}

export function Network({ data, globalOptions }: NetworkProps){
    const networkChartData = useMemo(() => {
        const history = data?.network?.history || [];
        return {
            labels: history.map((h: any) => h.timestamp),
            datasets: [
                {
                label: 'RX',
                data: history.map((h: any) => h.rx),
                borderColor: '#003d9b',
                borderWidth: 2,
                tension: 0.4,
                pointRadius: 0,
                },
                {
                label: 'TX',
                data: history.map((h: any) => h.tx),
                borderColor: '#a3aac4',
                borderWidth: 1.5,
                borderDash: [4, 4],
                tension: 0.4,
                pointRadius: 0,
                }
            ]
            };
        }, [data?.network?.history]);

    return(
    <div className="col-span-6 rounded-md ghost-border surface-card flex flex-col flex-wr overflow-hidden">
        <div className="p-8 pb-0 flex-1">
        <div className="flex flex-wrap justify-between items-center mb-8">
            <div className="flex items-center gap-3">
            <div className="rounded-md surface-low p-2.5 text-primary">
                <Activity size={20} />
            </div>
            <span className="section-title text-sm uppercase tracking-wider">Network Traffic</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Interface: en0</span>
        </div>
        
        <div className="flex flex-wrap md:grid md:grid-cols-2 gap-8 mb-6">
            <div>
            <p className="label-sm opacity-60">Read (Incoming)</p>
            <p className="text-2xl font-black text-primary">{data?.network.currentRx || '0'} KB/s</p>
            </div>
            <div>
            <p className="label-sm opacity-60">Write (Outgoing)</p>
            <p className="text-2xl font-black text-on-surface">{data?.network.currentTx || '0'} KB/s</p>
            </div>
            <div className="label-sm opacity-60">Interface: {data?.network.interfaceName}</div>
            <div className="label-sm opacity-60">Active Connections: {data?.network.activeConnections}</div>
            <div className="label-sm opacity-60">Dropped Packets: {data?.network.droppedPackets}</div>
            <div className="label-sm opacity-60 text-red-500">Errors: {data?.network.errors}</div>
        </div>
        </div>
        <div className='overflow-x-auto'>
            <div className="h-20 min-w-[800px] border-t border-surface-container-low">
            <Line 
            data={{
            ...networkChartData,
            datasets: [
                { ...networkChartData.datasets[0], label: 'Read' },
                { ...networkChartData.datasets[1], label: 'Write' }
            ]
            }} 
            options={globalOptions} 
        />
        </div>
        </div>
    </div>)
}