import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const BASE_REPO=process.env.BASE_RELEASE_REPO||"lucaskerim123/V1-vercel-base";
const BASE_REF=process.env.BASE_RELEASE_REF||"base-release";
const ENGINE_REPO=process.env.ENGINE_RELEASE_REPO||"lucaskerim123/V1-vercel-engine";
const ENGINE_REF=process.env.ENGINE_RELEASE_REF||"UPDATE_RELEASE";
const BASE_WORKFLOW=process.env.BASE_RELEASE_WORKFLOW||"release-to-license-master.yml";
const ENGINE_WORKFLOW=process.env.ENGINE_RELEASE_WORKFLOW||"publish-engine-release.yml";

const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`Missing server environment variable: ${name}`);return v};
const masterUrl=()=> {
 const configured=(process.env.LICENSE_MASTER_URL||"https://incendiarynetworks.cc/api/v1").trim();
 const url=new URL(configured);
 const path=url.pathname.replace(/\/+$/,"");
 if(/\/api\/v1(?:\/.*)?$/i.test(path))url.pathname=path.replace(/\/api\/v1(?:\/.*)?$/i,"/api/v1");
 else if(/\/api$/i.test(path))url.pathname=path+"/v1";
 else url.pathname=(path||"")+"/api/v1";
 url.search="";
 url.hash="";
 return url.toString().replace(/\/$/,"");
};
const normalizeChannel=(value:string)=>String(value||"stable").trim().toLowerCase();
const allowedRepos=new Set([BASE_REPO,ENGINE_REPO]);

type PanelUser={id:string;email:string;display_name:string;role:string};
const sessionSecret=()=>required("APP_SESSION_SECRET");

function signSession(user:PanelUser){
 const payload=Buffer.from(JSON.stringify({...user,exp:Date.now()+7*86400000})).toString("base64url");
 const sig=crypto.createHmac("sha256",sessionSecret()).update(payload).digest("base64url");
 return `${payload}.${sig}`;
}
function readSession(token:string):PanelUser{
 const [payload,sig]=String(token||"").split(".");
 if(!payload||!sig)throw new Error("Not signed in");
 const expected=crypto.createHmac("sha256",sessionSecret()).update(payload).digest("base64url");
 if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw new Error("Your session is no longer valid");
 const user=JSON.parse(Buffer.from(payload,"base64url").toString()) as PanelUser & {exp:number};
 if(!user.id||!user.email||user.exp<Date.now())throw new Error("Your session is no longer valid");
 return user;
}

function authClient(){
 return createClient(required("SUPABASE_URL"),required("SUPABASE_SERVICE_ROLE_KEY"),{auth:{persistSession:false,autoRefreshToken:false}});
}
function verifyPassword(password:string,hash:string,salt:string){
 const derived=crypto.scryptSync(password,salt,64);
 const stored=Buffer.from(hash,"hex");
 return derived.length===stored.length&&crypto.timingSafeEqual(derived,stored);
}

function requireOwner(token:string){
 const user=readSession(token);
 if(String(user.role).toLowerCase()!=="owner")throw new Error("Owner access required");
 return user;
}
function hashPassword(password:string){
 if(password.length<10)throw new Error("Temporary password must be at least 10 characters");
 const salt=crypto.randomBytes(16).toString("hex");
 const hash=crypto.scryptSync(password,salt,64).toString("hex");
 return {hash,salt};
}
const GROUP_PERMISSIONS=[
 "release.read","release.create","release.monitor","release.lifecycle",
 "channels.read","portal.read","repositories.read","monitoring.read","audit.read"
] as const;

export const login=createServerFn({method:"POST"}).handler(async({data}:{data:{email:string;password:string}})=>{
 const email=String(data.email||"").trim().toLowerCase(),password=String(data.password||"");
 if(!email||!password)throw new Error("Email and password are required");
 const sb=authClient();
 const {data:user,error}=await sb.from("users").select("id,email,password_hash,password_salt,display_name,role,status").ilike("email",email).maybeSingle();
 if(error)throw new Error("Unable to connect to License Master users");
 if(!user||user.status!=="active"||!verifyPassword(password,user.password_hash,user.password_salt))throw new Error("Invalid credentials");
 await sb.from("users").update({last_login_at:new Date().toISOString()}).eq("id",user.id);
 const safe={id:user.id,email:user.email,display_name:user.display_name,role:user.role};
 return {ok:true,token:signSession(safe),user:safe};
});


