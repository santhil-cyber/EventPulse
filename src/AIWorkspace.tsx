import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const field = "w-full rounded-xl border border-[#ded7cb] bg-white p-2 text-sm text-[#1a1917]";
const button = "rounded-xl border border-[#ded7cb] bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-[#ece7de]";
export function AIWorkspace({ eventId, organizer }: { eventId: Id<"events">; organizer: boolean }) {
  const settings = useQuery(api.ai.state.settings, { eventId });
  const analyses = useQuery(api.ai.state.recentAnalyses, { eventId });
  const documents = useQuery(api.ai.knowledge.list, { eventId });
  const duplicates = useQuery(api.ai.duplicates.list, { eventId });
  const update = useMutation(api.ai.state.updateSettings);
  const retry = useMutation(api.ai.state.retryAnalysis);
  const create = useMutation(api.ai.knowledge.create);
  const index = useMutation(api.ai.knowledge.index);
  const approve = useMutation(api.ai.knowledge.setApproval);
  const dismiss = useMutation(api.ai.duplicates.dismiss);
  const ask = useAction(api.ai.knowledgeActions.ask);
  const [previewId,setPreviewId] = useState<Id<"knowledgeDocuments"> | null>(null);
  const preview = useQuery(api.ai.knowledge.preview, previewId ? { documentId: previewId } : "skip");
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [title,setTitle] = useState(""); const [source,setSource] = useState(""); const [version,setVersion] = useState("1"); const [text,setText] = useState("");
  const [question,setQuestion] = useState("");
  const [answer,setAnswer] = useState<Awaited<ReturnType<typeof ask>> | null>(null);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); } finally { setBusy(false); }
  }
  if (!settings) return <p role="status">Loading AI workspace…</p>;
  return <div className="space-y-4 text-[#1a1917]">
    <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-3">
      <h2 className="font-semibold">AI assistance & venue knowledge</h2>
      <p className="text-xs text-[#6b6456]">Reports and staff review work independently of AI. AI suggestions cannot verify incidents, approve routes or contact emergency services.</p>
      <p className="text-xs">Deployment: {settings.configured ? "AI configured" : "AI unavailable — server configuration required"}. Current mode: <strong>{settings.mode}</strong>.</p>
      {organizer && <div className="flex flex-wrap items-center gap-3 text-xs">
        <label>Mode <select aria-label="AI mode" className={field} value={settings.mode} disabled={busy} onChange={e => void run(() => update({ eventId, mode: e.target.value as "off" | "shadow" | "assist", visionEnabled: settings.visionEnabled, ragEnabled: settings.ragEnabled }))}>
          <option value="off">Off</option><option value="shadow" disabled={!settings.configured}>Shadow — compare only</option><option value="assist" disabled={!settings.configured}>Assist — enrich triage</option>
        </select></label>
        <label className="flex gap-2"><input type="checkbox" checked={settings.visionEnabled} disabled={busy || !settings.configured || !settings.visionConfigured} onChange={e => void run(() => update({ eventId, mode: settings.mode, visionEnabled: e.target.checked, ragEnabled: settings.ragEnabled }))}/>Analyze stored photos</label>
        <label className="flex gap-2"><input type="checkbox" checked={settings.ragEnabled} disabled={busy || !settings.configured || !settings.embeddingConfigured} onChange={e => void run(() => update({ eventId, mode: settings.mode, visionEnabled: settings.visionEnabled, ragEnabled: e.target.checked }))}/>Approved venue knowledge</label>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700 break-words">{error}</p>}
    </section>
    <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-3">
      <h3 className="font-semibold">Ask approved venue procedures</h3>
      <form onSubmit={e => { e.preventDefault(); setAnswer(null); void run(async () => setAnswer(await ask({ eventId, question }))); }} className="space-y-2">
        <label className="sr-only" htmlFor="venue-question">Venue procedure question</label>
        <textarea id="venue-question" className={field} maxLength={1000} value={question} onChange={e => setQuestion(e.target.value)} placeholder="What does the approved venue plan say about accessible assembly points?" />
        <button className={button} disabled={busy || !settings.ragEnabled || !question.trim()}>Find supported excerpts</button>
      </form>
      {answer && <div role="status" className="space-y-2 text-sm"><p>{answer.message}</p>{answer.citations.map((c,i) => <blockquote className="border-l-2 border-[#5b3ff8] pl-3" key={`${c.chunkId}-${i}`}><p className="whitespace-pre-wrap">{c.quote}</p><cite className="text-xs not-italic text-[#6b6456]">{c.title} · {c.source} · version {c.version} · section {c.section}</cite></blockquote>)}</div>}
    </section>
    <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-3">
      <h3 className="font-semibold">Venue documents</h3>
      <p className="text-xs text-[#6b6456]">Paste reviewed text from your SOP or emergency plan. Indexing does not approve it. An organizer must review and activate each version. Uploading PDF/OCR is not enabled.</p>
      {organizer && <form className="space-y-2" onSubmit={e => { e.preventDefault(); void run(async () => { await create({ eventId,title,source,version,text });setTitle("");setSource("");setText(""); }); }}>
        <input aria-label="Document title" required maxLength={160} className={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" />
        <input aria-label="Document source" required maxLength={240} className={field} value={source} onChange={e => setSource(e.target.value)} placeholder="Source identifier / plan section" />
        <input aria-label="Document version" required maxLength={80} className={field} value={version} onChange={e => setVersion(e.target.value)} placeholder="Version" />
        <textarea aria-label="Document text" required maxLength={40000} rows={5} className={field} value={text} onChange={e => setText(e.target.value)} placeholder="Approved procedure text to review…" />
        <button className={button} disabled={busy}>Save draft</button>
      </form>}
      {documents?.length === 0 && <p className="text-xs">No venue documents yet.</p>}
      {documents?.map(d => <div className="border-t border-[#ded7cb] pt-3 space-y-2" key={d._id}>
        <p className="text-sm font-medium">{d.title} <span className="text-xs font-normal">v{d.version} · {d.approved ? "approved" : d.status}</span></p>
        <p className="text-xs">{d.source}{d.errorCode ? ` · ${d.errorCode}` : ""}</p>
        <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setPreviewId(d._id)}>Review text</button>
          {organizer && !d.approved && d.status !== "revoked" && <button className={button} disabled={busy || d.status === "indexing" || !settings.ragEnabled} onClick={() => void run(() => index({ documentId: d._id }))}>{d.status === "indexing" ? "Indexing…" : "Index document"}</button>}
          {organizer && d.status === "ready" && !d.approved && <button className={button} disabled={busy || previewId !== d._id} onClick={() => void run(() => approve({ documentId: d._id, approved: true }))}>Approve reviewed version</button>}
          {organizer && d.approved && <button className={button} disabled={busy} onClick={() => void run(() => approve({ documentId: d._id, approved: false }))}>Revoke</button>}
        </div>
      </div>)}
      {preview && <div className="rounded-xl bg-[#f5f1ea] p-3 space-y-2"><div className="flex justify-between"><strong className="text-sm">Review: {preview.title}</strong><button className={button} onClick={() => setPreviewId(null)}>Close</button></div><pre className="whitespace-pre-wrap break-words text-xs font-sans max-h-72 overflow-auto">{preview.text}</pre></div>}
    </section>
    <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-3">
      <h3 className="font-semibold">Recent report analysis</h3>
      {!analyses?.length && <p className="text-xs">No AI analyses. New eligible reports are analyzed only when shadow or assist mode is enabled.</p>}
      {analyses?.map(a => <details key={a._id} className="border-t border-[#ded7cb] pt-2 text-xs"><summary className="cursor-pointer">{a.status} · {a.mode} · {a.model ?? "rules retained"} · {new Date(a.createdAt).toLocaleTimeString()}</summary>
        <div className="space-y-2 py-2"><p>{a.output?.summary ?? a.errorCode ?? "Waiting for analysis."}</p>
          {a.output && <><p>Suggested: {a.output.incidentType} / {a.output.suggestedSeverity} · language {a.output.language}</p>{a.output.translatedText && <p>Translation: {a.output.translatedText}</p>}<p>Human review: {a.output.needsHumanReview ? "required" : "policy still applies"}</p>{a.output.observations.map((o,i) => <p key={i}>{o.source === "image" ? "Image observation" : "Reported claim"}: {o.text}</p>)}{a.output.uncertaintyReasons.map((r,i) => <p key={i}>Uncertainty: {r}</p>)}</>}
          <p>Image analyzed: {a.imageAnalyzed ? "yes" : "no"} · attempts {a.attempts}/3</p>
          {a.status === "fallback" && a.attempts < 3 && <button className={button} disabled={busy} onClick={() => void run(() => retry({ analysisId: a._id }))}>Retry optional analysis</button>}
        </div></details>)}
    </section>
    {Boolean(duplicates?.length) && <section className="rounded-2xl border border-[#ded7cb] bg-white p-4 space-y-2"><h3 className="font-semibold">Possible duplicate incidents</h3><p className="text-xs">Semantic matches are suggestions. No automatic merge or extra independent source is created.</p>{duplicates?.map(d => <div key={d._id} className="text-xs flex justify-between gap-2"><span>{d.incidentCode} ↔ {d.candidateCode} · similarity {d.score.toFixed(2)}</span><button className={button} disabled={busy} onClick={() => void run(() => dismiss({ suggestionId:d._id }))}>Dismiss</button></div>)}</section>}
  </div>;
}
