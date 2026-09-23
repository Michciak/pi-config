import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // Package-load test.
  pi.registerCommand("config-test", {
    description: "Test local pi-config package",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-config package działa poprawnie!", "info");
    },
  });

  // Simple deterministic calculator.
  pi.registerTool({
    name: "orchestrator_test",
    label: "Orchestrator Test",
    description:
      "Deterministyczne narzędzie matematyczne używane do testowania orchestracji. " +
      "Wykonuje tylko operacje przekazane w parametrze.",
    promptSnippet: "Wykonuje deterministyczne obliczenie matematyczne",
    promptGuidelines: [
      "Użyj orchestrator_test, gdy test wymaga wykonania kontrolowanego obliczenia.",
      "Nie zastępuj orchestrator_test przez bash podczas testów orchestratora.",
    ],
    parameters: Type.Object({
      operation: Type.String({
        description: 'Działanie matematyczne, np. "408 - 13"',
      }),
    }),
    async execute(_toolCallId, params) {
      if (params.operation === "17 * 24") {
        return {
          content: [{ type: "text", text: "408" }],
          details: {},
        };
      }

      if (params.operation === "408 - 13") {
        return {
          content: [{ type: "text", text: "395" }],
          details: {},
        };
      }

      throw new Error(`Nieobsługiwane działanie: ${params.operation}`);
    },
  });

  // Returns facts that the model must retrieve instead of assuming.
  pi.registerTool({
    name: "orchestrator_lookup",
    label: "Orchestrator Lookup",
    description:
      "Zwraca kontrolowane dane wejściowe do testów orchestratora. " +
      "Model powinien użyć tego narzędzia zamiast zgadywać wartości.",
    promptSnippet: "Pobiera kontrolowane dane wejściowe testu",
    promptGuidelines: [
      "Użyj orchestrator_lookup przed obliczeniami, gdy zadanie wymaga danych testowych.",
      "Nie zakładaj wartości zwracanych przez orchestrator_lookup.",
    ],
    parameters: Type.Object({
      key: Type.String({
        description:
          'Klucz danych: "boxes", "items_per_box" albo "defective".',
      }),
    }),
    async execute(_toolCallId, params) {
      const data: Record<string, string> = {
        boxes: "17",
        items_per_box: "24",
        defective: "13",
      };

      const value = data[params.key];

      if (value === undefined) {
        throw new Error(`Nieznany klucz: ${params.key}`);
      }

      return {
        content: [{ type: "text", text: value }],
        details: {},
      };
    },
  });

  // Final deterministic verification.
  pi.registerTool({
    name: "orchestrator_verify",
    label: "Orchestrator Verify",
    description:
      "Weryfikuje końcowy wynik testu orchestratora. " +
      "Zwraca PASS tylko wtedy, gdy wynik jest równy oczekiwanemu 395.",
    promptSnippet: "Weryfikuje wynik wieloetapowej operacji",
    promptGuidelines: [
      "Użyj orchestrator_verify po wykonaniu całego obliczenia.",
      "Podaj do orchestrator_verify faktycznie uzyskany wynik, a nie wynik zgadywany.",
    ],
    parameters: Type.Object({
      result: Type.Number({
        description: "Wynik uzyskany z poprzednich kroków.",
      }),
    }),
    async execute(_toolCallId, params) {
      const passed = params.result === 395;

      return {
        content: [
          {
            type: "text",
            text: passed
              ? "PASS: wynik 395 jest poprawny."
              : `FAIL: otrzymano ${params.result}, oczekiwano 395.`,
          },
        ],
        details: {
          passed,
          expected: 395,
          actual: params.result,
        },
      };
    },
  });
}