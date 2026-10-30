import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";
export function ZoneTelemetryEditor({ zone, organizer }: { zone: Doc<"zones">; organizer: boolean }) {
  const update = useMutation(api.telemetry.updateZone);
  const configureEgress = useMutation(api.telemetry.configureEgress);
  const [open,setOpen] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const [occupancy,setOccupancy] = useState(zone.currentOccupancy), [inflow,setInflow] = useState(zone.inflowRate), [outflow,setOutflow] = useState(zone.outflowRate), [blocked,setBlocked] = useState(zone.exitBlocked);
  return <div className="text-xs space-y-2">
    <p className={zone.telemetryStale || !zone.telemetryAt ? "text-amber-800" : "text-[#6b6456]"}>{zone.telemetryStale || !zone.telemetryAt ? "Telemetry unknown or stale" : `Observed ${new Date(zone.telemetryAt).toLocaleTimeString()} · ${zone.telemetrySource ?? "unknown source"}`}</p>
    {organizer && (zone.zoneType === "gate" || zone.zoneType === "exit" || zone.isAssemblyPoint) && <label className="flex items-center gap-2"><input type="checkbox" checked={zone.isDesignatedEgress ?? false} onChange={async e => { try { await configureEgress({ zoneId: zone._id, isDesignatedEgress: e.target.checked }); } catch (err) { setError(err instanceof Error ? err.message : "Egress update failed."); } }} />Designated egress</label>}
    <button className="underline text-[#5b3ff8]" onClick={() => { if (!open) { setOccupancy(zone.currentOccupancy);setInflow(zone.inflowRate);setOutflow(zone.outflowRate);setBlocked(zone.exitBlocked); } setOpen(!open); }}> {open ? "Close update" : "Record manual observation"}</button>
    {open && <form className="space-y-2" onSubmit={async e => { e.preventDefault();setBusy(true);setError("");try { await update({zoneId:zone._id,currentOccupancy:occupancy,inflowRate:inflow,outflowRate:outflow,exitBlocked:blocked});setOpen(false); } catch(e) {setError(e instanceof Error ? e.message : "Update failed.");}finally{setBusy(false);} }}>
      {([["Occupancy",occupancy,setOccupancy],["Inflow / minute",inflow,setInflow],["Outflow / minute",outflow,setOutflow]] as const).map(([label,value,setValue]) => <label className="flex items-center justify-between gap-2" key={label}>{label}<input className="w-24 rounded-lg border border-[#ded7cb] p-1" required type="number" min={0} max={1000000} value={value} onChange={e=>setValue(Number(e.target.value))}/></label>)}
      <label className="flex gap-2"><input type="checkbox" checked={blocked} onChange={e=>setBlocked(e.target.checked)}/>Exit blocked</label>
      <p>Saving invalidates existing route recommendations. Record actual observations only.</p>
      <button className="rounded-lg border border-[#ded7cb] px-2 py-1 disabled:opacity-50" disabled={busy}>Save observation</button>
    </form>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
