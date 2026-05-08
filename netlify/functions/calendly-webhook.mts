import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// ── Event type → Program mapping (all Phoebe's Calendly events) ──────────────
const EVENT_PROGRAM_MAP: Record<string, {
  program: string;
  label: string;
  workbook: string;
  isGroup: boolean;
  isPaid: boolean;
}> = {
  // Paid coaching programs → get full workbook
  "fd9c244a-8198-4590-8e9b-67a171f64c89": { program: "90day",      label: "90-Day Business Builder",         workbook: "90day",      isGroup: false, isPaid: true  },
  "dbaa7730-a705-419b-9d48-d08e745e0271": { program: "accelerator", label: "Business Growth Accelerator",     workbook: "90day",      isGroup: false, isPaid: true  },
  "2c636ade-656e-4d50-b3a1-ce3efd8af6d3": { program: "broker",      label: "Broker Business Breakthrough",   workbook: "90day",      isGroup: false, isPaid: true  },
  "dbe87f5d-393e-47ad-a486-9952d4955d12": { program: "happyhour",   label: "Happy Hour",                     workbook: "happyhour",  isGroup: false, isPaid: true  },
  "4ae53caa-aa5f-4453-91bf-0a25550003df": { program: "adhoc",       label: "Ad Hoc Coaching Session",        workbook: "session",    isGroup: false, isPaid: true  },
  "8f38b8ac-eaa8-4273-a12e-a94dcc5278f6": { program: "audit",       label: "Beautiful Business Audit",       workbook: "audit",      isGroup: false, isPaid: false }, // free audit
  // MDC-related
  "35ebbdc6-0f55-408d-9628-bbbe422d48e4": { program: "mdc-inquiry", label: "MDC Inquiry (Milli_Maker)",      workbook: "inquiry",    isGroup: false, isPaid: false },
  "5aabc086-13df-4b29-9c06-0b4f76e4862c": { program: "mdc-inquiry", label: "MDC Inquiry (Milly Maker)",     workbook: "inquiry",    isGroup: false, isPaid: false },
  "5aebbbbb-b119-4b78-83ea-a421fa4384e7": { program: "mdc",         label: "MDC Feedback Session",           workbook: "mdc",        isGroup: true,  isPaid: false },
  "e5e87dc4-8ef3-4d66-bf63-dde619b53ada": { program: "mdc",         label: "MDC Focus Session",              workbook: "mdc",        isGroup: true,  isPaid: false },
  // Conversations / discovery → create inquiry record only
  "0f3468e9-d4f4-4a00-996c-8b3147a7092b": { program: "inquiry",     label: "Coaching Conversation",          workbook: "inquiry",    isGroup: false, isPaid: false },
  "64fce750-477b-473c-8a04-43b39c266093": { program: "inquiry",     label: "15 Minute Clarity Call",         workbook: "inquiry",    isGroup: false, isPaid: false },
  "f35c5171-c9e2-4fc2-bd26-bc92fff9c0ff": { program: "inquiry",     label: "Business Builder Coaching",      workbook: "inquiry",    isGroup: false, isPaid: false },
  // Podcast / partner (note only, no workbook)
  "04aac8fa-8929-40a3-b4be-94bfa277bdca": { program: "podcast",     label: "Podcast Recording",              workbook: "none",       isGroup: false, isPaid: false },
  "27efc6dc-e282-4dad-9421-83e870afb1e9": { program: "podcast",     label: "Podcast Episode Chat",           workbook: "none",       isGroup: false, isPaid: false },
  "9940603c-97cb-4908-beb5-675f20b8d3a5": { program: "partner",     label: "Women Talk Wealth Partner",      workbook: "none",       isGroup: false, isPaid: false },
  "41441298-aaec-4146-a11f-71bbe1ba7342": { program: "research",    label: "S2S Research Chat",              workbook: "none",       isGroup: false, isPaid: false },
};

