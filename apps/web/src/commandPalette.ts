export interface SlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
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
  return commands
    .filter((command) => command.name.toLocaleLowerCase().includes(query))
    .sort((left, right) => {
      const leftName = left.name.toLocaleLowerCase();
      const rightName = right.name.toLocaleLowerCase();
      const prefix = Number(rightName.startsWith(query)) - Number(leftName.startsWith(query));
      return prefix || leftName.localeCompare(rightName);
    })
    .slice(0, limit);
}

export function selectSlashCommand(name: string): string {
  return `/${name} `;
}

export const webCommands: SlashCommand[] = [
 ["model","Wybierz model"],["settings","Ustawienia aplikacji i Pi"],["scope","Scope modeli"],["new","Utwórz sesję"],
 ["compact","Kompaktuj kontekst"],["stats","Statystyki sesji"],["export","Eksportuj rozmowę"],["tree","Drzewo sesji"],["abort","Przerwij odpowiedź"],
].map(([name,description])=>({name:name!,description:description!,source:"extension"}));
