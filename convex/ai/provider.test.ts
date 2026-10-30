// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { analyzeInput, embedTexts, selectCitations } from "./provider";

beforeEach(() => {
  vi.stubEnv("EVENTPULSE_AI_ENABLED","true");vi.stubEnv("OPENAI_API_KEY","unit-test-key");
  vi.stubEnv("OPENAI_TEXT_MODEL","test-model");vi.stubEnv("OPENAI_VISION_MODEL","test-vision");vi.stubEnv("OPENAI_EMBEDDING_MODEL","test-embedding");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
const analysis = {language:"hi",translatedText:"A person needs help",incidentType:"medical",suggestedSeverity:"high",summary:"Reported person needing assistance",observations:[{text:"A person reportedly needs help",source:"report_text"}],uncertaintyReasons:["Unverified report"],needsHumanReview:true};
function response(value: unknown) {
  return new Response(JSON.stringify({ id:"resp_test",object:"response",created_at:1,status:"completed",model:"test-model",output:[{type:"message",id:"msg_test",role:"assistant",status:"completed",content:[{type:"output_text",text:JSON.stringify(value),annotations:[]}]}],usage:{input_tokens:12,output_tokens:18,total_tokens:30},error:null,incomplete_details:null }),{status:200,headers:{"content-type":"application/json"}});
}
test("actual LangChain adapter sends strict Responses API output with storage disabled",async()=>{
  const requests:Array<{url:string; body:Record<string,unknown>}> = [];
  vi.stubGlobal("fetch",vi.fn(async (input: RequestInfo | URL, init?: RequestInit)=>{
    requests.push({url:String(input),body:JSON.parse(String(init?.body))});
    return response(analysis);
  }));
  const result=await analyzeInput("एक व्यक्ति को मदद चाहिए");
  expect(result.output).toEqual(analysis);expect(result.model).toBe("test-model");expect(result.inputTokens).toBe(12);
  expect(requests).toHaveLength(1);expect(requests[0].url).toContain("/responses");expect(requests[0].body.store).toBe(false);
  expect(requests[0].body).toHaveProperty("text.format.strict",true);
  expect(requests[0].body).not.toHaveProperty("tools");
});
test("text-only analysis cannot fabricate image evidence",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response({...analysis,observations:[{text:"Smoke visible",source:"image"}]})));
  await expect(analyzeInput("A report")).rejects.toThrow("unsupported_image_claim");
});
test("provider refusal cannot become a successful analysis",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({id:"resp_refused",object:"response",created_at:1,status:"completed",model:"test-model",output:[{type:"message",id:"msg",role:"assistant",status:"completed",content:[{type:"refusal",refusal:"Cannot assess this input"}]}],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}),{headers:{"content-type":"application/json"}})));
  await expect(analyzeInput("Evidence")).rejects.toThrow();
});
test("rate limiting makes only one request, avoiding nested retry amplification",async()=>{
  const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:"Rate limited",type:"rate_limit_error"}}),{status:429,headers:{"content-type":"application/json"}}));
  vi.stubGlobal("fetch",fetch);
  await expect(analyzeInput("Evidence")).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
test("embedding adapter requests index dimensions and rejects malformed provider vectors",async()=>{
  const requests:Record<string,unknown>[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_input:unknown,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({object:"list",model:"test-embedding",data:[{object:"embedding",index:0,embedding:Array(1536).fill(0.1)}],usage:{prompt_tokens:1,total_tokens:1}}),{headers:{"content-type":"application/json"}});
  }));
  const result=await embedTexts(["Venue procedure"]);expect(result.vectors[0]).toHaveLength(1536);expect(requests[0].dimensions).toBe(1536);
});
test("RAG asks the model only to select excerpts, with no operational tools",async()=>{
  const fetch=vi.fn(async()=>response({abstain:false,citations:[{chunkId:"chunk-one",quote:"Contact the control room."}]}));vi.stubGlobal("fetch",fetch);
  const answer=await selectCitations("Who should staff contact?",[{chunkId:"chunk-one",text:"Contact the control room.",title:"Venue SOP",version:"1"}]);
  expect(answer.citations[0].quote).toBe("Contact the control room.");
});

test("compatible providers use configured Chat Completions with strict schema and no retry",async()=>{
  vi.stubEnv("OPENAI_BASE_URL","https://api.openlux.ai/v1");vi.stubEnv("OPENAI_API_MODE","chat");vi.stubEnv("OPENAI_TEXT_MODEL","gpt-5.5-pro");
  const requests:Array<{url:string;body:Record<string,unknown>}>=[];
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    requests.push({url:String(input),body:JSON.parse(String(init?.body))});
    return new Response(JSON.stringify({id:"chat_test",object:"chat.completion",created:1,model:"gpt-5.5-pro",choices:[{index:0,finish_reason:"stop",message:{role:"assistant",content:JSON.stringify(analysis)}}],usage:{prompt_tokens:12,completion_tokens:18,total_tokens:30}}),{headers:{"content-type":"application/json"}});
  }));
  const result=await analyzeInput("A person needs help");
  expect(result.output).toEqual(analysis);expect(result.model).toBe("gpt-5.5-pro");
  expect(requests).toHaveLength(1);expect(requests[0].url).toBe("https://api.openlux.ai/v1/chat/completions");
  expect(requests[0].body).toHaveProperty("response_format.json_schema.strict",true);expect(requests[0].body.store).toBe(false);
});

test("provider configuration rejects credential-bearing or insecure URLs before sending data",async()=>{
  const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
  for (const url of ["http://api.openlux.ai/v1","https://user:password@api.openlux.ai/v1","https://api.openlux.ai/v1?key=secret"]) {
    vi.stubEnv("OPENAI_BASE_URL",url);await expect(analyzeInput("Test")).rejects.toThrow("invalid_provider_url");
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("NLP duplicate comparison validates structured meaning match output", async () => {
  const { compareIncidentReports } = await import("./provider");
  const requests: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    return response({candidateId:"incident-one",confidence:0.98});
  }));
  const result = await compareIncidentReports("Entrance se dhuan aa raha hai", [{id:"incident-one",description:"Smoke is rising near the entrance"}]);
  expect(result).toEqual({candidateId:"incident-one",confidence:0.98});
  expect(requests[0]).toHaveProperty("text.format.strict",true);
  expect(requests[0].store).toBe(false);
});
