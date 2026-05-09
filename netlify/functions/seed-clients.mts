import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// POST /api/seed-clients
// Seeds real Calendly clients into Netlify Blobs (run once from Settings)
// Protected by coach PIN

const REAL_CLIENTS = [
  {
    id: "client-annalouise-m",
    name: "Anna-Louise MacAllister",
    email: "annalouise@auslanway.com",
    phone: "+61424914689",
    biz: "Auslanway — Disability services",
    clientAccess: "ANNA47",
    status: "active",
    health: "green",
    socials: { website: "", linkedin: "", instagram: "", whatsapp: "+61424914689" },
    programs: [{
      id: "prog-annalouise-accel",
      program: "accelerator",
      label: "Business Growth Accelerator",
      workbook: "90day",
      sessionDate: "2026-04-28",
      status: "active",
      locked: false,
      intake: "Business: Auslanway\nNature: Disability services\nWants to change: Cheaper and more efficient service",
      websiteUrl: "",
      websiteSocial: "",
      zoomJoin: "https://us06web.zoom.us/j/82594018139",
      notes: { themes: "", leaks: "", opps: "", patterns: "", private: "Paid $595 AUD via Stripe", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      createdAt: "2026-04-28T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2026-04-28T00:00:00Z",
    updatedAt: "2026-04-28T00:00:00Z",
  },
  {
    id: "client-louise-s",
    name: "Louise Syphers",
    email: "louise@abundanceandbeyond.com.au",
    phone: "+61408844881",
    biz: "Abundance & Beyond — Mortgage broking",
    clientAccess: "LOUI63",
    status: "active",
    health: "green",
    socials: { website: "", linkedin: "", instagram: "", whatsapp: "+61408844881" },
    programs: [
      {
        id: "prog-louise-90day",
        program: "90day",
        label: "90-Day Business Builder",
        workbook: "90day",
        sessionDate: "2026-02-27",
        status: "active",
        locked: false,
        intake: "Business: Abundance and Beyond\nNature: Mortgage broking\nPaid: $595 AUD",
        websiteUrl: "",
        websiteSocial: "",
        zoomJoin: "https://us06web.zoom.us/j/86115326918",
        notes: { themes: "", leaks: "", opps: "", patterns: "", private: "Paid $595 AUD via Stripe", research: "" },
        plan: [], taskDone: {}, sessionNotes: [], wins: [],
        createdAt: "2026-02-27T00:00:00Z", source: "calendly"
      },
      {
        id: "prog-louise-mdc",
        program: "mdc",
        label: "Million Dollar Conspiracy",
        workbook: "mdc",
        sessionDate: "2026-04-28",
        status: "active",
        locked: false,
        intake: "MDC Focus session",
        websiteUrl: "",
        websiteSocial: "",
        zoomJoin: "https://us06web.zoom.us/j/87212912208",
        notes: { themes: "", leaks: "", opps: "", patterns: "", private: "", research: "" },
        plan: [], taskDone: {}, sessionNotes: [], wins: [],
        mdcSprint: 1, mdcWeek: 1,
        mdcWorkbook: { businessSnapshot: "", vision: "", meNow: "", sprintFocus: "", weeklyCheckins: {} },
        createdAt: "2026-04-28T00:00:00Z", source: "calendly"
      }
    ],
    tasks: [], coachNotes: [],
    createdAt: "2026-02-27T00:00:00Z",
    updatedAt: "2026-04-28T00:00:00Z",
  },
  {
    id: "client-yvette-p",
    name: "Yvette Polley",
    email: "yvettepolley@hotmail.com",
    phone: "",
    biz: "MDC member",
    clientAccess: "YVET52",
    status: "active",
    health: "green",
    socials: { website: "", linkedin: "", instagram: "", whatsapp: "" },
    programs: [{
      id: "prog-yvette-mdc",
      program: "mdc",
      label: "Million Dollar Conspiracy",
      workbook: "mdc",
      sessionDate: "2026-04-27",
      status: "active",
      locked: false,
      intake: "Has a meeting about retreats and alignment with another business. Needs help preparing a pricing offer.",
      websiteUrl: "",
      websiteSocial: "",
      zoomJoin: "https://us06web.zoom.us/j/88060291072",
      notes: { themes: "", leaks: "", opps: "Retreat collaboration — pricing strategy needed", patterns: "", private: "", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      mdcSprint: 1, mdcWeek: 1,
      mdcWorkbook: { businessSnapshot: "", vision: "", meNow: "", sprintFocus: "", weeklyCheckins: {} },
      createdAt: "2026-04-27T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2026-04-27T00:00:00Z",
    updatedAt: "2026-04-27T00:00:00Z",
  },
  {
    id: "client-frances-p",
    name: "Frances Pratt",
    email: "f.pratt@metisan.com.au",
    phone: "+61417331040",
    biz: "Metisan — Sales methodology",
    clientAccess: "FRAN82",
    status: "active",
    health: "green",
    socials: { website: "https://metisan.com.au", linkedin: "linkedin.com/in/francespratt", instagram: "", whatsapp: "+61417331040" },
    programs: [{
      id: "prog-frances-inquiry",
      program: "inquiry",
      label: "15 Minute Clarity Call",
      workbook: "inquiry",
      sessionDate: "2026-04-06",
      status: "active",
      locked: false,
      intake: "Clarity call booked",
      websiteUrl: "https://metisan.com.au",
      websiteSocial: "linkedin.com/in/francespratt",
      zoomJoin: "",
      notes: { themes: "", leaks: "", opps: "", patterns: "", private: "", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      createdAt: "2026-04-06T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2026-04-06T00:00:00Z",
    updatedAt: "2026-04-06T00:00:00Z",
  },
  {
    id: "client-kari-m",
    name: "Kari Marsden",
    email: "ksmarsden25@gmail.com",
    phone: "",
    biz: "MDC member",
    clientAccess: "KARI38",
    status: "active",
    health: "green",
    socials: { website: "", linkedin: "", instagram: "", whatsapp: "" },
    programs: [{
      id: "prog-kari-mdc",
      program: "mdc",
      label: "Million Dollar Conspiracy",
      workbook: "mdc",
      sessionDate: "2026-03-15",
      status: "active",
      locked: false,
      intake: "MDC Feedback session",
      websiteUrl: "",
      websiteSocial: "",
      zoomJoin: "https://us06web.zoom.us/j/84264752831",
      notes: { themes: "", leaks: "", opps: "", patterns: "", private: "", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      mdcSprint: 1, mdcWeek: 1,
      mdcWorkbook: { businessSnapshot: "", vision: "", meNow: "", sprintFocus: "", weeklyCheckins: {} },
      createdAt: "2026-03-15T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2026-03-15T00:00:00Z",
    updatedAt: "2026-03-15T00:00:00Z",
  },
  {
    id: "client-christine-l",
    name: "Christine Lukich",
    email: "christine@greenlightcoaching.com.au",
    phone: "",
    biz: "Green Light Coaching",
    clientAccess: "CHRI91",
    status: "active",
    health: "green",
    socials: { website: "https://greenlightcoaching.com.au", linkedin: "", instagram: "", whatsapp: "" },
    programs: [{
      id: "prog-christine-mdc",
      program: "mdc",
      label: "Million Dollar Conspiracy",
      workbook: "mdc",
      sessionDate: "2025-12-15",
      status: "active",
      locked: false,
      intake: "MDC make up session",
      websiteUrl: "https://greenlightcoaching.com.au",
      websiteSocial: "",
      zoomJoin: "https://us06web.zoom.us/j/83753828633",
      notes: { themes: "", leaks: "", opps: "", patterns: "", private: "", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      mdcSprint: 1, mdcWeek: 1,
      mdcWorkbook: { businessSnapshot: "", vision: "", meNow: "", sprintFocus: "", weeklyCheckins: {} },
      createdAt: "2025-12-15T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2025-12-15T00:00:00Z",
    updatedAt: "2025-12-15T00:00:00Z",
  },
  {
    id: "client-julie-j",
    name: "Julie Judge",
    email: "julie@mortgagepass.com.au",
    phone: "",
    biz: "Mortgage Pass — Mortgage broking",
    clientAccess: "JULI74",
    status: "active",
    health: "green",
    socials: { website: "https://mortgagepass.com.au", linkedin: "", instagram: "", whatsapp: "" },
    programs: [{
      id: "prog-julie-broker",
      program: "broker",
      label: "Broker Business Breakthrough",
      workbook: "90day",
      sessionDate: "2025-09-30",
      status: "active",
      locked: false,
      intake: "Business: Mortgage Pass\nNature: Mortgage broking\nPaid: $197 AUD",
      websiteUrl: "https://mortgagepass.com.au",
      websiteSocial: "",
      zoomJoin: "https://us06web.zoom.us/j/86086359764",
      notes: { themes: "", leaks: "", opps: "", patterns: "", private: "Paid $197 AUD via Stripe", research: "" },
      plan: [], taskDone: {}, sessionNotes: [], wins: [],
      createdAt: "2025-09-30T00:00:00Z", source: "calendly"
    }],
    tasks: [], coachNotes: [],
    createdAt: "2025-09-30T00:00:00Z",
    updatedAt: "2025-09-30T00:00:00Z",
  },
];

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  // v11510: PIN updated Happy_529 (case-sensitive). Override possible via
  // COACH_ADMIN_PIN env var if Phoebe ever rotates the shared admin secret.
  const expectedPin = Netlify.env.get("COACH_ADMIN_PIN") || "Happy_529";
  if (body.pin !== expectedPin) return new Response("Unauthorised", { status: 401 });

  const store = getStore("clients");
  const results: string[] = [];

  for (const client of REAL_CLIENTS) {
    try {
      // Check if already exists by email
      const keys = await store.list({ prefix: "client:" });
      let exists = false;
      for (const key of keys.blobs || []) {
        const raw = await store.get(key.key);
        if (raw) {
          const existing = JSON.parse(raw);
          if (existing.email === client.email) { exists = true; break; }
        }
      }
      if (exists) {
        results.push(`SKIPPED (already exists): ${client.name}`);
        continue;
      }
      await store.set(`client:${client.id}`, JSON.stringify({ ...client, updatedAt: new Date().toISOString() }));
      results.push(`CREATED: ${client.name} (${client.clientAccess})`);
    } catch (err) {
      results.push(`ERROR: ${client.name} — ${String(err)}`);
    }
  }

  return new Response(JSON.stringify({ success: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
};

export const config: Config = { path: "/api/seed-clients" };
