import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";

async function main() {
  const env = loadEnv();
  const app = await buildApp(env);

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      { port: env.PORT, host: env.HOST },
      "BCP API listening (Approver ≠ Sender enforced in later epics)",
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