// ── Question name → field mapping per event type ──────────────────────────────
function extractFields(questions: any[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const q of questions) {
    const name = (q.name || "").trim().toLowerCase();
    const val  = q.answer || "";
    if (!val) continue;
    if (name.includes("business name") || name === "business name") fields.businessName = val;
    if (name.includes("nature of your business") || name.includes("nature of business")) fields.businessNature = val;
    if (name.includes("want to change") || name.includes("one thing that gets in")) fields.wantToChange = val;
    if (name.includes("website") || name.includes("link") || name.includes("find your business") || name.includes("linkedin") || name.includes("instagram")) fields.websiteLink = val;
    if (name.includes("focus") || name.includes("happy hour") || name.includes("anything") || name.includes("prepare")) fields.notes = val;
    if (name.includes("tell me about your business")) fields.businessAbout = val;
  }
  return fields;
}

function generateCode(name: string): string {
  const first = name.split(" ")[0]?.toUpperCase().slice(0, 4) || "CLNT";
  return first + Math.floor(Math.random() * 900 + 100);
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  let payload: any;
  try { payload = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const event = payload.event;
  if (event !== "invitee.created") return new Response("Ignored", { status: 200 });

  const invitee     = payload.payload?.invitee || {};
  const scheduledEvent = payload.payload?.scheduled_event || {};
  const eventTypeUri = scheduledEvent.event_type || "";
  const eventTypeId  = eventTypeUri.split("/").pop() || "";

  const name     = invitee.name || "Unknown";
  const email    = (invitee.email || "").toLowerCase().trim();
  const startTime = scheduledEvent.start_time || new Date().toISOString();
  const sessionDate = startTime.split("T")[0];
  const zoomJoin = scheduledEvent.location?.join_url || "";

  const programInfo = EVENT_PROGRAM_MAP[eventTypeId] || {
    program: "general",
    label: "General Session",
    workbook: "none",
    isGroup: false,
    isPaid: false,
  };

  const questions = payload.payload?.questions_and_answers || [];
  const fields    = extractFields(questions);

  const store = getStore("clients");

  // ── Find existing client by email ─────────────────────────────────────────
  let existingClient: any = null;
  let existingId: string | null = null;

  try {
    const keys = await store.list({ prefix: "client:" });
    for (const key of keys.blobs || []) {
      const raw = await store.get(key.key);
      if (!raw) continue;
      try {
        const c = JSON.parse(raw);
        if (c.email === email) { existingClient = c; existingId = key.key; break; }
      } catch {}
    }
  } catch (err) {
    console.error("Error scanning clients:", err);
  }

  // ── Build the new program entry ───────────────────────────────────────────
  const intake = [
    fields.businessName    ? `Business: ${fields.businessName}`         : null,
    fields.businessNature  ? `Nature: ${fields.businessNature}`         : null,
    fields.businessAbout   ? `About: ${fields.businessAbout}`           : null,
    fields.wantToChange    ? `Wants to change: ${fields.wantToChange}`  : null,
    fields.websiteLink     ? `Website/Social: ${fields.websiteLink}`    : null,
    fields.notes           ? `Notes: ${fields.notes}`                   : null,
  ].filter(Boolean).join("\n");

  const newProgramEntry = {
    id:          `${programInfo.program}-${Date.now()}`,
    program:     programInfo.program,
    label:       programInfo.label,
    workbook:    programInfo.workbook,
    isGroup:     programInfo.isGroup,
    sessionDate: sessionDate,
    zoomJoin:    zoomJoin,
    eventTypeId: eventTypeId,
    intake:      intake,
    websiteUrl:  fields.websiteLink?.startsWith("http") ? fields.websiteLink : "",
    websiteSocial: !fields.websiteLink?.startsWith("http") ? fields.websiteLink : "",
    status:      "upcoming",
    locked:      false,
    notes:       { themes:"", leaks:"", opps: fields.wantToChange ? `Client wants to change: ${fields.wantToChange}` : "", patterns:"", private:"", research:"" },
    plan:        [],
    taskDone:    {},
    mdcWorkbook: programInfo.workbook === "mdc" ? { businessSnapshot:"", vision:"", meNow:"", sprintFocus:"", weeklyCheckins:{} } : undefined,
    happyHour:   programInfo.workbook === "happyhour" ? { assets:"", discussed:"", actions:"", resources:"" } : undefined,
    createdAt:   new Date().toISOString(),
    source:      "calendly",
  };

  let clientRecord: any;
  let clientId: string;
  let isNew = false;

  if (existingClient && existingId) {
    // ── Returning client — add program to existing profile ─────────────────
    existingClient.programs = existingClient.programs || [];
    existingClient.programs.push(newProgramEntry);
    existingClient.updatedAt = new Date().toISOString();
    existingClient.status = "active";
    clientRecord = existingClient;
    clientId = existingId;
  } else {
    // ── New client — create full profile ───────────────────────────────────
    isNew = true;
    clientId = `client:${email.replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;
    const code = generateCode(name);
    clientRecord = {
      id:           clientId,
      name:         name,
      email:        email,
      biz:          fields.businessNature || fields.businessName || "",
      clientAccess: code,
      status:       "active",
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      programs:     [newProgramEntry],
      source:       "calendly",
    };
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  try {
    await store.set(clientId, JSON.stringify(clientRecord));
  } catch (err) {
    console.error("Failed to save client:", err);
    return new Response(JSON.stringify({ error: "Storage failed" }), { status: 500 });
  }

  // ── Notify coach portal (new-client queue) ────────────────────────────────
  try {
    const notifyStore = getStore("notifications");
    const notif = {
      clientId:    clientId,
      clientName:  name,
      email:       email,
      program:     programInfo.label,
      isNew:       isNew,
      sessionDate: sessionDate,
      timestamp:   new Date().toISOString(),
    };
    await notifyStore.set(`notify:${Date.now()}`, JSON.stringify(notif));
  } catch {}

  // ── Trigger AI pre-session intelligence brief (background, fire-and-forget) ─
  if (fields.websiteLink) {
    const link = fields.websiteLink;
    const isLinkedIn = link.toLowerCase().includes("linkedin.com");
    const baseUrl = new URL(req.url).origin;
    fetch(`${baseUrl}/.netlify/functions/discover-socials-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        name,
        websiteUrl:   isLinkedIn ? "" : link,
        linkedIn:     isLinkedIn ? link : "",
        businessName: fields.businessName || "",
      }),
    }).catch(err => console.error("Failed to trigger social discovery:", err));
  }

  // ── Welcome email for brand-new clients (fire-and-forget) ─────────────────
  // Returning clients booking another session don't need a welcome — they
  // already know the portal. Paid programs get a warm "your space is ready"
  // message; free discovery / inquiry calls get a lighter "see you soon".
  if (isNew && email) {
    const baseUrl = new URL(req.url).origin;
    const portalLink = `${baseUrl}/?client=${clientRecord.clientAccess}`;
    const firstName = name.split(" ")[0] || "there";
    const sessionDateStr = sessionDate
      ? new Date(sessionDate).toLocaleString("en-AU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true })
      : "";
    const isPaidProgram = programInfo.isPaid;
    const subject = isPaidProgram
      ? `Welcome to PeaBe Coaching Hub — let's get started`
      : `Looking forward to our ${programInfo.label}, ${firstName}`;
    const body = isPaidProgram
      ? `Hi ${firstName},\n\n` +
        `Lovely to have you on board. Your private client space is set up and ready when you are.\n\n` +
        (sessionDateStr ? `Our first session: ${sessionDateStr}\n\n` : "") +
        `YOUR ACCESS\n` +
        `Portal: ${portalLink}\n` +
        `Code:   ${clientRecord.clientAccess}\n\n` +
        `WHAT YOU'LL FIND INSIDE\n` +
        `• Your plan once we've had our first session\n` +
        `• Tasks I'll send you week-to-week\n` +
        `• A wins tracker — let me know when you hit one!\n\n` +
        `Have a poke around the portal before we meet so you can hit the ground running.\n\n` +
        `Any questions, just reply to this email.\n\n` +
        `Phoebe x`
      : `Hi ${firstName},\n\n` +
        `Booking confirmed — looking forward to our ${programInfo.label.toLowerCase()}.\n\n` +
        (sessionDateStr ? `When: ${sessionDateStr}\n\n` : "") +
        `If you decide to work with me afterwards, you'll get access to a private hub to track everything we cover.\n\n` +
        `See you soon,\n` +
        `Phoebe x`;
    fetch(`${baseUrl}/api/send-message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type:       "email",
        to:         email,
        subject:    subject,
        message:    body,
        clientName: name,
      }),
    }).catch(err => console.error("[calendly-webhook] welcome email failed:", err));
  }

  return new Response(JSON.stringify({ success: true, clientId, isNew, program: programInfo.label }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = { path: "/api/calendly-webhook" };
