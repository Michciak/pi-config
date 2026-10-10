export default function(pi:any) {
  pi.registerCommand("completion-fixture",{
    description:"Native completion fixture",
    getArgumentCompletions(prefix:string) {
      return [{value:`native-${prefix}`,label:`Native ${prefix}`,description:"Same extension callback as TUI"}];
    },handler:async()=>{},
  });
  pi.registerCommand("null-fixture",{getArgumentCompletions:()=>null,handler:async()=>{}});
  pi.registerCommand("throw-fixture",{getArgumentCompletions:()=>{throw new Error("fixture error");},handler:async()=>{}});
  pi.registerCommand("slow-fixture",{getArgumentCompletions:()=>new Promise(()=>{}),handler:async()=>{}});
}
