import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { getPanelState, inspectSource, startRelease, getReleaseRun, getReleaseHandoff, login } from "@/lib/panel.server";

export const Route = createFileRoute("/")({ component: Index });

type Tab = "overview" | "base" | "engine";

function Index() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [data, setData] = useState<any>({ base: { releases: [], channels: [] }, engine: { releases: [], channels: [] } });
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [version, setVersion] = useState("");
  const [channel, setChannel] = useState("stable");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<any[]>([]);
  const [components, setComponents] = useState<string[]>([]);
  const [minBase, setMinBase] = useState("1.0.0");
  const [protocol, setProtocol] = useState("1");
  const [run, setRun] = useState<any>(null);
  const [runRepo, setRunRepo] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [handoff, setHandoff] = useState<any>(null);
  const [runVersion, setRunVersion] = useState("");
  const [runChannel, setRunChannel] = useState("stable");
  const availableChannels = useMemo(() => {
    const channels = [...(data.base.channels || []), ...(data.engine.channels || [])];
    return [...new Set(channels.map((x: string) => String(x).trim().toLowerCase()).filter(Boolean))];
  }, [data]);

  const load = async (s = session) => {
    if (!s) return;
    setLoading(true);
    setError("");
    try {
      const [base, engine] = await Promise.all([
        getPanelState({ data: { token: s.token, type: "base", channel } }),
        getPanelState({ data: { token: s.token, type: "engine", channel } }),
      ]);
      setData({ base, engine });
    } catch (x: any) {
      setError(x.message || "Unable to load release data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("orbitfs_panel_user");
      const token = localStorage.getItem("orbitfs_panel_session");
      if (raw && token) {
        const user = JSON.parse(raw);
        const s = { ...user, token };
        setSession(s);
        load(s);
      } else setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  const stats = useMemo(() => {
    const all = [...(data.base.releases || []), ...(data.engine.releases || [])];
    return {
      pending: all.filter((r: any) => r.review_status === "pending").length,
      failed: all.filter((r: any) => r.manifest?.validation?.status === "failed").length,
      approved: all.filter((r: any) => r.review_status === "approved" && r.status !== "published").length,
      published: all.filter((r: any) => r.status === "published").length,
    };
  }, [data]);

  const doLogin = async (e: any) => {
    e.preventDefault();
    setBusy("login");
    setError("");
    try {
      const r = await login({ data: { email, password } });
      localStorage.setItem("orbitfs_panel_session", r.token);
      localStorage.setItem("orbitfs_panel_user", JSON.stringify(r.user));
      const s = { ...r.user, token: r.token };
      setSession(s);
      setPassword("");
      await load(s);
    } catch (x: any) {
      setError(x.message || "Unable to sign in.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    if (!run?.id || !runRepo) return;
    let stopped = false;
    const poll = async () => {
      try {
        const r = await getReleaseRun({ data: { token: session.token, repo: runRepo, runId: run.id } });
        if (!stopped) setRun({ ...r.run, jobs: r.jobs || [] });
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, runRepo, session?.token]);

  useEffect(() => {
    if (!run?.id || !runRepo || !session || !runVersion) return;
    let stopped = false;
    const poll = async () => {
      try {
        const type = runRepo === "lucaskerim123/V1-vercel-base" ? "base" : "engine";
        const r = await getReleaseHandoff({ data: { token: session.token, type, version: runVersion, channel: runChannel } });
        if (!stopped && r.release) setHandoff(r.release);
      } catch {}
    };
    poll();
    const timer = setInterval(poll, 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [run?.id, runRepo, session?.token, runVersion, runChannel]);

  const signOut = () => {
    localStorage.removeItem("orbitfs_panel_session");
    localStorage.removeItem("orbitfs_panel_user");
    setSession(null);
    setData({ base: { releases: [] }, engine: { releases: [] } });
    setRun(null);
    setRunRepo("");
    setRunVersion("");
    setHandoff(null);
  };

  const inspect = async (type: "base" | "engine") => {
    setBusy("inspect");
    setError("");
    setNotice("");
    try {
      const current = data[type].releases?.find((r: any) => r.review_status === "approved" && r.source_sha)?.source_sha;
      const r = await inspectSource({ data: { token: session.token, type, from: current } });
      setFiles(r.files || []);
      setReviewOpen(true);
      setNotice(`${r.repo}@${r.ref} resolved at ${r.head.slice(0, 8)}. ${r.files.length} changed files detected.`);
    } catch (x: any) {
      setError(x.message || "Unable to inspect source.");
    } finally {
      setBusy("");
    }
  };

  const start = async (type: "base" | "engine") => {
    setBusy("start");
    setError("");
    setNotice("");
    try {
      const r = await startRelease({
        data: { token: session.token, type, version, channel, notes, files, components, minimumBaseVersion: minBase, protocol },
      });
      setReviewOpen(false);
      setRun(r.runId ? { id: r.runId, status: "queued", conclusion: null, name: `${type === "base" ? "Base" : "Engine"} release` } : null);
      setRunRepo(r.repo);
      setRunVersion(version);
      setRunChannel(channel);
      setHandoff(null);
      setNotice(r.runId ? `Workflow started and monitoring run #${r.runId}.` : "Workflow started. Waiting for GitHub run details…");
      setVersion("");
      setNotes("");
      setFiles([]);
      await load();
    } catch (x: any) {
      setError(x.message || "Unable to start release.");
    } finally {
      setBusy("");
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen grid place-items-center p-5">
        <form onSubmit={doLogin} className="w-full max-w-md rounded-3xl border bg-card p-7 shadow-2xl">
          <div className="mb-7">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black">O</div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">OrbitFS</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Release Control</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Prepare Base and Engine releases from one controlled workspace.</p>
          </div>
          <div className="space-y-3">
            <label className="block text-sm font-medium">Email<input className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-3" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
            <label className="block text-sm font-medium">Password<input className="mt-1.5 w-full rounded-lg border bg-background px-3.5 py-3" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
          </div>
          {error && <Alert tone="error">{error}</Alert>}
          <button className="mt-5 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/15" disabled={busy === "login"}>{busy === "login" ? "Signing in…" : "Sign in"}</button>
        </form>
      </div>
    );
  }

  const releases = tab === "base" ? data.base.releases : tab === "engine" ? data.engine.releases : [...data.base.releases, ...data.engine.releases];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-4 px-4 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground">O</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">OrbitFS Release Control</div>
              <div className="hidden text-xs text-muted-foreground sm:block">Controlled release workspace</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border bg-card px-2.5 py-1.5 text-xs text-muted-foreground sm:flex"><i className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected</span>
            <button className="rounded-lg border bg-card px-2.5 py-1.5 text-xs hover:bg-accent" onClick={() => load()}>{loading ? "Refreshing…" : "Refresh"}</button>
            <button className="hidden rounded-lg border bg-card px-2.5 py-1.5 text-xs hover:bg-accent sm:block" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-col lg:flex-row">
        <aside className="border-b lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r">
          <nav className="flex gap-1 overflow-x-auto p-3 lg:flex-col lg:p-3">
            <Nav active={tab === "overview"} onClick={() => setTab("overview")} label="Dashboard" detail="System overview" icon="⌂" />
            <Nav active={tab === "base"} onClick={() => setTab("base")} label="Base Deployment" detail="orbitfs_base" icon="B" />
            <Nav active={tab === "engine"} onClick={() => setTab("engine")} label="Engine Updates" detail="MCP · Apex · Studio" icon="E" />
          </nav>
          <div className="mx-3 hidden rounded-lg border bg-card p-3 lg:block">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workflow</p>
            <p className="mt-2 text-sm font-medium">Stage 1 · Release preparation</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Detect changes, build the candidate, then hand it to License Master for validation.</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-7">
          <div className="mx-auto w-full max-w-[1400px]">
            {error && <Alert tone="error">{error}</Alert>}
            {notice && <Alert tone="success">{notice}</Alert>}
            {run && <WorkflowConsole run={run} repo={runRepo} handoff={handoff} />}
                        {tab === "overview" ? (
              <Dashboard stats={stats} releases={releases} loading={loading} onBase={() => setTab("base")} onEngine={() => setTab("engine")} />
            ) : (
              <Composer type={tab} reviewOpen={reviewOpen} channels={availableChannels} {...{ version, setVersion, channel, setChannel, notes, setNotes, files, setFiles, components, setComponents, minBase, setMinBase, protocol, setProtocol, busy }} onInspect={() => inspect(tab)} onStart={() => start(tab)} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function Nav({ active, onClick, label, detail, icon }: any) {
  return <button onClick={onClick} className={`group flex min-w-max items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition hover:bg-accent lg:w-full ${active ? "bg-accent border-border shadow-sm" : "text-muted-foreground"}`}>
    <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>{icon}</span>
    <span className="hidden lg:block"><span className="block text-sm font-medium">{label}</span><span className="block text-[11px] text-muted-foreground">{detail}</span></span>
    <span className="lg:hidden text-sm font-medium">{label}</span>
  </button>;
}

function Dashboard({ stats, releases, loading, onBase, onEngine }: any) {
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-4 md:flex-row md:items-center">
      <div>
        <p className="text-sm font-medium text-primary">Release workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Everything in one place.</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">Prepare release candidates, inspect source changes, and launch the existing GitHub workflows without mixing Base and Engine operations.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/10" onClick={onBase}>New Base release</button>
        <button className="rounded-xl border bg-card px-4 py-2.5 text-sm font-semibold hover:bg-accent" onClick={onEngine}>New Engine update</button>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border xl:grid-cols-4">
      {Object.entries(stats).map(([key, value]) => <div key={key} className="bg-card p-3 sm:p-3.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{key}</p>
        <p className="mt-2 text-3xl font-semibold tracking-tight">{value as number}</p>
      </div>)}
    </div>

    <div className="grid gap-px overflow-hidden rounded-lg border bg-border xl:grid-cols-2">
      <QuickCard title="Base Deployment" subtitle="orbitfs_base" description="Create a Base candidate from the base-release branch and send it through the existing release workflow." action="Open Base" onClick={onBase} />
      <QuickCard title="Engine Updates" subtitle="MCP · Apex · Studio" description="Inspect changed files, select Engine components, and publish an update through the UPDATE_RELEASE workflow." action="Open Engine" onClick={onEngine} />
    </div>

    <ReleaseList releases={releases} loading={loading} />
  </section>;
}

function QuickCard({ title, subtitle, description, action, onClick }: any) {
  return <div className="bg-card p-4 sm:p-4.5">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{subtitle}</p><h2 className="mt-1 text-xl font-semibold">{title}</h2></div>
      <span className="rounded-xl bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">Stage 1</span>
    </div>
    <p className="mt-2 text-sm leading-5 text-muted-foreground">{description}</p>
    <button className="mt-5 rounded-lg border bg-background px-3.5 py-2 text-sm font-medium hover:bg-accent" onClick={onClick}>{action} →</button>
  </div>;
}

function Composer(p: any) {
  const base = p.type === "base";
  const can = Boolean(p.version.trim()) && (base || p.components.length > 0);
  return <section className="space-y-4">
    <div className="flex flex-col justify-between gap-3 border-b pb-4 md:flex-row md:items-center">
      <div><p className="text-sm font-medium text-primary">{base ? "Base Deployment" : "Engine Updates"}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{base ? "Prepare a Base release." : "Prepare an Engine update."}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{base ? "Build a release candidate from the base-release branch." : "Detect source changes and choose the Engine components included in this update."}</p></div>
      <span className="w-fit rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground">{base ? "orbitfs_base · base-release" : "UPDATE_RELEASE"}</span>
    </div>

    <ReleaseInfo type={p.type} version={p.version} channel={p.channel} files={p.files} notes={p.notes} components={p.components} />

    <div className="release-surface p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Version"><input className="control" placeholder="1.2.3" value={p.version} onChange={e => p.setVersion(e.target.value)} /></Field>
        <Field label="Release channel"><select className="control" value={p.channel} onChange={e => p.setChannel(e.target.value)}>{(p.channels?.length ? p.channels : ["stable"]).map((x: string) => <option key={x} value={x}>{x}</option>)}</select></Field>
      </div>

      {!base && <div className="mt-4 border-t pt-4">
        <p className="text-sm font-medium">Components</p><p className="mt-1 text-xs text-muted-foreground">Choose what the Engine update contains.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">{["apex", "mcp", "studio"].map((c) => {
          const selected = p.components.includes(c);
          return <button type="button" key={c} onClick={() => p.setComponents((x: string[]) => x.includes(c) ? x.filter(y => y !== c) : [...x, c])} className={`rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/10" : "bg-background hover:bg-accent"}`}>
            <span className="block text-sm font-semibold">{c.toUpperCase()}</span><span className="mt-0.5 block text-xs text-muted-foreground">{selected ? "Included in update" : "Not selected"}</span>
          </button>;
        })}</div>
      </div>}

      {!base && <div className="mt-5 grid gap-4 border-t pt-5 sm:grid-cols-2">
        <Field label="Minimum Base version"><input className="control" value={p.minBase} onChange={e => p.setMinBase(e.target.value)} /></Field>
        <Field label="Minimum deployer protocol"><input className="control" value={p.protocol} onChange={e => p.setProtocol(e.target.value)} /></Field>
      </div>}

      <div className="mt-4 border-t pt-4"><Field label={base ? "Deployment notes" : "Developer notes"}><textarea className="control min-h-32 resize-y" value={p.notes} onChange={e => p.setNotes(e.target.value)} placeholder={base ? "Optional deployment context or operator notes." : "Optional notes. The changelog is generated automatically from these notes and source inspection."} /></Field></div>

      <div className="mt-5 flex flex-col gap-2 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className="rounded-lg border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent" disabled={p.busy === "inspect"} onClick={p.onInspect}>{p.busy === "inspect" ? "Inspecting source…" : "Detect source changes"}</button>
        <button type="button" className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/10" disabled={!can || p.busy === "start" || (!base && !p.reviewOpen)} onClick={p.onStart}>{p.busy === "start" ? "Starting workflow…" : base ? "Start Base deployment" : p.reviewOpen ? "Send reviewed update" : "Review generated changelog"}</button>
      </div>
      {!can && <p className="mt-2 text-right text-xs text-muted-foreground">{base ? "Enter a version to continue." : "Enter a version and select at least one component."}</p>}
      {!base && can && !p.reviewOpen && <p className="mt-2 text-right text-xs text-muted-foreground">Detect changes first, then review the generated changelog before sending the update.</p>}
    </div>

    {p.files.length > 0 && <div className="release-surface p-4 sm:p-5">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end"><div><h2 className="font-semibold">Detected changes</h2><p className="mt-1 text-sm text-muted-foreground">{p.files.length} files will be supplied to the workflow.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Source inspection complete</span></div>
      <div className="mt-3 overflow-hidden rounded-lg border"><div className="max-h-96 overflow-auto">{p.files.map((f: any) => <div key={f.filename} className="grid grid-cols-[55px_minmax(0,1fr)_80px] gap-2 border-b px-3 py-2.5 text-xs last:border-b-0 sm:grid-cols-[70px_minmax(0,1fr)_110px]"><span className="font-medium uppercase text-muted-foreground">{f.status}</span><code className="truncate">{f.filename}</code><span className="text-right text-muted-foreground">+{f.additions} −{f.deletions}</span></div>)}</div></div>
    </div>}
  </section>;
}

function ReleaseInfo({ type, version, channel, files, notes, components }: any) {
  const base = type === "base"; const count = files.length;
  const generated = base
    ? "OrbitFS Base deployment " + (version || "candidate") + "\n\nProduct: orbitfs_base\nSource: base-release\nChannel: " + channel + "\nDetected source changes: " + count + "\n\nThis deployment packages the current Base product state for the selected release channel. " + (count ? count + " source file" + (count === 1 ? "" : "s") + " changed since the last inspected release." : "No source changes were detected; the deployment can still be used to publish the current Base build as an intentional release.")
    : "# OrbitFS Engine Update — " + (version || "candidate") + "\n\nRelease channel: " + channel + "\nComponents: " + (components.length ? components.map((x:string)=>x.toUpperCase()).join(", ") : "To be selected") + "\nDetected files: " + count + "\n\n" + (notes.trim() || "No developer notes supplied.") + "\n\n" + (count ? "The update includes " + count + " detected source file" + (count === 1 ? "" : "s") + " from the Engine source inspection." : "No source changes were detected. This release will still receive a generated changelog so the release record is complete.");
  return <div className="release-surface p-4 sm:p-5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{base ? "Deployment information" : "Generated changelog"}</p><h2 className="mt-1 text-lg font-semibold">{base ? "What this Base release contains" : "Review before sending"}</h2><p className="mt-1 text-sm text-muted-foreground">{base ? "A descriptive release record is created even when no source changes are detected." : "Review this generated changelog before the workflow is allowed to start."}</p></div>{!base && <span className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground">{count} detected</span>}</div>
    <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border bg-background p-4 text-xs leading-6 text-muted-foreground">{generated}</pre>
  </div>;
}
function WorkflowConsole({ run, repo, handoff }: any) {
  const jobs = run.jobs || [];
  const state = run.conclusion || run.status || "queued";
  const tone = state === "success" ? "border-emerald-400/30 bg-emerald-400/10" : state === "failure" || state === "cancelled" ? "border-destructive/40 bg-destructive/10" : "border-primary/30 bg-primary/10";
  const label = state === "success" ? "Release completed" : state === "failure" ? "Release failed" : state === "cancelled" ? "Release cancelled" : "Release in progress";
  return <section className={`mb-6 rounded-2xl border p-4 shadow-sm sm:p-5 ${tone}`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live release console</p><h2 className="mt-1 text-lg font-semibold">{label}</h2><p className="mt-1 text-xs text-muted-foreground">{repo} · run #{run.id} · {run.status}{run.conclusion ? ` · ${run.conclusion}` : ""}</p></div>
      <a className="rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-accent" href={run.html_url || `https://github.com/${repo}/actions/runs/${run.id}`} target="_blank" rel="noreferrer">Open GitHub run →</a>
    </div>
    <div className="mt-4 space-y-2">
      {jobs.map((job: any) => {
        const s = job.conclusion || job.status || "queued";
        const cls = s === "success" ? "text-emerald-400" : s === "failure" ? "text-destructive" : "text-primary";
        return <div key={job.id} className="rounded-lg border bg-background/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{job.name}</span><span className={`text-xs font-semibold uppercase ${cls}`}>{s}</span></div>
          {job.steps?.length ? <div className="mt-2 grid gap-1 sm:grid-cols-2">{job.steps.map((step:any)=><div key={step.number || step.name} className="flex justify-between gap-2 text-xs text-muted-foreground"><span className="truncate">{step.name}</span><span className="shrink-0">{step.conclusion || step.status || "queued"}</span></div>)}</div> : null}
        </div>;
      })}
      {!jobs.length && <p className="text-xs text-muted-foreground">Waiting for GitHub to report workflow jobs…</p>}
    </div>
    {handoff && <div className="mt-4 rounded-lg border bg-background/60 px-3 py-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">License Master handoff</span><span className="rounded-full bg-muted px-2 py-1">release {handoff.id}</span></div>
      <p className="mt-1 text-muted-foreground">Candidate registered · review {handoff.review_status || "pending"} · validation {handoff.manifest?.validation?.status || "pending"}</p>
    </div>}
  </section>;
}

function Field({ label, children }: any) { return <label className="block text-sm font-medium">{label}{children}</label>; }
function Alert({ tone, children }: any) { return <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone === "error" ? "border-destructive/40 bg-destructive/10 text-foreground" : "border-emerald-400/30 bg-emerald-400/10 text-foreground"}`}>{children}</div>; }

function ReleaseList({ releases, loading }: any) {
  return <section className="release-surface p-4 sm:p-5">
    <div className="flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Release queue</h2><p className="mt-1 text-sm text-muted-foreground">Candidates currently visible to License Master.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{loading ? "Refreshing…" : `${releases.length} total`}</span></div>
    <div className="mt-3 overflow-hidden rounded-lg border">
      {releases.slice(0, 20).map((r: any) => <div key={r.id} className="flex flex-col gap-3 border-b px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><strong className="block truncate text-sm">{r.product_name || "OrbitFS"} {r.version}</strong><p className="mt-1 truncate text-xs text-muted-foreground">{r.release_type} · {r.channel} · {r.source_ref || "—"} · {(r.source_sha || "").slice(0, 8)}</p></div>
        <div className="flex flex-wrap gap-1.5 text-xs"><span className="rounded-full bg-muted px-2 py-1">{r.status}</span><span className="rounded-full bg-muted px-2 py-1">review {r.review_status}</span><span className="rounded-full bg-muted px-2 py-1">validation {r.manifest?.validation?.status || "not run"}</span></div>
      </div>)}
      {!releases.length && <div className="py-8 text-center text-sm text-muted-foreground">No releases yet.</div>}
    </div>
  </section>;
}
