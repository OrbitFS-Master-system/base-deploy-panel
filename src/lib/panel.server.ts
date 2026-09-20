import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

const BASE_REPO=process.env.BASE_RELEASE_REPO||"lucaskerim123/V1-vercel-base";
const BASE_REF=process.env.BASE_RELEASE_REF||"base-release";
const ENGINE_REPO=process.env.ENGINE_RELEASE_REPO||"lucaskerim123/V1-vercel-engine";
const ENGINE_REF=process.env.ENGINE_RELEASE_REF||"UPDATE_RELEASE";
const BASE_WORKFLOW=process.env.BASE_RELEASE_WORKFLOW||"release-to-license-master.yml";
const ENGINE_WORKFLOW=process.env.ENGINE_RELEASE_WORKFLOW||"publish-engine-release.yml";

const required=(name:string)=>{const v=process.env[name];if(!v)throw new Error(`Missing server environment variable: ${name}`);return v};
const masterUrl=()=> (process.env.LICENSE_MASTER_URL||"https://incendiarynetworks.cc/api").replace(/\/+$/,"");

async function verify(token:string){
 if(!token)throw new Error("Not signed in");
 const sb=createClient(required("SUPABASE_URL"),required("SUPABASE_PUBLISHABLE_KEY"),{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await sb.auth.getClaims(token);
 if(error||!data?.claims?.sub)throw new Error("Your session is no longer valid");
 return data.claims.sub as string;
}
async function requestJson(url:string,init:RequestInit={}){
 const r=await fetch(url,{...init,cache:"no-store",headers:{accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})}});
 const text=await r.text();let body:any=null;try{body=text?JSON.parse(text):null}catch{body={error:text||r.statusText}}
 if(!r.ok)throw new Error(body?.error||body?.message||`Request failed (${r.status})`);
 return body;
}
async function github(path:string,init:RequestInit={}){
 return requestJson(`https://api.github.com${path}`,{...init,headers:{authorization:`Bearer ${required("ORBITFS_RELEASE_DISPATCH_TOKEN")}`,"x-github-api-version":"2022-11-28",...(init.headers||{})}});
}
async function licenseMaster(path:string,init:RequestInit={}){
 return requestJson(`${masterUrl()}${path}`,{...init,headers:{authorization:`Bearer ${required("LICENSE_MASTER_API_TOKEN")}`,...(init.headers||{})}});
}

export const getPanelState=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";channel?:string}})=>{
 await verify(data.token);
 const releaseType=data.type==="base"?"base":"update",channel=data.channel||"stable",product=data.type==="base"?"orbitfs_base":"orbitfs_engine";
 const releases=await licenseMaster(`/v1/releases?product=${product}&channel=${encodeURIComponent(channel)}&type=${releaseType}&include_archived=true`);
 return {releases:releases?.releases||[],masterUrl:masterUrl(),product,repositories:{base:{repo:BASE_REPO,ref:BASE_REF,workflow:BASE_WORKFLOW},engine:{repo:ENGINE_REPO,ref:ENGINE_REF,workflow:ENGINE_WORKFLOW}}};
});

export const inspectSource=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";from?:string}})=>{
 await verify(data.token);
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF;
 const branch=await github(`/repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`);
 const head=branch?.object?.sha;if(!head)throw new Error(`Could not resolve ${repo}@${ref}`);
 if(!data.from)return {repo,ref,head,files:[],commits:[]};
 const cmp=await github(`/repos/${repo}/compare/${encodeURIComponent(data.from)}...${encodeURIComponent(head)}`);
 return {repo,ref,head,files:(cmp?.files||[]).map((f:any)=>({filename:f.filename,status:f.status,additions:f.additions,deletions:f.deletions,changes:f.changes})),commits:cmp?.commits||[]};
});

export const startRelease=createServerFn({method:"POST"}).handler(async({data}:{data:{token:string;type:"base"|"engine";version:string;channel:string;notes:string;files:any[];components:string[];minimumBaseVersion:string;protocol:string}})=>{
 await verify(data.token);
 const version=data.version.trim();
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error("Version must be valid SemVer, e.g. 1.2.3");
 if(data.type==="engine"&&!data.components.length)throw new Error("Select at least one Engine component.");
 const repo=data.type==="base"?BASE_REPO:ENGINE_REPO,ref=data.type==="base"?BASE_REF:ENGINE_REF,workflow=data.type==="base"?BASE_WORKFLOW:ENGINE_WORKFLOW;
 const inputs:any={version,channel:data.channel,notes:data.notes.trim(),changed_files:JSON.stringify(data.files||[])};
 if(data.type==="engine")Object.assign(inputs,{apex:String(data.components.includes("apex")),mcp:String(data.components.includes("mcp")),studio:String(data.components.includes("studio")),minimum_base_version:data.minimumBaseVersion||"1.0.0",minimum_deployer_protocol:data.protocol||"1",previous_source_commit:""});
 await github(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`,{method:"POST",body:JSON.stringify({ref,inputs})});
 return {ok:true,repo,ref,workflow};
});