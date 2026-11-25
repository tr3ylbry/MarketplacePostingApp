import { LocalOperatorError } from "./localImageOperator";

export interface LocalOperatorWork {
  controller:AbortController;
  settled:boolean;
  result:string|null;
  completion:Promise<void>;
}
// One local process owns actual work and cancellation. This is deliberately not
// a distributed queue. A missing entry after restart is uncertainty, not proof
// that sockets/native work settled or permission to start again.
export function createLocalOperatorRegistry() {
  const work=new Map<string,LocalOperatorWork>();
  return {
    get(id:string,kind:"fixture"|"run"){return work.get(`${id}:${kind}`);},
    start(id:string,kind:"fixture"|"run",perform:(signal:AbortSignal)=>Promise<string|null>) {
      const key=`${id}:${kind}`;
      if(work.has(key)||work.size>=2)throw new LocalOperatorError("conflict");
      const value:LocalOperatorWork={controller:new AbortController(),settled:false,result:null,completion:Promise.resolve()};
      work.set(key,value);
      value.completion=Promise.resolve().then(()=>perform(value.controller.signal)).then(result=>{
        if(result!==null&&Buffer.byteLength(result,"utf8")<=32_768)value.result=result;
      }).catch(()=>{value.result=null;}).finally(()=>{value.settled=true;});
      return value;
    },
  };
}
export type LocalOperatorRegistry=ReturnType<typeof createLocalOperatorRegistry>;
