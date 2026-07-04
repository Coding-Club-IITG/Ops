import { type Request, type Response } from "express";
import {
  buildDeletePostgresQuery,
  buildPostgresQuery,
  getScaleConfig,
} from "./logs.utils.js";
import pool from "../../lib/db.js";

export async function getLogs(req: Request, res: Response) {
  const queries = req.query;
  const filters = {
    startDate: queries.startDate ? Number(queries.startDate) : undefined,
    endDate: queries.endDate ? Number(queries.endDate) : undefined,
    level: queries.level || null,
    endpoint: queries.endpoint || null,
    limit: queries.limit ? Number(queries.limit) : 100,
    offset: queries.offset ? Number(queries.offset) : 0,
    sort: (queries.sort as string) || "timestamp",
    order: (queries.order as string) || "desc",
    id: queries.id || null,
    method: queries.method || null,
    status_code: queries.status_code ? Number(queries.status_code) : null,
    message: queries.message || null,
    response_time_min: queries.response_time_min ? Number(queries.response_time_min) : 0,
    response_time_max: queries.response_time_max ? Number(queries.response_time_max) : 1e9,
  };

  const equalityFilters = {
    id: filters.id,
    url: filters.endpoint,
    method: filters.method,
    status_code: filters.status_code,
  };

  const inequalities: Record<string, { operator: string; value: any }> = {
    response_time: {
      operator: "BETWEEN",
      value: [filters.response_time_min, filters.response_time_max],
    },
  };

  if (filters.level) {
    inequalities["level"] = {
      operator: "ILIKE",
      value: filters.level,
    };
  }

  if (filters.message) {
    inequalities["message"] = {
      operator: "ILIKE",
      value: `%${filters.message}%`,
    };
  }

  if (filters.startDate && filters.endDate) {
    inequalities["timestamp"] = {
      operator: "BETWEEN",
      value: [
        new Date(filters.startDate),
        new Date(filters.endDate + 86399999),
      ],
    };
  } else if (filters.startDate) {
    inequalities["timestamp"] = {
      operator: ">=",
      value: new Date(filters.startDate),
    };
  } else if (filters.endDate) {
    inequalities["timestamp"] = {
      operator: "<=",
      value: new Date(filters.endDate + 86399999),
    };
  }

  const { query, values } = buildPostgresQuery(
    "*",
    equalityFilters,
    inequalities,
    filters.sort,
    filters.order,
    filters.limit,
    filters.offset,
    true, // withCount
  );

  try {
    const results = await pool.query(query, values);
    const rows = results.rows;
    const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
    res.json({ message: "Logs fetched successfully", data: rows, total });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function getLogsById(req: Request, res: Response) {
  const id = req.params.id;
  try {
    const result = await pool.query("SELECT * FROM server_logs WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Log not found" });
    }
    res.json({ message: "Log fetched successfully", data: result.rows[0] });
  } catch (error) {
    console.error("Error fetching log by ID:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function deleteLogsDefault(req: Request, res: Response) {
  try {
    //delete logs which are more than 30 days old
    await pool.query(
      "DELETE FROM server_logs WHERE timestamp < NOW() - INTERVAL '30 days'",
    );
    res.json({ message: "Old logs deleted successfully" });
  } catch (error) {
    console.error("Error deleting logs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function deleteLogsByFilter(req: Request, res: Response) {
  const queries = req.query;
  const filters = {
    startDate: queries.startDate || null,
    endDate: queries.endDate || null,
    level: queries.level || null,
    endpoint: queries.endpoint || null,
    method: queries.method || null,
    status_code: queries.status_code || null,
  };

  const equalityFilters: Record<string, any> = {
    url: filters.endpoint,
    method: filters.method,
    status_code: filters.status_code,
  };

  const inequalities: Record<string, { operator: string; value: any }> = {};

  if (filters.startDate && filters.endDate) {
    inequalities["timestamp"] = {
      operator: "BETWEEN",
      value: [
        new Date(Number(filters.startDate)),
        new Date(Number(filters.endDate) + 86399999),
      ],
    };
  } else if (filters.startDate) {
    inequalities["timestamp"] = {
      operator: ">=",
      value: new Date(Number(filters.startDate)),
    };
  } else if (filters.endDate) {
    inequalities["timestamp"] = {
      operator: "<=",
      value: new Date(Number(filters.endDate) + 86399999),
    };
  }

  if (filters.level) {
    inequalities["level"] = {
      operator: "ILIKE",
      value: filters.level,
    };
  }

  const { query, values } = buildDeletePostgresQuery(
    equalityFilters,
    inequalities,
  );

  try {
    const result = await pool.query(query, values);
    const idsToDelete = result.rows.map((row) => row.id);
    if (idsToDelete.length === 0) {
      return res.json({ message: "No logs matched the filter criteria" });
    }
    await pool.query(`DELETE FROM server_logs WHERE id = ANY($1)`, [
      idsToDelete,
    ]);
    res.json({ message: `${idsToDelete.length} logs deleted successfully` });
  } catch (error) {
    console.error("Error deleting logs by filter:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

export async function getLogsVolume(req: Request, res: Response) {
  const scale = req.params.scale as string;

  if (!scale) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Scale parameter is required",
    });
  }

  const scaleConfig = getScaleConfig(scale);

  if (!scaleConfig) {
    return res.status(400).json({
      error: "Invalid scale parameter",
      message: "Scale must be one of: 1h, 6h, 24h, 7d, 30d",
    });
  }

  try {
    // Handle special case for 10-minute intervals (6h scale)
    let query: string;
    let queryParams: any[];

    if (scaleConfig.customBucket === "10") {
      // For 10-minute intervals, use floor arithmetic
      query = `
        SELECT 
          (DATE_TRUNC('minute', timestamp) + 
           MAKE_INTERVAL(mins => ((EXTRACT(MINUTE FROM timestamp)::int / 10) * 10 - EXTRACT(MINUTE FROM timestamp)::int))) as time_bucket,
          level,
          COUNT(*) as count
        FROM server_logs
        WHERE timestamp > NOW() - $1::interval
        GROUP BY 
          (DATE_TRUNC('minute', timestamp) + 
           MAKE_INTERVAL(mins => ((EXTRACT(MINUTE FROM timestamp)::int / 10) * 10 - EXTRACT(MINUTE FROM timestamp)::int))),
          level
        ORDER BY time_bucket ASC
      `;
      queryParams = [scaleConfig.lookbackInterval];
    } else {
      // Standard DATE_TRUNC for minute, hour, day
      query = `
        SELECT 
          DATE_TRUNC($1, timestamp) as time_bucket,
          level,
          COUNT(*) as count
        FROM server_logs
        WHERE timestamp > NOW() - $2::interval
        GROUP BY DATE_TRUNC($1, timestamp), level
        ORDER BY time_bucket ASC
      `;
      queryParams = [scaleConfig.dateTruncUnit, scaleConfig.lookbackInterval];
    }

    const result = await pool.query(query, queryParams);

    // Transform raw data into time buckets with aggregated counts
    const dataMap = new Map<number, Record<string, number>>();

    result.rows.forEach(
      (row: { time_bucket: Date; level: string; count: string }) => {
        const timestamp = new Date(row.time_bucket).getTime();
        if (!dataMap.has(timestamp)) {
          dataMap.set(timestamp, {});
        }
        dataMap.get(timestamp)![row.level] = parseInt(row.count, 10);
      },
    );

    // Build final array from dataMap entries, filling in gaps
    const sortedEntries = Array.from(dataMap.entries()).sort(
      ([a], [b]) => a - b,
    );

    if (sortedEntries.length === 0) {
      // No data, create empty buckets
      const now = Date.now();
      const granuMs = getGranularityMs(scaleConfig.dateTruncUnit);
      const nowRounded = Math.floor(now / granuMs) * granuMs;
      const startTime = nowRounded - (scaleConfig.pointCount - 1) * granuMs;

      const allBuckets = [];
      for (let i = 0; i < scaleConfig.pointCount; i++) {
        const bucketTime = startTime + i * granuMs;
        allBuckets.push({ timestamp: bucketTime, counts: {} });
      }

      return res.json({
        message: "Logs volume fetched successfully",
        data: {
          scale: scale as any,
          data: allBuckets,
          fetchedAt: Date.now(),
        },
      });
    }

    // Fill in missing time buckets between first and last entry
    const allBuckets: any[] = [];
    const granuMs = getGranularityMs(scaleConfig.dateTruncUnit);
    const firstEntry = sortedEntries[0];
    const lastEntry = sortedEntries[sortedEntries.length - 1];
    if (!firstEntry || !lastEntry) {
      return res.json({
        message: "Logs volume fetched successfully",
        data: {
          scale: scale as any,
          data: [],
          fetchedAt: Date.now(),
        },
      });
    }
    const [firstTime] = firstEntry;
    const [lastTime] = lastEntry;

    for (let time = firstTime; time <= lastTime; time += granuMs) {
      allBuckets.push({
        timestamp: time,
        counts: dataMap.get(time) || {},
      });
    }

    res.json({
      message: "Logs volume fetched successfully",
      data: {
        scale: scale as any,
        data: allBuckets,
        fetchedAt: Date.now(),
      },
    });
  } catch (error) {
    console.error("Error fetching logs volume:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

function getGranularityMs(unit: string): number {
  const map: Record<string, number> = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
  };
  return map[unit] || 0;
}