export const getAccessState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 const actor=readSession(data.token);
 const sb=authClient();
 if(String(actor.role).toLowerCase()!=="owner") return {users:[],groups:[],ownerOnly:true,permissions:GROUP_PERMISSIONS};
 const [{data:users,error:usersError},{data:groups,error:groupsError},{data:memberships,error:membershipError}]=await Promise.all([
  sb.from("users").select("id,email,display_name,role,status,last_login_at,created_at").order("created_at",{ascending:true}),
  sb.from("access_groups").select("id,name,description,permissions,created_at").order("name",{ascending:true}),
  sb.from("user_access_groups").select("user_id,group_id"),
 ]);
 if(usersError)throw new Error("Unable to load Dev Panel users");
 if(groupsError)throw new Error("Unable to load access groups. Apply the Dev Panel access migration first.");
 if(membershipError)throw new Error("Unable to load group memberships");
 return {users:users||[],groups:groups||[],memberships:memberships||[],ownerOnly:false,permissions:GROUP_PERMISSIONS};
});

export const createPanelUser=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;email:string;displayName:string;role:"owner"|"admin";password:string;groupIds?:string[]}})=>{
 const actor=requireOwner(data.token);
 const email=String(data.email||"").trim().toLowerCase();
 const displayName=String(data.displayName||"").trim();
 const role=String(data.role||"admin").toLowerCase();
 if(!email||!email.includes("@"))throw new Error("Enter a valid email address");
 if(!displayName)throw new Error("Display name is required");
 if(!["owner","admin"].includes(role))throw new Error("Role must be Owner or Admin");
 const {hash,salt}=hashPassword(String(data.password||""));
 const sb=authClient();
 const {data:user,error}=await sb.from("users").insert({email,display_name:displayName,role,status:"active",password_hash:hash,password_salt:salt}).select("id,email,display_name,role,status,last_login_at,created_at").single();
 if(error)throw new Error(error.code==="23505"?"A user with that email already exists":"Unable to create user");
 const groupIds=[...new Set((data.groupIds||[]).map(String).filter(Boolean))];
 if(groupIds.length){
  const {error:membershipError}=await sb.from("user_access_groups").insert(groupIds.map(group_id=>({user_id:user.id,group_id})));
  if(membershipError)throw new Error("User created, but group assignment failed");
 }
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"user.created",target_type:"user",target_id:user.id,detail:{email,role}});
 return {user};
});

export const updatePanelUser=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;userId:string;role?:"owner"|"admin";status?:"active"|"disabled";displayName?:string;password?:string;groupIds?:string[]}})=>{
 const actor=requireOwner(data.token);
 const sb=authClient();
 const patch:any={updated_at:new Date().toISOString()};
 if(data.role){if(!["owner","admin"].includes(data.role))throw new Error("Invalid role");patch.role=data.role}
 if(data.status){if(!["active","disabled"].includes(data.status))throw new Error("Invalid status");patch.status=data.status}
 if(typeof data.displayName==="string"){const v=data.displayName.trim();if(!v)throw new Error("Display name is required");patch.display_name=v}
 if(data.password){const hp=hashPassword(data.password);patch.password_hash=hp.hash;patch.password_salt=hp.salt}
 if(String(data.userId)===actor.id&&patch.status==="disabled")throw new Error("You cannot disable your own Owner account");
 if(patch.role==="admin"||patch.status==="disabled"){
  const {data:target}=await sb.from("users").select("role,status").eq("id",data.userId).maybeSingle();
  if(target?.role==="owner"&&target?.status==="active"){
   const {count}=await sb.from("users").select("id",{count:"exact",head:true}).eq("role","owner").eq("status","active");
   if((count||0)<=1)throw new Error("At least one active Owner account is required");
  }
 }
 const {data:user,error}=await sb.from("users").update(patch).eq("id",data.userId).select("id,email,display_name,role,status,last_login_at,created_at").single();
 if(error)throw new Error("Unable to update user");
 if(Array.isArray(data.groupIds)){
  const {error:deleteError}=await sb.from("user_access_groups").delete().eq("user_id",data.userId);
  if(deleteError)throw new Error("User updated, but group memberships could not be reset");
  const ids=[...new Set(data.groupIds.map(String).filter(Boolean))];
  if(ids.length){
   const {error:insertError}=await sb.from("user_access_groups").insert(ids.map(group_id=>({user_id:data.userId,group_id})));
   if(insertError)throw new Error("User updated, but group membership assignment failed");
  }
 }
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"user.updated",target_type:"user",target_id:data.userId,detail:{role:data.role,status:data.status}});
 return {user};
});

