export default function (pi) {
  pi.registerCommand("config-test", {
    description: "Test local pi-config package",
    handler: async (_args, ctx) => {
      ctx.ui.notify("pi-config package działa poprawnie!", "info");
    },
  });
}
