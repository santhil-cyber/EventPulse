import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const field = "w-full rounded-xl border border-[#ded7cb] bg-white p-2 text-xs";
const button = "rounded-xl border border-[#ded7cb] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-[#ece7de]";
type ResponderType = "medical" | "fire" | "security" | "volunteer" | "general";

export function ResponderRoster({ eventId, organizer }: { eventId: Id<"events">; organizer: boolean }) {
  const roster = useQuery(api.agents.queries.listResponders, { eventId });
  const members = useQuery(api.responders.eligibleMembers, organizer ? { eventId } : "skip");
  const register = useMutation(api.responders.register);
  const availability = useMutation(api.responders.setAvailability);
  const retry = useMutation(api.responders.retryWaiting);
  const [open, setOpen] = useState(false);
  const [membershipId, setMembershipId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ResponderType>("medical");
  const [firstAid, setFirstAid] = useState(false);
  const [fireTraining, setFireTraining] = useState(false);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); }
  }
  return <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-3 text-[#1a1917]">
    <div className="flex flex-wrap justify-between items-center gap-2">
      <h3 className="text-sm font-semibold">Responder roster ({roster?.length ?? 0})</h3>
      {organizer && <button className={button} onClick={() => setOpen(!open)}>{open ? "Close form" : "Add responder"}</button>}
    </div>
    <p className="text-xs text-[#6b6456]">A responder must first join this event as staff. Organizers can register staff or themselves, record their actual qualifications, and manage availability.</p>
    {!organizer && <p className="text-xs">Ask the event organizer to add or update responders.</p>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {notice && <p role="status" className="text-xs text-emerald-800">{notice}</p>}
    {open && organizer && <form className="space-y-3 border-t border-[#ded7cb] pt-3" onSubmit={e => {
      e.preventDefault(); void run(async () => {
        await register({
          eventId,
          ...(membershipId ? { membershipId: membershipId as Id<"memberships"> } : {}),
          name,
          responderType: type,
          hasFirstAid: firstAid,
          hasFireTraining: fireTraining,
          isAvailable: available,
        });
        setOpen(false); setMembershipId(""); setName(""); setFirstAid(false); setFireTraining(false);
        setNotice(available ? `${membershipId ? "Responder" : "Demo staff responder"} added. Recent eligible incidents are being checked for assignment.` : "Responder added off duty.");
      });
    }}>
      <label className="block text-xs space-y-1">Staff member<select className={field} value={membershipId} onChange={e => { setMembershipId(e.target.value); setName(members?.find(m => m.membershipId === e.target.value)?.name ?? (e.target.value === "" ? name : "")); }}>
        <option value="">Demo staff (no login required)</option>
        {members?.map(m => <option key={m.membershipId} value={m.membershipId}>{m.name} · {m.role.toLowerCase()}</option>)}
      </select></label>
      {!membershipId && <p className="text-xs text-amber-800">Demo staff is synthetic and available for this event only. No second device or staff login is needed.</p>}
      {members?.length === 0 && <p className="text-xs text-amber-800">No unregistered staff members found. Share the staff code privately from You → Event Access Codes, and have a new staff member join first. Existing profiles are listed below.</p>}
      <label className="block text-xs space-y-1">Responder name<input className={field} required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="block text-xs space-y-1">Responder type<select className={field} value={type} onChange={e => setType(e.target.value as ResponderType)}>
        {(["medical", "fire", "security", "volunteer", "general"] as const).map(t => <option key={t} value={t}>{t}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-3 text-xs">
        <label className="flex gap-2"><input type="checkbox" checked={firstAid} onChange={e => setFirstAid(e.target.checked)} />First-aid trained</label>
        <label className="flex gap-2"><input type="checkbox" checked={fireTraining} onChange={e => setFireTraining(e.target.checked)} />Fire trained</label>
        <label className="flex gap-2"><input type="checkbox" checked={available} onChange={e => setAvailable(e.target.checked)} />Available for assignment</label>
      </div>
      <p className="text-xs text-[#6b6456]">Available volunteer and general responders are automatically posted to high-risk zones as coverage is needed. Medical type qualifies for medical response; other types need first-aid training. Record verified capabilities only.</p>
      <button className={button} disabled={busy || !name.trim()}>Save responder</button>
    </form>}
    {!roster && <p role="status" className="text-xs">Loading roster…</p>}
    {roster?.length === 0 && <p className="text-xs text-amber-800">No responders registered for this event.</p>}
    {roster?.map(r => <div key={r._id} className="border-t border-[#ded7cb] pt-3 space-y-1 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{r.name} · {r.responderType}</strong>
        <span>{!r.eligible ? "Ineligible membership" : r.currentTaskId ? "Assigned" : r.assignmentZoneId ? `Posted at ${r.assignedZoneName ?? "zone"}` : r.isAvailable ? "Available" : "Off duty"}</span>
      </div>
      <p className="text-[#6b6456]">First aid: {r.hasFirstAid ? "yes" : "no"} · Fire training: {r.hasFireTraining ? "yes" : "no"}</p>
      {!r.eligible && <p className="text-amber-800">This profile is not linked to eligible event staff and cannot be assigned.</p>}
      {r.currentTaskInstruction && <p>Current task: {r.currentTaskInstruction}</p>}
      {r.assignmentZoneId && <p className="text-emerald-800">Automatically assigned to {r.assignedZoneName ?? "a high-risk zone"}.</p>}
      {organizer && r.eligible && !r.currentTaskId && !r.assignmentZoneId && <button disabled={busy} className={button} onClick={() => void run(async () => { await availability({ responderId: r._id, isAvailable: !r.isAvailable }); setNotice(r.isAvailable ? "Responder marked off duty." : "Responder available; recent incidents are being checked."); })}>{r.isAvailable ? "Mark off duty" : "Make available"}</button>}
    </div>)}
    <div className="border-t border-[#ded7cb] pt-3 space-y-1">
      <button disabled={busy} className={button} onClick={() => void run(async () => { await retry({ eventId }); setNotice("Dispatch review queued. Check tasks and Activity Log for assignment or the reason it is held."); })}>Retry waiting dispatch</button>
      <p className="text-xs text-[#6b6456]">Checks eligible unresolved incidents among the latest 50. Assignment still requires a qualified, available responder.</p>
    </div>
  </section>;
}
