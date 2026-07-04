'use client';
import React from 'react';

import {
  Chart as ChartJS,
  ChartOptions,
} from 'chart.js';


import { useMetrics } from '@/features/metrics/hooks/useMetrics';
import { TimeRange } from '@/types/metrics.types';
import { CPUUsage } from '@/features/metrics/components/CPUUsage';
import { DiskIO } from '@/features/metrics/components/DiskIO';
import { Memory } from '@/features/metrics/components/Memory';
import { Network } from '@/features/metrics/components/Network';
import { PM2 } from '@/features/metrics/components/Pm2';
import { HeaderCPU } from '@/features/metrics/components/Header';


export default function MetricsPage() {
  const { data, loading, range, setRange, handleRestart, handleRestartAll, handleStop } = useMetrics();
  
  const ranges: TimeRange[] = ['1h', '6h', '24h', '7d', '30d'];

  const globalOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: true },
      y: { display:true , min: 0 }
    },
    layout: {
      padding: { left: 0, right: 0, bottom: 0, top: 5 }
    },
    interaction: { intersect: false, mode: 'index' }
  };


  if (loading && !data) {
    return (
      <div className="flex h-screen w-full items-center justify-center surface-base">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="label-sm tracking-[0.3em]">Loading Cluster Data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full surface-base px-10 py-8">
      <HeaderCPU data={data} range={range} ranges={ranges} setRange={setRange} />

      <div className="w-full flex flex-col md:block gap-6">
        
        <div className='mb-[10px]'><CPUUsage data={data} globalOptions={globalOptions} /></div>

        <div className='mb-[10px]'><DiskIO data={data} /></div>

        <div className='mb-[10px]'><Memory data={data} /></div>

        <div className='mb-[10px]'><Network data={data} globalOptions={globalOptions} /></div>

        <PM2 data={data} handleRestart={handleRestart} handleRestartAll={handleRestartAll} handleStop={handleStop} />

      </div>
    </div>
  );
}