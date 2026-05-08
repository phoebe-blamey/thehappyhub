import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

// POST /api/merge-clients
// Walks all clients, groups by normalized email, merges duplicates into a
// single canonical record (preserving oldest createdAt), folds programs and
// tasks together, then deletes the duplicates.
//
// Body: { dryRun?: bool }
//
// Returns: { stats, merges, sample }
//
// Heuristics:
//   - Group by lowercase trimmed email (skip records with empty email)
//   - Canonical = oldest createdAt (most established record)
//   - Programs deduped by program+sessionDate
//   - sessionNotes deduped by zoomMeetingId or by date+first-30-chars
//   - Tasks deduped by text+dueDate

function pickCanonical(group: any[]): any {
  return group.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb; // oldest first
  })[0];
}

function mergeProgramArrays(canonical: any[], extra: any[]): { merged: any[]; appended: number } {
  const merged = canonical.slice();
  let appended = 0;
  for (const p of extra) {
    const dup = merged.find(m => m.program === p.program && m.sessionDate === p.sessionDate);
    if (dup) {
      // Merge sessionNotes into the canonical program too
      dup.sessionNotes = dup.sessionNotes || [];
      const seenZoom = new Set(dup.sessionNotes.map((n: any) => n.zoomMeetingId).filter(Boolean));
      const seenSig  = new Set(dup.sessionNotes.map((n: any) => (n.date||'') + '|' + (n.text||'').slice(0, 30)));
      for (const n of (p.sessionNotes || [])) {
        if (n.zoomMeetingId && seenZoom.has(n.zoomMeetingId)) continue;
        const sig = (n.date||'') + '|' + (n.text||'').slice(0, 30);
        if (seenSig.has(sig)) continue;
        dup.sessionNotes.push(n);
      }
      // Also merge wins
      dup.wins = (dup.wins || []).concat((p.wins || []).filter((w: any) => {
        const sig = (w.date||'') + '|' + (w.metric||'') + '|' + (w.after||'');
        return !(dup.wins || []).some((dw: any) => ((dw.date||'') + '|' + (dw.metric||'') + '|' + (dw.after||'')) === sig);
      }));
    } else {
      merged.push(p);
      appended++;
    }
  }
  return { merged, appended };
}

function mergeTasks(canonical: any[], extra: any[]): { merged: any[]; appended: number } {
  const merged = canonical.slice();
  const seen = new Set(merged.map(t => (t.text || '').toLowerCase().trim() + '|' + (t.dueDate || '')));
  let appended = 0;
  for (const t of extra) {
    const sig = (t.text || '').toLowerCase().trim() + '|' + (t.dueDate || '');
    if (seen.has(sig)) continue;
    merged.push(t);
    seen.add(sig);
    appended++;
  }
  return { merged, appended };
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const dryRun: boolean = !!body.dryRun;

  const store = getStore("clients");
  const list = await store.list();
  const all: any[] = [];
  for (const blob of list.blobs) {
    if (!blob.key) continue;
    const raw = await store.get(blob.key);
    if (!raw) continue;
    try { all.push(JSON.parse(raw)); } catch {}
  }

  const groups: Record<string, any[]> = {};
  for (const c of all) {
    const email = (c.email || "").toLowerCase().trim();
    if (!email) continue; // can't dedupe by email if missing
    (groups[email] = groups[email] || []).push(c);
  }

  const stats = { totalClients: all.length, duplicateGroups: 0, deleted: 0, programsMerged: 0, tasksMerged: 0 };
  const merges: Array<{ email: string; canonical: string; deleted: string[]; programsAdded: number; tasksAdded: number }> = [];

  for (const email of Object.keys(groups)) {
    const group = groups[email];
    if (group.length < 2) continue;
    stats.duplicateGroups++;
    const canonical = pickCanonical(group);
    const others = group.filter(c => c !== canonical);
    let programsAdded = 0;
    let tasksAdded = 0;
    for (const dup of others) {
      const progResult = mergeProgramArrays(canonical.programs || [], dup.programs || []);
      canonical.programs = progResult.merged;
      programsAdded += progResult.appended;
      const taskResult = mergeTasks(canonical.tasks || [], dup.tasks || []);
      canonical.tasks = taskResult.merged;
      tasksAdded += taskResult.appended;
      // Merge top-level wins as well
      canonical.wins = (canonical.wins || []).concat((dup.wins || []).filter((w: any) => {
        const sig = (w.date||'') + '|' + (w.metric||'') + '|' + (w.after||'');
        return !(canonical.wins || []).some((cw: any) => ((cw.date||'') + '|' + (cw.metric||'') + '|' + (cw.after||'')) === sig);
      }));
      // Prefer the canonical's clientAccess code (don't change a client's login)
      // Fill blank fields on canonical from dup
      ['phone', 'biz'].forEach((k: string) => {
        if (!(canonical as any)[k] && (dup as any)[k]) (canonical as any)[k] = (dup as any)[k];
      });
      // Merge socials with canonical's values winning when present
      const canSoc: any = canonical.socials || {};
      const dupSoc: any = dup.socials || {};
      canonical.socials = {
        website:   canSoc.website   || dupSoc.website   || "",
        linkedin:  canSoc.linkedin  || dupSoc.linkedin  || "",
        instagram: canSoc.instagram || dupSoc.instagram || "",
        facebook:  canSoc.facebook  || dupSoc.facebook  || "",
        tiktok:    canSoc.tiktok    || dupSoc.tiktok    || "",
        whatsapp:  canSoc.whatsapp  || dupSoc.whatsapp  || "",
      };
      canonical.updatedAt = new Date().toISOString();
    }
    stats.programsMerged += programsAdded;
    stats.tasksMerged += tasksAdded;
    if (!dryRun) {
      await store.set(canonical.id, JSON.stringify(canonical));
      for (const dup of others) {
        await store.delete(dup.id);
        stats.deleted++;
      }
    } else {
      stats.deleted += others.length;
    }
    merges.push({
      email,
      canonical: canonical.id,
      deleted: others.map(d => d.id),
      programsAdded,
      tasksAdded,
    });
  }

  return new Response(JSON.stringify({
    success: true,
    dryRun,
    stats,
    merges
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};

export const config: Config = { path: "/api/merge-clients" };