export const createAccessGroup=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;name:string;description?:string;permissions?:string[]}})=>{
 const actor=requireOwner(data.token);
 const name=String(data.name||"").trim();
 if(!name)throw new Error("Group name is required");
 const permissions=[...new Set((data.permissions||[]).filter((x:string)=>GROUP_PERMISSIONS.includes(x as any)))];
 const sb=authClient();
 const {data:group,error}=await sb.from("access_groups").insert({name,description:String(data.description||"").trim(),permissions}).select("*").single();
 if(error)throw new Error(error.code==="23505"?"A group with that name already exists":"Unable to create group");
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"group.created",target_type:"group",target_id:group.id,detail:{name,permissions}});
 return {group};
});

export const updateAccessGroup=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;groupId:string;name?:string;description?:string;permissions?:string[]}})=>{
 const actor=requireOwner(data.token);
 const patch:any={updated_at:new Date().toISOString()};
 if(typeof data.name==="string"){const name=data.name.trim();if(!name)throw new Error("Group name is required");patch.name=name}
 if(typeof data.description==="string")patch.description=data.description.trim();
 if(Array.isArray(data.permissions))patch.permissions=[...new Set(data.permissions.filter((x:string)=>GROUP_PERMISSIONS.includes(x as any)))];
 const sb=authClient();
 const {data:group,error}=await sb.from("access_groups").update(patch).eq("id",data.groupId).select("*").single();
 if(error)throw new Error("Unable to update group");
 await sb.from("panel_access_audit").insert({actor_id:actor.id,action:"group.updated",target_type:"group",target_id:data.groupId,detail:patch});
 return {group};
});

export const getPanelState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";channel?:string}})=>{
 readSession(data.token);
 const releaseType=data.type==="base"?"base":"update",channel=normalizeChannel(data.channel),product="orbitfs_base";
 const [releases,channels]=await Promise.all([
  licenseMaster(`/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=false`),
  licenseMaster(`/release-channels?include_disabled=false`)
 ]);
 const availableChannels=Array.isArray(channels?.channels)?channels.channels.filter((x:any)=>x?.enabled===true).map((x:any)=>String(x.channel).trim().toLowerCase()).filter(Boolean):[];
 return {releases:releases?.releases||[],channels:availableChannels,selectedChannel:channel,masterUrl:masterUrl(),product,repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}}};
});

export const inspectSource=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";from?:string;channel?:string}})=>{
 readSession(data.token);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const releaseType=data.type==="base"?"base":"update";
 const channel=normalizeChannel(data.channel||"stable");
 const branch=await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head=branch?.object?.sha;if(!head)throw new Error(`Could not resolve ${repo}@${ref}`);
 let baseline:any=null;
 let baseBaseline:any=null;
 try {
   const baseResult = await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`);
   baseBaseline=(baseResult?.releases||[])
     .filter((r:any)=>r.review_status==="approved"&&r.status==="published"&&r.source_sha)
     .sort((a:any,b:any)=>new Date(b.published_at||b.created_at||0).getTime()-new Date(a.published_at||a.created_at||0).getTime())[0]||null;
 } catch {}
 try {
   const result=await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=false`);
   baseline=(result?.releases||[])
     .filter((r:any)=>r.review_status==="approved"&&r.source_sha)
     .sort((a:any,b:any)=>new Date(b.published_at||b.created_at||0).getTime()-new Date(a.published_at||a.created_at||0).getTime())[0]||null;
 } catch {}
 const from=data.from||baseline?.source_sha||"";
 if(!from)return {repo,ref,head,baseline:baseline?{id:baseline.id,version:baseline.version,sourceSha:baseline.source_sha}:null,baseBaseline:baseBaseline?{id:baseBaseline.id,version:baseBaseline.version,sourceSha:baseBaseline.source_sha}:null,files:[],commits:[]};
 const cmp=await github(`/repos/${repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(head)}`);
 return {repo,ref,head,baseline:baseline?{id:baseline.id,version:baseline.version,sourceSha:baseline.source_sha}:null,baseBaseline:baseBaseline?{id:baseBaseline.id,version:baseBaseline.version,sourceSha:baseBaseline.source_sha}:null,files:(cmp?.files||[]).map((f:any)=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions,changes:f.changes})),commits:cmp?.commits||[]};
});

