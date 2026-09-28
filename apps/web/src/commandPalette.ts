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

export function commandSuggestions(commands: SlashCommand[], input: string, limit = 8): SlashCommand[] {
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
