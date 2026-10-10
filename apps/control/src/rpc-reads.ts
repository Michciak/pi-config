const reads=new WeakMap<object,Map<string,{until:number;promise:Promise<unknown>}>>();
export function sharedRpcRead<T>(client:object,key:string,read:()=>Promise<T>,ttl=0):Promise<T> {
  let map=reads.get(client);if(!map){map=new Map();reads.set(client,map);}
  const cached=map.get(key);if(cached&&cached.until>Date.now())return cached.promise as Promise<T>;
  const item={until:Infinity,promise:Promise.resolve().then(read) as Promise<unknown>};
  map.set(key,item);
  void item.promise.then(()=>{item.until=Date.now()+ttl;if(!ttl&&map!.get(key)===item)map!.delete(key);},()=>{if(map!.get(key)===item)map!.delete(key);});
  return item.promise as Promise<T>;
}
export function rpcTimeoutError(error:unknown,readOnly=true):unknown {
  if(!String(error).includes("Timeout waiting for response to"))return error;
  return Object.assign(new Error(readOnly?"Pi nie odpowiedziało na odczyt w ciągu 30 sekund. Sesja może być przeciążona; jej historia nie została usunięta. Spróbuj ponownie za chwilę.":"Pi nie potwierdziło operacji w ciągu 30 sekund. Sprawdź stan sesji przed ponowieniem — operacja mogła już zostać wykonana."),{statusCode:504,code:readOnly?"PI_RPC_TIMEOUT":"PI_RPC_MUTATION_TIMEOUT"});
}