export const getReleaseHandoff=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string}})=>{  readSession(data.token);  const product="orbitfs_base";  const releaseType=data.type==="base"?"base":"update";  const channel=normalizeChannel(data.channel);  const result=await licenseMaster(`/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=false`);  const release=(result?.releases||[]).find((r:any)=>String(r.version)===String(data.version)&&!r.archived_at);  return {release:release||null,product,releaseType,channel};});export const getReleaseRun=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;repo:string;runId?:number}})=>{
  readSession(data.token);
  const repo=String(data.repo||"").trim();
  if(!allowedRepos.has(repo))throw new Error("Release repository is not allowed");
  if(data.runId){
    const run=await github("/repos/"+repo+"/actions/runs/"+data.runId);
    const jobs=await github("/repos/"+repo+"/actions/runs/"+data.runId+"/jobs?per_page=100");
    return {run,jobs:jobs?.jobs||[]};
  }
  throw new Error("Release workflow run is not available yet");
});

export const startRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string;notes:string;files:any[];components:string[];minimumBaseVersion:string;protocol:string;changelogTemplate:string}})=>{
 readSession(data.token);
 const version=data.version.trim();
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Version must be valid SemVer, e.g. 1.2.3");
 if(data.type==="engine"&&!data.components.length)throw new Error("Select at least one update target (Base, Apex, MCP, or Studio).");
 const channel=normalizeChannel(data.channel);
 const expectedTemplate = data.type === "base" ? "base_deployment_log" : "update_changelog";
 if (data.changelogTemplate !== expectedTemplate) throw new Error(`Use the ${expectedTemplate === "base_deployment_log" ? "Base Deployment Log" : "Update Changelog"} template for this release type.`);
 const channels=await licenseMaster(`/release-channels?include_disabled=false`);
 const channelEnabled=Array.isArray(channels?.channels)&&channels.channels.some((x:any)=>String(x.channel).trim().toLowerCase()===channel&&x.enabled===true);
 if(!channelEnabled)throw new Error("Release channel is not configured or is disabled in License Master: "+channel);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF,workflow=data.type==="base"?BASE_WORKFLOW:ENGINE_WORKFLOW;
 if (data.type === "engine") {
  const baseResult = await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`);
  const publishedBase = (baseResult?.releases || []).some((r:any) => r.status === "published" && r.review_status === "approved");
  if (!publishedBase) throw new Error("A published, technically approved OrbitFS Base release is required before creating Engine updates.");
 }
 const previousResult = data.type === "base"
  ? await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=base&include_archived=false`)
  : await licenseMaster(`/releases?product=orbitfs_base&channel=${encodeURIComponent(channel)}&type=update&include_archived=false`);
 const previousRelease = (previousResult?.releases || [])
  .filter((r:any) => r.review_status === "approved" && r.source_sha)
  .sort((a:any,b:any) => new Date(b.published_at || b.created_at || 0).getTime() - new Date(a.published_at || a.created_at || 0).getTime())[0];

 // Stage 1 is authoritative about the source snapshot sent to the worker.
 // Do not trust stale browser state for changed files or the previous commit.
 const branch = await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head = branch?.object?.sha;
 if (!head) throw new Error(`Could not resolve ${repo}@${ref}`);
 const previousSourceCommit = previousRelease?.source_sha || "";
 let detectedFiles:any[] = [];
 if (previousSourceCommit && previousSourceCommit !== head) {
   const cmp = await github(`/repos/${repo}/compare/${encodeURIComponent(previousSourceCommit)}...${encodeURIComponent(head)}`);
   detectedFiles = (cmp?.files || []).map((f:any)=>({
     filename:f.filename,
     status:f.status,
     additions:f.additions,
     deletions:f.deletions,
     changes:f.changes,
   }));
 }

 if (data.type === "engine" && previousSourceCommit && previousSourceCommit === head) {
   throw new Error("No source changes detected since the last approved Engine release.");
 }

 const selectedComponents = data.type === "engine"
   ? [...new Set((data.components || []).map((x:string)=>String(x).trim().toLowerCase()).filter((x:string)=>["base","apex","mcp","studio"].includes(x)))]
   : ["base"];

 const releaseRecord = {
  format: "orbitfs-release-record-v1",
  releaseType: data.type === "base" ? "base" : "update",
  product: "orbitfs_base",
  version,
  channel,
  sourceRepository: repo,
  sourceRef: ref,
  previousSourceCommit: previousSourceCommit || null,
  detectedSourceChanges: detectedFiles.length,
  changedFiles: detectedFiles,
  components: selectedComponents,
  minimumBaseVersion: data.type === "engine" ? (data.minimumBaseVersion || "1.0.0") : null,
  minimumDeployerProtocol: data.type === "engine" ? (data.protocol || "1") : null,
  notes: data.notes.trim(),
  changelogTemplate: data.changelogTemplate,
  generatedAt: new Date().toISOString(),
 };
 const inputs:any={
  version,
  channel,
  notes:data.notes.trim(),
  changed_files:JSON.stringify(detectedFiles),
  previous_source_commit:previousSourceCommit,
 };
 if(data.type==="base") inputs.release_record=JSON.stringify(releaseRecord);
 if(data.type==="engine")Object.assign(inputs,{base:String(selectedComponents.includes("base")),apex:String(selectedComponents.includes("apex")),mcp:String(selectedComponents.includes("mcp")),studio:String(selectedComponents.includes("studio")),minimum_base_version:data.minimumBaseVersion||"1.0.0",minimum_deployer_protocol:data.protocol||"1"});
 const dispatchedAt=Date.now();
  await github(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{method:"POST",body:JSON.stringify({ref,inputs})});
  let runId:number|undefined;
  for(let attempt=0;attempt<5&&!runId;attempt++){
    await new Promise(r=>setTimeout(r,700));
    try{
      const runs=await github(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&per_page=10`);
      const candidates=(runs?.workflow_runs||[]).filter((r:any)=>r.head_branch===ref&&new Date(r.created_at||0).getTime()>=dispatchedAt-5000);
      runId=candidates.sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())[0]?.id;
    }catch{}
  }
  return {ok:true,repo,ref,workflow,channel,runId:runId||null};
});


export const getControlState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const [base,updates,channels,audit]=await Promise.all([
  licenseMaster('/releases?product=orbitfs_base&type=base&include_archived=true'),
  licenseMaster('/releases?product=orbitfs_base&type=update&include_archived=true'),
  licenseMaster('/release-channels?include_disabled=true'),
  licenseMaster('/audit-events?limit=100')
 ]);
 return {
  releases:[...(base?.releases||[]),...(updates?.releases||[])].sort((a:any,b:any)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()),
  channels:channels?.channels||[],
  audit:audit?.events||[],
  repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}},
  masterUrl:masterUrl()
 };
});

export const controlRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;releaseId:string;action:"approve"|"reject"|"rollback"|"withdraw"|"archive"|"restore";reason?:string}})=>{
 const actor=readSession(data.token);
 if(!["owner","admin"].includes(String(actor.role).toLowerCase()))throw new Error("Admin access required");
 const id=String(data.releaseId||"").trim();
 if(!id)throw new Error("Release ID is required");
 const action=String(data.action||"").trim().toLowerCase();
 if(!["approve","reject","rollback","withdraw","archive","restore"].includes(action))throw new Error("Unsupported release action");
 const result=await licenseMaster(`/releases/${encodeURIComponent(id)}`,{method:"POST",body:JSON.stringify({action,reason:data.reason||undefined})});
 return result;
});

export const getChannelsState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const channels=await licenseMaster('/release-channels?include_disabled=true');
 const [requestsResult,accessResult]=await Promise.allSettled([
  licenseMaster('/release-channels/access?status=all'),
  licenseMaster('/release-channels/access?view=access&status=all')
 ]);
 const warnings:string[]=[];
 const requests=requestsResult.status==="fulfilled"?(requestsResult.value?.requests||[]):[];
 const access=accessResult.status==="fulfilled"?(accessResult.value?.access||[]):[];
 if(requestsResult.status==="rejected")warnings.push("Channel access requests are temporarily unavailable.");
 if(accessResult.status==="rejected")warnings.push("Channel assignments are temporarily unavailable.");
 return {channels:channels?.channels||[],requests,access,warnings};
});

export const saveReleaseChannel=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;channel:string;label:string;description?:string;enabled:boolean;customerVisible:boolean;accessMode:string;accessRequestEnabled:boolean;selfJoinEnabled:boolean;sortOrder?:number}})=>{
 const actor=readSession(data.token);
 if(!["owner","admin"].includes(String(actor.role).toLowerCase()))throw new Error("Admin access required");
 const channel=String(data.channel||"").trim().toLowerCase();
 if(!channel)throw new Error("Channel is required");
 return licenseMaster('/release-channels',{method:"POST",body:JSON.stringify({
   channel,label:String(data.label||channel).trim(),description:String(data.description||"").trim(),
   enabled:Boolean(data.enabled),customer_visible:Boolean(data.customerVisible),
   access_mode:String(data.accessMode||"assigned").trim().toLowerCase(),
   access_request_enabled:Boolean(data.accessRequestEnabled),self_join_enabled:Boolean(data.selfJoinEnabled),
   sort_order:Number.isFinite(Number(data.sortOrder))?Number(data.sortOrder):0
 })});
});

export const reviewChannelAccess=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;action:"grant"|"reject"|"revoke";licenseId:string;channel:string;reason?:string}})=>{
 const actor=readSession(data.token);
 if(!["owner","admin"].includes(String(actor.role).toLowerCase()))throw new Error("Admin access required");
 const licenseId=String(data.licenseId||"").trim(),channel=String(data.channel||"").trim().toLowerCase();
 if(!licenseId||!channel)throw new Error("License and channel are required");
 return licenseMaster('/release-channels/access',{method:"POST",body:JSON.stringify({action:data.action,license_id:licenseId,channel,reason:data.reason||undefined})});
});

export const getAuditState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;limit?:number}})=>{
 readSession(data.token);
 const limit=Math.min(200,Math.max(1,Number(data.limit||100)));
 const result=await licenseMaster(`/audit-events?limit=${limit}`);
 return {events:result?.events||[]};
});

export const getRepositoryStatus=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const configs=[
  {key:"base",repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},
  {key:"engine",repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW},
 ];
 const rows:any[]=[];
 for(const cfg of configs){
  let head:any=null,run:any=null;
  try{const branch=await github(`/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.ref)}`);head=branch?.object?.sha||null;}catch{}
  try{
   const runs=await github(`/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}/runs?branch=${encodeURIComponent(cfg.ref)}&per_page=1`);
   run=(runs?.workflow_runs||[])[0]||null;
  }catch{}
  rows.push({...cfg,head,run});
 }
 return {repositories:rows};
});

export const getPortalMonitor=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string}})=>{
 readSession(data.token);
 const [base,updates,channels]=await Promise.all([
  licenseMaster('/releases?product=orbitfs_base&type=base&include_archived=true'),
  licenseMaster('/releases?product=orbitfs_base&type=update&include_archived=true'),
  licenseMaster('/release-channels?include_disabled=true')
 ]);
 const releases=[...(base?.releases||[]),...(updates?.releases||[])];
 return {
  releases,
  published:releases.filter((r:any)=>r.status==="published"&&!r.archived_at),
  channels:channels?.channels||[],
  portalUrl:(process.env.CUSTOMER_PORTAL_URL||process.env.BILLING_STORE_URL||"").replace(/\/+$/,"")
 };
});

async function requestJson(url:string,init:RequestInit={}){
 let r:Response;
 try {
   r=await fetch(url,{...init,cache:"no-store",headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}});
 } catch (error:any) {
   throw new Error(`Network request failed: ${url} · ${error?.message || "fetch failed"}`);
 }
 const text=await r.text();
 const contentType=(r.headers.get("content-type")||"").toLowerCase();
 let body:any=null;
 if(text){
   try{ body=JSON.parse(text); }
   catch{
     const looksHtml=contentType.includes("text/html")||/^\\s*<!doctype html/i.test(text)||/^\\s*<html/i.test(text);
     body={error:looksHtml?null:text.trim().slice(0,500)};
   }
 }
 if(!r.ok){
   if(contentType.includes("text/html")||/^\\s*<!doctype html/i.test(text)||/^\\s*<html/i.test(text)){
     throw new Error(`License Master API returned HTTP ${r.status} for ${new URL(url).pathname}. The configured LICENSE_MASTER_URL may point at a deployment that does not expose this API route.`);
   }
   throw new Error(body?.error||body?.message||`Request failed (${r.status}) at ${url}`);
 }
 if(text&&!body){
   throw new Error(`Expected JSON from ${url}, but the response could not be parsed.`);
 }
 return body;
}
async function github(path:string,init:RequestInit={}){
 return requestJson(`https://api.github.com${path}`,{...init,headers:{authorization:`Bearer ${required("ORBITFS_RELEASE_DISPATCH_TOKEN")}`,"x-github-api-version":"2022-11-28",...(init.headers||{})}});
}
async function licenseMaster(path:string,init:RequestInit={}){
 return requestJson(`${masterUrl()}${path}`,{...init,headers:{authorization:`Bearer ${required("LICENSE_MASTER_API_TOKEN")}`,...(init.headers||{})}});
}
