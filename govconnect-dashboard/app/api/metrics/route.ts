/**
 * Prometheus Metrics API Route
 * 
 * Exposes basic metrics for the Next.js dashboard
 */
import { NextResponse } from 'next/server';

// Basic metrics for Next.js app
const metrics = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    memory: process.memoryUsage(),
};

export async function GET() {
    const prometheusMetrics = `
# HELP govconnect_dashboard_uptime_seconds Dashboard uptime in seconds
# TYPE govconnect_dashboard_uptime_seconds gauge
govconnect_dashboard_uptime_seconds{service="dashboard"} ${metrics.uptime}

# HELP govconnect_dashboard_memory_heap_used_bytes Dashboard heap memory used
# TYPE govconnect_dashboard_memory_heap_used_bytes gauge
govconnect_dashboard_memory_heap_used_bytes{service="dashboard"} ${process.memoryUsage().heapUsed}

# HELP govconnect_dashboard_memory_heap_total_bytes Dashboard total heap memory
# TYPE govconnect_dashboard_memory_heap_total_bytes gauge
govconnect_dashboard_memory_heap_total_bytes{service="dashboard"} ${process.memoryUsage().heapTotal}

# HELP govconnect_dashboard_memory_rss_bytes Dashboard RSS memory
# TYPE govconnect_dashboard_memory_rss_bytes gauge
govconnect_dashboard_memory_rss_bytes{service="dashboard"} ${process.memoryUsage().rss}
`.trim();

    return new NextResponse(prometheusMetrics, {
        headers: {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        },
    });
}
