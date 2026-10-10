// Deliberately release-local. Never modify the global Pi CLI or source node_modules.
export function patchRpcAutocomplete(source, version) {
  if(version!=="1.0.3")throw new Error("RPC autocomplete patch requires Pi 1.0.3");
  if(source.includes('case "get_completions":'))throw new Error("Pi RPC autocomplete is already patched");
  const anchor='            case "get_commands": {';
  if(source.split(anchor).length!==2)throw new Error("Pi RPC patch anchor changed");
  const additions=`            // Pi Remote: expose the exact registered extension completion functions.
            case "get_completions": {
                const name = String(command.name ?? "");
                const prefix = String(command.prefix ?? "");
                if (name.length > 128 || prefix.length > 2048) return error(id, command.type, "Completion input too long");
                if (name === "thinking") return success(id, command.type, {items:remoteFuzzyFilter(session.getAvailableThinkingLevels(),prefix,item=>item).map(value=>({value,label:value}))});
                if (name === "model") {
                    const models = session.scopedModels.length ? session.scopedModels.map(item=>item.model) : session.modelRuntime.getAvailableSnapshot();
                    return success(id, command.type, {items:remoteFuzzyFilter(models,prefix,remoteModelSearchText).slice(0,100).map(item=>({value:item.provider+"/"+item.id,label:item.id,description:item.provider}))});
                }
                const registered = session.extensionRunner.getRegisteredCommands().find(item => item.invocationName === name);
                if (!registered?.getArgumentCompletions) return success(id, command.type, { items: [] });
                let timer;
                try {
                    const items = await Promise.race([Promise.resolve(registered.getArgumentCompletions(prefix)), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Completion timed out")), 1500); })]);
                    return success(id, command.type, { items: (Array.isArray(items) ? items : []).filter(item => item && typeof item.value === "string" && typeof item.label === "string").slice(0, 100).map(item => ({value:item.value.slice(0,2048),label:item.label.slice(0,2048),description:String(item.description ?? "").slice(0,500)})) });
                } finally { clearTimeout(timer); }
            }
            case "reload_extensions": {
                if (session.isStreaming || session.isCompacting) return error(id, command.type, "Wait for the active turn before reloading");
                await session.reload();
                return success(id, command.type, { reloaded: true });
            }
`;
  return 'import {fuzzyFilter as remoteFuzzyFilter} from "@earendil-works/pi-tui";\nimport {getModelSearchText as remoteModelSearchText} from "../interactive/model-search.js";\n'+source.replace(anchor,additions+anchor);
}
