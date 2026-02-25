#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "mcp-usgs", version: "1.0.0" });

async function usgs(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`USGS API ${res.status}: ${await res.text()}`);
  return res.json();
}

server.tool("earthquakes", "Get recent earthquakes from USGS", {
  starttime: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  endtime: z.string().optional().describe("End date (YYYY-MM-DD)"),
  minmagnitude: z.number().optional().describe("Minimum magnitude"),
  maxmagnitude: z.number().optional().describe("Maximum magnitude"),
  latitude: z.number().optional().describe("Center latitude for radius search"),
  longitude: z.number().optional().describe("Center longitude for radius search"),
  maxradiuskm: z.number().optional().describe("Max radius in km"),
  limit: z.number().default(10),
  orderby: z.enum(["time", "time-asc", "magnitude", "magnitude-asc"]).default("time"),
}, async (params) => {
  const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  url.searchParams.set("format", "geojson");
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  const data = await usgs(url.toString());
  const quakes = (data.features || []).map((f: any) => ({
    magnitude: f.properties.mag, place: f.properties.place,
    time: new Date(f.properties.time).toISOString(), type: f.properties.type,
    coordinates: f.geometry.coordinates, depth_km: f.geometry.coordinates[2],
    url: f.properties.url, tsunami: f.properties.tsunami,
  }));
  return { content: [{ type: "text", text: JSON.stringify({ count: data.metadata?.count, quakes }, null, 2) }] };
});

server.tool("earthquake_detail", "Get detailed info for a specific earthquake", {
  event_id: z.string().describe("USGS event ID"),
}, async ({ event_id }) => {
  const data = await usgs(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&eventid=${event_id}`);
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
});

server.tool("water_services", "Get water data from USGS National Water Information System", {
  sites: z.string().optional().describe("Comma-separated site numbers"),
  stateCd: z.string().optional().describe("Two-letter state code"),
  siteType: z.string().optional().describe("Site type (ST=stream, GW=groundwater, SP=spring)"),
  parameterCd: z.string().default("00060").describe("Parameter code (00060=discharge, 00065=gage height, 00010=temp)"),
  period: z.string().default("P1D").describe("ISO 8601 period (P1D=1 day, P7D=7 days)"),
}, async ({ sites, stateCd, siteType, parameterCd, period }) => {
  const url = new URL("https://waterservices.usgs.gov/nwis/iv/");
  url.searchParams.set("format", "json");
  url.searchParams.set("parameterCd", parameterCd);
  url.searchParams.set("period", period);
  if (sites) url.searchParams.set("sites", sites);
  if (stateCd) url.searchParams.set("stateCd", stateCd);
  if (siteType) url.searchParams.set("siteType", siteType);
  const data = await usgs(url.toString());
  const series = data.value?.timeSeries?.slice(0, 10).map((ts: any) => ({
    site: ts.sourceInfo?.siteName,
    siteCode: ts.sourceInfo?.siteCode?.[0]?.value,
    variable: ts.variable?.variableName,
    values: ts.values?.[0]?.value?.slice(-5),
  }));
  return { content: [{ type: "text", text: JSON.stringify(series, null, 2) }] };
});

server.tool("volcano_hazards", "Get volcano info from USGS Volcano Hazards Program", {
  status: z.enum(["normal", "advisory", "watch", "warning"]).optional(),
}, async ({ status }) => {
  const url = new URL("https://volcanoes.usgs.gov/vsc/api/volcanoApi/volcanoesGVP");
  const data = await usgs(url.toString());
  let volcanoes = data;
  if (status && Array.isArray(data)) {
    volcanoes = data.filter((v: any) => v.alert_level?.toLowerCase() === status);
  }
  return { content: [{ type: "text", text: JSON.stringify(Array.isArray(volcanoes) ? volcanoes.slice(0, 20) : volcanoes, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
