import {fuzzyFilter} from "@earendil-works/pi-tui";
export interface SlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "file" | "argument";
  sourceInfo?: { scope?: string; origin?: string };
}

export function slashQuery(input: string): string | undefined {
  const value = input.trimStart();
  if (!value.startsWith("/") || /\s/.test(value.slice(1))) return;
  return value.slice(1).toLocaleLowerCase();
}

export function commandSuggestions(commands: SlashCommand[], input: string, limit = 1000): SlashCommand[] {
  const query = slashQuery(input);
  if (query === undefined) return [];
  return fuzzyFilter(commands,query,command=>command.name).slice(0,limit);
}

export function selectSlashCommand(name: string): string {
  return `/${name} `;
}

export const webCommands: SlashCommand[] = [
 ["model","Wybierz model"],["settings","Ustawienia aplikacji i Pi"],["scope","Scope modeli"],["new","Utwórz sesję"],
 ["compact","Kompaktuj kontekst"],["stats","Statystyki sesji"],["export","Eksportuj rozmowę"],["tree","Drzewo sesji"],["abort","Przerwij odpowiedź"],
 ["thinking","Ustaw poziom myślenia"],["reload","Przeładuj rozszerzenia, skills i konfigurację Pi"],
].map(([name,description])=>({name:name!,description:description!,source:"extension"}));
